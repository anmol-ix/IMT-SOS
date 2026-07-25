const runtimeRole = process.env.RUNTIME_DATABASE_ROLE ?? "itsmytoy_runtime";

if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole)) {
  throw new Error("RUNTIME_DATABASE_ROLE must be a safe PostgreSQL identifier");
}

const role = `"${runtimeRole}"`;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE products
      ADD COLUMN subcategory text,
      ADD COLUMN brand text,
      ADD COLUMN creation_command_id uuid,
      ADD COLUMN creation_request_hash text CHECK (
        creation_request_hash IS NULL OR creation_request_hash ~ '^[0-9a-f]{64}$'
      ),
      ADD CONSTRAINT product_creation_identity_complete CHECK (
        (creation_command_id IS NULL) = (creation_request_hash IS NULL)
      );

    CREATE UNIQUE INDEX one_product_per_creation_command
      ON products (business_id, creation_command_id)
      WHERE creation_command_id IS NOT NULL;

    ALTER TABLE product_variants
      ADD COLUMN unit_of_measure text NOT NULL DEFAULT 'UNIT'
        CHECK (unit_of_measure IN ('UNIT', 'PACK', 'SET', 'PAIR')),
      ADD COLUMN pack_size integer NOT NULL DEFAULT 1 CHECK (pack_size > 0),
      ADD CONSTRAINT accepted_itsmytoy_rack_code CHECK (
        rack_location IS NULL OR
        rack_location ~ '^(L[1-6]|C[1-3]|R[1-4])-S[1-6]$'
      );

    CREATE UNIQUE INDEX unique_normalized_sku
      ON product_variants (upper(trim(sku)));
    CREATE UNIQUE INDEX unique_normalized_barcode
      ON barcodes (upper(trim(barcode_value)));

    CREATE TABLE business_sku_sequences (
      business_id uuid PRIMARY KEY REFERENCES businesses(id),
      last_number integer NOT NULL DEFAULT 0 CHECK (
        last_number BETWEEN 0 AND 9999
      ),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    INSERT INTO business_sku_sequences (business_id, last_number)
    SELECT
      b.id,
      COALESCE(max(
        CASE
          WHEN v.sku ~ '^IMT-[A-Z0-9]{2,3}-[A-Z0-9]{2,3}-[0-9]{4}(-[A-Z0-9]{2,4})?$'
          THEN substring(
            v.sku FROM '^IMT-[A-Z0-9]{2,3}-[A-Z0-9]{2,3}-([0-9]{4})'
          )::integer
          ELSE 0
        END
      ), 0)
    FROM businesses b
    LEFT JOIN products p ON p.business_id = b.id
    LEFT JOIN product_variants v ON v.product_id = p.id
    GROUP BY b.id;

    GRANT INSERT ON
      products, product_variants, barcodes, price_versions, inventory_balances
      TO ${role};
    GRANT SELECT, INSERT ON business_sku_sequences TO ${role};
    GRANT UPDATE (last_number, updated_at) ON business_sku_sequences TO ${role};
  `);
};

exports.down = false;
