const runtimeRole = process.env.RUNTIME_DATABASE_ROLE ?? "itsmytoy_runtime";

if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole)) {
  throw new Error("RUNTIME_DATABASE_ROLE must be a safe PostgreSQL identifier");
}

const role = `"${runtimeRole}"`;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE inventory_lots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id),
      location_id uuid NOT NULL REFERENCES locations(id),
      variant_id uuid NOT NULL REFERENCES product_variants(id),
      source_type text NOT NULL CHECK (
        source_type IN ('OPENING_BALANCE', 'RECEIPT', 'ADJUSTMENT')
      ),
      source_id uuid,
      original_quantity integer NOT NULL CHECK (original_quantity > 0),
      remaining_quantity integer NOT NULL CHECK (
        remaining_quantity >= 0 AND remaining_quantity <= original_quantity
      ),
      unit_cost_paise bigint NOT NULL CHECK (unit_cost_paise >= 0),
      received_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE UNIQUE INDEX one_inventory_lot_per_source
      ON inventory_lots (source_type, source_id)
      WHERE source_id IS NOT NULL;
    CREATE INDEX inventory_lots_fifo_lookup
      ON inventory_lots (location_id, variant_id, received_at, id)
      WHERE remaining_quantity > 0;

    ALTER TABLE sale_lines
      ADD COLUMN costing_method text NOT NULL DEFAULT 'WEIGHTED_AVERAGE'
        CHECK (costing_method IN ('WEIGHTED_AVERAGE', 'FIFO'));

    CREATE TABLE sale_line_cost_allocations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      sale_line_id uuid NOT NULL REFERENCES sale_lines(id),
      inventory_lot_id uuid NOT NULL REFERENCES inventory_lots(id),
      allocation_sequence integer NOT NULL CHECK (allocation_sequence > 0),
      quantity integer NOT NULL CHECK (quantity > 0),
      unit_cost_paise bigint NOT NULL CHECK (unit_cost_paise >= 0),
      total_cost_paise bigint GENERATED ALWAYS AS (
        quantity::bigint * unit_cost_paise
      ) STORED,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (sale_line_id, inventory_lot_id),
      UNIQUE (sale_line_id, allocation_sequence)
    );

    -- Existing stock becomes the opening FIFO layer. This preserves the exact
    -- carrying value, including a possible one-paise remainder from the former
    -- moving-average method. Every receipt completed after this migration gets
    -- its own purchase-cost layer.
    DO $opening_fifo_lots$
    DECLARE
      balance record;
      base_cost bigint;
      higher_cost_units integer;
      lower_cost_units integer;
      opening_time timestamptz;
    BEGIN
      FOR balance IN
        SELECT p.business_id, ib.location_id, ib.variant_id,
               ib.quantity_on_hand, ib.inventory_value_paise
          FROM inventory_balances ib
          JOIN product_variants v ON v.id = ib.variant_id
          JOIN products p ON p.id = v.product_id
         WHERE ib.quantity_on_hand > 0
      LOOP
        base_cost := balance.inventory_value_paise / balance.quantity_on_hand;
        higher_cost_units := (
          balance.inventory_value_paise % balance.quantity_on_hand
        )::integer;
        lower_cost_units := balance.quantity_on_hand - higher_cost_units;
        SELECT COALESCE(min(created_at), now())
          INTO opening_time
          FROM inventory_movements
         WHERE location_id = balance.location_id
           AND variant_id = balance.variant_id
           AND stock_condition = 'SELLABLE';

        IF lower_cost_units > 0 THEN
          INSERT INTO inventory_lots (
            business_id, location_id, variant_id, source_type,
            original_quantity, remaining_quantity, unit_cost_paise, received_at
          ) VALUES (
            balance.business_id, balance.location_id, balance.variant_id,
            'OPENING_BALANCE', lower_cost_units, lower_cost_units,
            base_cost, opening_time
          );
        END IF;

        IF higher_cost_units > 0 THEN
          INSERT INTO inventory_lots (
            business_id, location_id, variant_id, source_type,
            original_quantity, remaining_quantity, unit_cost_paise, received_at
          ) VALUES (
            balance.business_id, balance.location_id, balance.variant_id,
            'OPENING_BALANCE', higher_cost_units, higher_cost_units,
            base_cost + 1, opening_time + interval '1 microsecond'
          );
        END IF;
      END LOOP;
    END
    $opening_fifo_lots$;

    GRANT SELECT, INSERT ON inventory_lots, sale_line_cost_allocations TO ${role};
    GRANT UPDATE (remaining_quantity) ON inventory_lots TO ${role};
  `);
};

exports.down = false;
