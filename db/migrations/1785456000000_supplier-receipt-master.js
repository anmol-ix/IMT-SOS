const runtimeRole = process.env.RUNTIME_DATABASE_ROLE ?? "itsmytoy_runtime";

if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole)) {
  throw new Error("RUNTIME_DATABASE_ROLE must be a safe PostgreSQL identifier");
}

const role = `"${runtimeRole}"`;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE suppliers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id),
      name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
      normalized_name text NOT NULL CHECK (length(normalized_name) BETWEEN 1 AND 120),
      phone_normalized text CHECK (
        phone_normalized IS NULL OR phone_normalized ~ '^[0-9]{10,15}$'
      ),
      notes text CHECK (notes IS NULL OR length(trim(notes)) BETWEEN 1 AND 500),
      status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
      created_by uuid NOT NULL REFERENCES app_users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (business_id, normalized_name)
    );

    CREATE INDEX supplier_name_lookup
      ON suppliers (business_id, normalized_name)
      WHERE status = 'ACTIVE';

    INSERT INTO suppliers
      (business_id, name, normalized_name, created_by, created_at)
    SELECT DISTINCT ON (
      r.business_id,
      lower(regexp_replace(trim(r.supplier_name), '\\s+', ' ', 'g'))
    )
      r.business_id,
      trim(r.supplier_name),
      lower(regexp_replace(trim(r.supplier_name), '\\s+', ' ', 'g')),
      r.created_by,
      r.created_at
    FROM stock_receipts r
    ORDER BY
      r.business_id,
      lower(regexp_replace(trim(r.supplier_name), '\\s+', ' ', 'g')),
      r.created_at;

    ALTER TABLE stock_receipts
      ADD COLUMN supplier_id uuid REFERENCES suppliers(id),
      ADD COLUMN supplier_invoice_reference_normalized text;

    UPDATE stock_receipts r
       SET supplier_id = s.id,
           supplier_invoice_reference_normalized = CASE
             WHEN r.supplier_invoice_reference IS NULL THEN NULL
             ELSE upper(regexp_replace(trim(r.supplier_invoice_reference), '\\s+', '', 'g'))
           END
      FROM suppliers s
     WHERE s.business_id = r.business_id
       AND s.normalized_name =
         lower(regexp_replace(trim(r.supplier_name), '\\s+', ' ', 'g'));

    ALTER TABLE stock_receipts
      ALTER COLUMN supplier_id SET NOT NULL,
      ADD CONSTRAINT normalized_supplier_invoice_reference_not_blank
        CHECK (
          supplier_invoice_reference_normalized IS NULL OR
          length(supplier_invoice_reference_normalized) BETWEEN 1 AND 120
        );

    CREATE INDEX possible_duplicate_supplier_invoice
      ON stock_receipts
        (business_id, supplier_id, supplier_invoice_reference_normalized, created_at)
      WHERE supplier_invoice_reference_normalized IS NOT NULL
        AND status <> 'VOIDED';

    GRANT SELECT, INSERT ON suppliers TO ${role};
  `);
};

exports.down = false;
