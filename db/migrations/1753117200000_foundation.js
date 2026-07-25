const runtimeRole = process.env.RUNTIME_DATABASE_ROLE ?? "itsmytoy_runtime";

if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole)) {
  throw new Error("RUNTIME_DATABASE_ROLE must be a safe PostgreSQL identifier");
}

const role = `"${runtimeRole}"`;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE businesses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL UNIQUE CHECK (length(trim(name)) BETWEEN 1 AND 120),
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE locations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id),
      name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
      timezone text NOT NULL DEFAULT 'Asia/Kolkata',
      status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (business_id, name)
    );

    CREATE TABLE app_users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id),
      workos_user_id text NOT NULL UNIQUE,
      display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
      role text NOT NULL CHECK (role IN ('BUSINESS_OWNER', 'TRUSTED_OPERATOR', 'STORE_OPERATOR')),
      status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('INVITED', 'ACTIVE', 'DISABLED')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE products (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id),
      name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 180),
      category text,
      status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE product_variants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id uuid NOT NULL REFERENCES products(id),
      sku text NOT NULL UNIQUE CHECK (length(trim(sku)) BETWEEN 1 AND 80),
      variant_name text,
      status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE barcodes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      variant_id uuid NOT NULL REFERENCES product_variants(id),
      barcode_value text NOT NULL UNIQUE CHECK (length(trim(barcode_value)) BETWEEN 1 AND 120),
      is_primary boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX one_primary_barcode_per_variant
      ON barcodes (variant_id) WHERE is_primary;

    CREATE TABLE price_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      variant_id uuid NOT NULL REFERENCES product_variants(id),
      purchase_price_paise bigint NOT NULL CHECK (purchase_price_paise >= 0),
      mrp_paise bigint NOT NULL CHECK (mrp_paise >= 0),
      standard_price_paise bigint NOT NULL CHECK (standard_price_paise >= 0),
      owner_floor_paise bigint NOT NULL CHECK (owner_floor_paise >= 0),
      trusted_operator_floor_paise bigint NOT NULL CHECK (trusted_operator_floor_paise >= 0),
      store_operator_floor_paise bigint NOT NULL CHECK (store_operator_floor_paise >= 0),
      effective_from timestamptz NOT NULL,
      effective_to timestamptz,
      created_by uuid NOT NULL REFERENCES app_users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (effective_to IS NULL OR effective_to > effective_from),
      CHECK (mrp_paise >= standard_price_paise),
      CHECK (standard_price_paise >= store_operator_floor_paise),
      CHECK (store_operator_floor_paise >= trusted_operator_floor_paise),
      CHECK (trusted_operator_floor_paise >= owner_floor_paise)
    );
    CREATE UNIQUE INDEX one_current_price_per_variant
      ON price_versions (variant_id) WHERE effective_to IS NULL;

    CREATE TABLE sales (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id),
      location_id uuid NOT NULL REFERENCES locations(id),
      status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'COMPLETED', 'CANCELLED')),
      total_paise bigint NOT NULL DEFAULT 0 CHECK (total_paise >= 0),
      created_by uuid NOT NULL REFERENCES app_users(id),
      completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL))
    );

    CREATE TABLE sale_lines (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      sale_id uuid NOT NULL REFERENCES sales(id),
      variant_id uuid NOT NULL REFERENCES product_variants(id),
      price_version_id uuid NOT NULL REFERENCES price_versions(id),
      quantity integer NOT NULL CHECK (quantity > 0),
      unit_price_paise bigint NOT NULL CHECK (unit_price_paise >= 0),
      line_total_paise bigint GENERATED ALWAYS AS (quantity::bigint * unit_price_paise) STORED,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE inventory_movements (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id),
      location_id uuid NOT NULL REFERENCES locations(id),
      variant_id uuid NOT NULL REFERENCES product_variants(id),
      movement_type text NOT NULL CHECK (movement_type IN ('OPENING', 'RECEIPT', 'SALE', 'ADJUSTMENT', 'REVERSAL')),
      quantity_delta integer NOT NULL CHECK (quantity_delta <> 0),
      reference_type text NOT NULL,
      reference_id uuid NOT NULL,
      created_by uuid NOT NULL REFERENCES app_users(id),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX inventory_movements_lookup
      ON inventory_movements (location_id, variant_id, created_at);

    CREATE TABLE inventory_balances (
      location_id uuid NOT NULL REFERENCES locations(id),
      variant_id uuid NOT NULL REFERENCES product_variants(id),
      quantity_on_hand integer NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
      version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (location_id, variant_id)
    );

    CREATE TABLE walking_skeleton_commands (
      command_id uuid PRIMARY KEY,
      actor_user_id uuid NOT NULL REFERENCES app_users(id),
      request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
      result_json jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE audit_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id),
      actor_user_id uuid REFERENCES app_users(id),
      event_type text NOT NULL,
      entity_type text NOT NULL,
      entity_id uuid,
      request_id text,
      details jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    GRANT USAGE ON SCHEMA public TO ${role};
    GRANT SELECT ON app_users TO ${role};
    GRANT SELECT, INSERT ON walking_skeleton_commands TO ${role};
  `);
};

exports.down = false;
