const runtimeRole = process.env.RUNTIME_DATABASE_ROLE ?? "itsmytoy_runtime";

if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole)) {
  throw new Error("RUNTIME_DATABASE_ROLE must be a safe PostgreSQL identifier");
}

const role = `"${runtimeRole}"`;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE product_variants
      ADD COLUMN rack_location text
      CHECK (rack_location IS NULL OR rack_location ~ '^[LCR][1-9][0-9]*-S[1-6]$');

    ALTER TABLE sales
      ADD COLUMN command_id uuid,
      ADD COLUMN request_hash text CHECK (request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$'),
      ADD COLUMN customer_name text CHECK (customer_name IS NULL OR length(trim(customer_name)) BETWEEN 1 AND 120),
      ADD COLUMN customer_phone text CHECK (customer_phone IS NULL OR customer_phone ~ '^[0-9]{10,15}$'),
      ADD COLUMN sales_channel text NOT NULL DEFAULT 'SHOP' CHECK (sales_channel IN ('SHOP', 'WHATSAPP', 'OTHER')),
      ADD COLUMN result_json jsonb;
    CREATE UNIQUE INDEX one_sale_per_command ON sales (command_id) WHERE command_id IS NOT NULL;

    ALTER TABLE sale_lines
      ADD COLUMN purchase_price_paise bigint CHECK (purchase_price_paise IS NULL OR purchase_price_paise >= 0),
      ADD COLUMN mrp_paise bigint CHECK (mrp_paise IS NULL OR mrp_paise >= 0),
      ADD COLUMN standard_price_paise bigint CHECK (standard_price_paise IS NULL OR standard_price_paise >= 0);

    CREATE TABLE sale_payments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      sale_id uuid NOT NULL REFERENCES sales(id),
      payment_mode text NOT NULL CHECK (payment_mode IN ('CASH', 'UPI', 'CARD', 'BANK_TRANSFER')),
      amount_paise bigint NOT NULL CHECK (amount_paise > 0),
      created_at timestamptz NOT NULL DEFAULT now()
    );

    GRANT SELECT ON products, product_variants, barcodes, price_versions, inventory_balances, locations TO ${role};
    GRANT SELECT, INSERT ON sales, sale_lines, sale_payments TO ${role};
    GRANT INSERT ON inventory_movements, audit_events TO ${role};
    GRANT UPDATE (quantity_on_hand, version, updated_at) ON inventory_balances TO ${role};
  `);
};

exports.down = false;
