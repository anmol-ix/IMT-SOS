const runtimeRole = process.env.RUNTIME_DATABASE_ROLE ?? "itsmytoy_runtime";

if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole)) {
  throw new Error("RUNTIME_DATABASE_ROLE must be a safe PostgreSQL identifier");
}

const role = `"${runtimeRole}"`;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE product_variants
      ADD COLUMN reorder_point integer CHECK (
        reorder_point IS NULL OR reorder_point BETWEEN 0 AND 100000
      ),
      ADD COLUMN restock_target integer CHECK (
        restock_target IS NULL OR restock_target BETWEEN 1 AND 100000
      ),
      ADD CONSTRAINT complete_reorder_policy CHECK (
        (reorder_point IS NULL AND restock_target IS NULL)
        OR
        (reorder_point IS NOT NULL AND restock_target IS NOT NULL
          AND restock_target > reorder_point)
      );

    CREATE TABLE reorder_policy_changes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id),
      variant_id uuid NOT NULL REFERENCES product_variants(id),
      command_id uuid NOT NULL,
      request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
      actor_user_id uuid NOT NULL REFERENCES app_users(id),
      reason_code text NOT NULL CHECK (reason_code IN (
        'INITIAL_SETUP', 'SALES_VELOCITY', 'SUPPLIER_LEAD_TIME',
        'SEASONALITY', 'STORAGE_CAPACITY', 'DATA_CORRECTION', 'OTHER'
      )),
      note text NOT NULL CHECK (length(trim(note)) BETWEEN 3 AND 500),
      old_reorder_point integer,
      old_restock_target integer,
      new_reorder_point integer,
      new_restock_target integer,
      result_json jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (business_id, command_id),
      CHECK (
        (old_reorder_point IS NULL AND old_restock_target IS NULL)
        OR
        (old_reorder_point IS NOT NULL AND old_restock_target IS NOT NULL
          AND old_restock_target > old_reorder_point)
      ),
      CHECK (
        (new_reorder_point IS NULL AND new_restock_target IS NULL)
        OR
        (new_reorder_point IS NOT NULL AND new_restock_target IS NOT NULL
          AND new_restock_target > new_reorder_point)
      ),
      CHECK (
        old_reorder_point IS DISTINCT FROM new_reorder_point
        OR old_restock_target IS DISTINCT FROM new_restock_target
      )
    );

    CREATE INDEX reorder_policy_change_history
      ON reorder_policy_changes (business_id, variant_id, created_at DESC);
    CREATE INDEX product_variants_reorder_alerts
      ON product_variants (reorder_point, restock_target)
      WHERE reorder_point IS NOT NULL;

    GRANT SELECT, INSERT ON reorder_policy_changes TO ${role};
    GRANT UPDATE (
      reorder_point, restock_target, updated_at
    ) ON product_variants TO ${role};
  `);
};

exports.down = false;
