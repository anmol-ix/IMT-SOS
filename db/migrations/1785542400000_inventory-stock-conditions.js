const runtimeRole = process.env.RUNTIME_DATABASE_ROLE ?? "itsmytoy_runtime";

if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole)) {
  throw new Error("RUNTIME_DATABASE_ROLE must be a safe PostgreSQL identifier");
}

const role = `"${runtimeRole}"`;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE inventory_movements
      ADD COLUMN stock_condition text NOT NULL DEFAULT 'SELLABLE'
        CHECK (stock_condition IN (
          'SELLABLE', 'OPEN_BOX', 'DAMAGED', 'RETURN_TO_SUPPLIER'
        ));

    CREATE INDEX inventory_movements_by_condition
      ON inventory_movements
        (location_id, variant_id, stock_condition, created_at);

    CREATE TABLE inventory_condition_balances (
      location_id uuid NOT NULL REFERENCES locations(id),
      variant_id uuid NOT NULL REFERENCES product_variants(id),
      stock_condition text NOT NULL CHECK (
        stock_condition IN ('OPEN_BOX', 'DAMAGED', 'RETURN_TO_SUPPLIER')
      ),
      quantity_on_hand integer NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
      inventory_value_paise bigint NOT NULL DEFAULT 0 CHECK (inventory_value_paise >= 0),
      version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (location_id, variant_id, stock_condition),
      CHECK (quantity_on_hand > 0 OR inventory_value_paise = 0)
    );

    ALTER TABLE stock_receipt_lines
      ADD COLUMN sellable_quantity integer,
      ADD COLUMN open_box_quantity integer NOT NULL DEFAULT 0,
      ADD COLUMN damaged_quantity integer NOT NULL DEFAULT 0;

    UPDATE stock_receipt_lines
       SET sellable_quantity = quantity_received;

    ALTER TABLE stock_receipt_lines
      ALTER COLUMN sellable_quantity SET NOT NULL,
      ADD CONSTRAINT receipt_condition_quantities_non_negative
        CHECK (
          sellable_quantity >= 0 AND
          open_box_quantity >= 0 AND
          damaged_quantity >= 0
        ),
      ADD CONSTRAINT receipt_condition_quantities_match_total
        CHECK (
          quantity_received =
            sellable_quantity + open_box_quantity + damaged_quantity
          AND quantity_received > 0
        );

    GRANT SELECT, INSERT ON inventory_condition_balances TO ${role};
    GRANT UPDATE (
      quantity_on_hand, inventory_value_paise, version, updated_at
    ) ON inventory_condition_balances TO ${role};
  `);
};

exports.down = false;
