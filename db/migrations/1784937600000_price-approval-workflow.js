const runtimeRole = process.env.RUNTIME_DATABASE_ROLE ?? "itsmytoy_runtime";

if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole)) {
  throw new Error("RUNTIME_DATABASE_ROLE must be a safe PostgreSQL identifier");
}

const role = `"${runtimeRole}"`;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE price_approval_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id),
      location_id uuid NOT NULL REFERENCES locations(id),
      variant_id uuid NOT NULL REFERENCES product_variants(id),
      requester_user_id uuid NOT NULL REFERENCES app_users(id),
      approver_user_id uuid REFERENCES app_users(id),
      price_version_id uuid NOT NULL REFERENCES price_versions(id),
      status text NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CONSUMED')),
      quantity integer NOT NULL CHECK (quantity > 0),
      requested_unit_price_paise bigint NOT NULL CHECK (requested_unit_price_paise > 0),
      standard_price_paise bigint NOT NULL CHECK (standard_price_paise > 0),
      requester_floor_paise bigint NOT NULL CHECK (requester_floor_paise > 0),
      replacement_unit_cost_paise bigint NOT NULL CHECK (replacement_unit_cost_paise >= 0),
      expected_accounting_cogs_paise bigint NOT NULL CHECK (expected_accounting_cogs_paise >= 0),
      expected_replacement_cost_paise bigint NOT NULL CHECK (expected_replacement_cost_paise >= 0),
      reason text CHECK (reason IN (
        'CLEARANCE', 'DAMAGED_PACKAGING', 'CUSTOMER_SERVICE_RECOVERY',
        'PRICING_CORRECTION', 'OTHER'
      )),
      note text CHECK (note IS NULL OR length(trim(note)) BETWEEN 1 AND 500),
      expires_at timestamptz NOT NULL,
      decision_at timestamptz,
      consumed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (requested_unit_price_paise <= standard_price_paise),
      CHECK (reason <> 'OTHER' OR note IS NOT NULL),
      CHECK (status <> 'PENDING' OR (approver_user_id IS NULL AND decision_at IS NULL)),
      CHECK (status NOT IN ('APPROVED', 'CONSUMED') OR
        (approver_user_id IS NOT NULL AND reason IS NOT NULL AND decision_at IS NOT NULL)),
      CHECK (status <> 'CONSUMED' OR consumed_at IS NOT NULL)
    );

    CREATE INDEX pending_price_approvals
      ON price_approval_requests (business_id, created_at)
      WHERE status = 'PENDING';

    ALTER TABLE sales ADD COLUMN price_approval_id uuid REFERENCES price_approval_requests(id);
    CREATE UNIQUE INDEX one_sale_per_price_approval
      ON sales (price_approval_id) WHERE price_approval_id IS NOT NULL;

    GRANT SELECT, INSERT ON price_approval_requests TO ${role};
    GRANT UPDATE (
      status, approver_user_id, price_version_id, standard_price_paise,
      requester_floor_paise, replacement_unit_cost_paise,
      expected_accounting_cogs_paise, expected_replacement_cost_paise,
      reason, note, expires_at, decision_at, consumed_at, updated_at
    ) ON price_approval_requests TO ${role};
  `);
};

exports.down = false;
