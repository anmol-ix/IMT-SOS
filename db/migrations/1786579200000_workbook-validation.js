const runtimeRole = process.env.RUNTIME_DATABASE_ROLE ?? "itsmytoy_runtime";

if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole)) {
  throw new Error("RUNTIME_DATABASE_ROLE must be a safe PostgreSQL identifier");
}

const role = `"${runtimeRole}"`;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE import_batches (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id),
      snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
      status text NOT NULL DEFAULT 'VALIDATED' CHECK (status = 'VALIDATED'),
      file_manifest jsonb NOT NULL CHECK (jsonb_typeof(file_manifest) = 'array'),
      reconciliation jsonb NOT NULL CHECK (jsonb_typeof(reconciliation) = 'object'),
      created_by uuid NOT NULL REFERENCES app_users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (business_id, snapshot_hash)
    );

    CREATE TABLE import_rows (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      batch_id uuid NOT NULL REFERENCES import_batches(id),
      source_sheet text NOT NULL CHECK (
        source_sheet IN ('Inventory Master', 'Sales Log', 'Customers')
      ),
      source_row integer NOT NULL CHECK (source_row > 0),
      entity_type text NOT NULL CHECK (
        entity_type IN ('PRODUCT', 'SALE_LINE', 'CUSTOMER')
      ),
      source_identifier text,
      status text NOT NULL CHECK (status IN ('ACCEPTED', 'QUARANTINED')),
      raw_data jsonb NOT NULL CHECK (jsonb_typeof(raw_data) = 'object'),
      normalized_data jsonb NOT NULL CHECK (jsonb_typeof(normalized_data) = 'object'),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (batch_id, source_sheet, source_row)
    );

    CREATE TABLE import_errors (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      import_row_id uuid NOT NULL REFERENCES import_rows(id),
      field_name text NOT NULL CHECK (length(trim(field_name)) BETWEEN 1 AND 120),
      code text NOT NULL CHECK (code ~ '^[A-Z0-9_]{2,80}$'),
      severity text NOT NULL CHECK (severity IN ('ERROR', 'WARNING')),
      original_value text CHECK (
        original_value IS NULL OR length(original_value) <= 500
      ),
      message text NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 500),
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX import_batches_history
      ON import_batches (business_id, created_at DESC);
    CREATE INDEX import_rows_report
      ON import_rows (batch_id, status, source_sheet, source_row);
    CREATE INDEX import_errors_report
      ON import_errors (import_row_id, severity);

    GRANT SELECT, INSERT ON import_batches, import_rows, import_errors TO ${role};
  `);
};

exports.down = false;
