const runtimeRole = process.env.RUNTIME_DATABASE_ROLE ?? "itsmytoy_runtime";

if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole)) {
  throw new Error("RUNTIME_DATABASE_ROLE must be a safe PostgreSQL identifier");
}

const role = `"${runtimeRole}"`;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE stock_receipts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id),
      location_id uuid NOT NULL REFERENCES locations(id),
      receipt_number text NOT NULL UNIQUE,
      command_id uuid NOT NULL UNIQUE,
      request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
      supplier_name text NOT NULL CHECK (length(trim(supplier_name)) BETWEEN 1 AND 120),
      supplier_invoice_reference text CHECK (
        supplier_invoice_reference IS NULL OR
        length(trim(supplier_invoice_reference)) BETWEEN 1 AND 120
      ),
      note text CHECK (note IS NULL OR length(trim(note)) BETWEEN 1 AND 500),
      status text NOT NULL CHECK (status IN ('COMPLETED', 'VOIDED')),
      created_by uuid NOT NULL REFERENCES app_users(id),
      completed_at timestamptz NOT NULL,
      result_json jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE stock_receipt_lines (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      receipt_id uuid NOT NULL REFERENCES stock_receipts(id),
      variant_id uuid NOT NULL REFERENCES product_variants(id),
      quantity_received integer NOT NULL CHECK (quantity_received > 0),
      invoice_unit_cost_paise bigint NOT NULL CHECK (invoice_unit_cost_paise > 0),
      previous_purchase_cost_paise bigint NOT NULL CHECK (previous_purchase_cost_paise >= 0),
      created_at timestamptz NOT NULL DEFAULT now()
    );

    GRANT SELECT, INSERT ON stock_receipts, stock_receipt_lines TO ${role};
  `);
};

exports.down = false;
