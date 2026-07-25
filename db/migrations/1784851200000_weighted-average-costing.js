const runtimeRole = process.env.RUNTIME_DATABASE_ROLE ?? "itsmytoy_runtime";

if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole)) {
  throw new Error("RUNTIME_DATABASE_ROLE must be a safe PostgreSQL identifier");
}

const role = `"${runtimeRole}"`;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE inventory_balances
      ADD COLUMN inventory_value_paise bigint NOT NULL DEFAULT 0 CHECK (inventory_value_paise >= 0),
      ADD COLUMN latest_landed_cost_paise bigint NOT NULL DEFAULT 0 CHECK (latest_landed_cost_paise >= 0);

    ALTER TABLE sale_lines
      RENAME COLUMN purchase_price_paise TO replacement_unit_cost_paise;
    ALTER TABLE sale_lines
      ADD COLUMN accounting_cogs_paise bigint NOT NULL DEFAULT 0;
    UPDATE sale_lines
       SET replacement_unit_cost_paise = COALESCE(replacement_unit_cost_paise, 0);

    ALTER TABLE stock_receipt_lines
      RENAME COLUMN previous_purchase_cost_paise TO previous_landed_cost_paise;

    DO $costing_replay$
    DECLARE
      balance_row record;
      movement_row record;
      running_quantity bigint;
      running_value bigint;
      latest_landed_cost bigint;
      units_out bigint;
      allocated_cost bigint;
    BEGIN
      FOR balance_row IN
        SELECT ib.location_id, ib.variant_id, ib.quantity_on_hand AS recorded_quantity,
               pv.purchase_price_paise AS opening_unit_cost
          FROM inventory_balances ib
          JOIN price_versions pv ON pv.variant_id = ib.variant_id AND pv.effective_to IS NULL
      LOOP
        running_quantity := 0;
        running_value := 0;
        latest_landed_cost := balance_row.opening_unit_cost;

        FOR movement_row IN
          SELECT m.movement_type, m.quantity_delta, m.created_at, m.id,
                 sl.id AS sale_line_id,
                 rl.id AS receipt_line_id,
                 rl.invoice_unit_cost_paise
            FROM inventory_movements m
            LEFT JOIN sale_lines sl
              ON m.reference_type = 'SALE'
             AND sl.sale_id = m.reference_id
             AND sl.variant_id = m.variant_id
            LEFT JOIN stock_receipt_lines rl
              ON m.reference_type = 'STOCK_RECEIPT'
             AND rl.receipt_id = m.reference_id
             AND rl.variant_id = m.variant_id
           WHERE m.location_id = balance_row.location_id
             AND m.variant_id = balance_row.variant_id
           ORDER BY m.created_at, m.id
        LOOP
          IF movement_row.movement_type = 'RECEIPT' THEN
            UPDATE stock_receipt_lines
               SET previous_landed_cost_paise = latest_landed_cost
             WHERE id = movement_row.receipt_line_id;
            latest_landed_cost := movement_row.invoice_unit_cost_paise;
            running_quantity := running_quantity + movement_row.quantity_delta;
            running_value := running_value
              + movement_row.quantity_delta::bigint * latest_landed_cost;
          ELSIF movement_row.quantity_delta > 0 THEN
            running_quantity := running_quantity + movement_row.quantity_delta;
            running_value := running_value
              + movement_row.quantity_delta::bigint * latest_landed_cost;
          ELSE
            units_out := -movement_row.quantity_delta;
            IF running_quantity < units_out OR running_quantity = 0 THEN
              RAISE EXCEPTION 'Cannot replay costing for variant %, movement %',
                balance_row.variant_id, movement_row.id;
            END IF;
            IF running_quantity = units_out THEN
              allocated_cost := running_value;
            ELSE
              allocated_cost := round(
                running_value::numeric * units_out::numeric / running_quantity::numeric
              )::bigint;
            END IF;
            running_quantity := running_quantity - units_out;
            running_value := running_value - allocated_cost;
            IF movement_row.sale_line_id IS NOT NULL THEN
              UPDATE sale_lines
                 SET accounting_cogs_paise = allocated_cost,
                     replacement_unit_cost_paise = latest_landed_cost
               WHERE id = movement_row.sale_line_id;
            END IF;
          END IF;
        END LOOP;

        IF running_quantity <> balance_row.recorded_quantity THEN
          RAISE EXCEPTION 'Inventory movement mismatch for variant %', balance_row.variant_id;
        END IF;
        UPDATE inventory_balances
           SET inventory_value_paise = running_value,
               latest_landed_cost_paise = latest_landed_cost
         WHERE location_id = balance_row.location_id
           AND variant_id = balance_row.variant_id;
      END LOOP;
    END
    $costing_replay$;

    ALTER TABLE inventory_balances
      ADD CONSTRAINT zero_quantity_has_zero_value
      CHECK (quantity_on_hand > 0 OR inventory_value_paise = 0);
    ALTER TABLE sale_lines
      ALTER COLUMN replacement_unit_cost_paise SET NOT NULL,
      ALTER COLUMN accounting_cogs_paise DROP DEFAULT,
      ADD CHECK (replacement_unit_cost_paise >= 0),
      ADD CHECK (accounting_cogs_paise >= 0);

    GRANT UPDATE (inventory_value_paise, latest_landed_cost_paise)
      ON inventory_balances TO ${role};
  `);
};

exports.down = false;
