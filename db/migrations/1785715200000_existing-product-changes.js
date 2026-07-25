const runtimeRole = process.env.RUNTIME_DATABASE_ROLE ?? "itsmytoy_runtime";

if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole)) {
  throw new Error("RUNTIME_DATABASE_ROLE must be a safe PostgreSQL identifier");
}

const role = `"${runtimeRole}"`;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE product_change_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id),
      variant_id uuid NOT NULL REFERENCES product_variants(id),
      command_id uuid NOT NULL,
      request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
      actor_user_id uuid NOT NULL REFERENCES app_users(id),
      reason_code text NOT NULL CHECK (reason_code IN (
        'SUPPLIER_LABEL_CHANGE', 'MARGIN_REVIEW', 'RACK_REORGANISATION',
        'DATA_CORRECTION', 'OTHER'
      )),
      note text CHECK (note IS NULL OR length(trim(note)) BETWEEN 1 AND 500),
      old_rack_location text,
      new_rack_location text,
      old_price_version_id uuid NOT NULL REFERENCES price_versions(id),
      new_price_version_id uuid REFERENCES price_versions(id),
      price_changed boolean NOT NULL,
      rack_changed boolean NOT NULL,
      result_json jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (business_id, command_id),
      CHECK (reason_code <> 'OTHER' OR note IS NOT NULL),
      CHECK (price_changed OR rack_changed),
      CHECK (price_changed = (new_price_version_id IS NOT NULL))
    );

    CREATE INDEX product_change_history
      ON product_change_events (business_id, variant_id, created_at DESC);

    GRANT SELECT, INSERT ON product_change_events TO ${role};
    GRANT UPDATE (rack_location, updated_at) ON product_variants TO ${role};
    GRANT UPDATE (effective_to) ON price_versions TO ${role};
  `);
};

exports.down = false;
