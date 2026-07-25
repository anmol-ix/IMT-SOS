const runtimeRole = process.env.RUNTIME_DATABASE_ROLE ?? "itsmytoy_runtime";

if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole)) {
  throw new Error("RUNTIME_DATABASE_ROLE must be a safe PostgreSQL identifier");
}

const role = `"${runtimeRole}"`;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE stock_adjustments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id),
      location_id uuid NOT NULL REFERENCES locations(id),
      variant_id uuid NOT NULL REFERENCES product_variants(id),
      stock_condition text NOT NULL CHECK (
        stock_condition IN ('SELLABLE', 'OPEN_BOX', 'DAMAGED')
      ),
      recorded_quantity integer NOT NULL CHECK (recorded_quantity >= 0),
      counted_quantity integer NOT NULL CHECK (counted_quantity >= 0),
      quantity_delta integer NOT NULL CHECK (
        quantity_delta <> 0
        AND quantity_delta = counted_quantity - recorded_quantity
      ),
      recorded_balance_version bigint NOT NULL CHECK (
        recorded_balance_version >= 0
      ),
      recorded_inventory_value_paise bigint NOT NULL CHECK (
        recorded_inventory_value_paise >= 0
      ),
      expected_value_delta_paise bigint NOT NULL,
      applied_unit_cost_paise bigint NOT NULL CHECK (
        applied_unit_cost_paise >= 0
      ),
      reason_code text NOT NULL CHECK (reason_code IN (
        'PHYSICAL_COUNT', 'DAMAGE_OR_PACKAGING_FOUND', 'LOSS_OR_MISSING',
        'FOUND_STOCK', 'DATA_CORRECTION', 'OTHER'
      )),
      note text NOT NULL CHECK (length(trim(note)) BETWEEN 3 AND 500),
      status text NOT NULL DEFAULT 'REQUESTED' CHECK (
        status IN ('REQUESTED', 'REJECTED', 'APPLIED')
      ),
      requested_by uuid NOT NULL REFERENCES app_users(id),
      decided_by uuid REFERENCES app_users(id),
      applied_by uuid REFERENCES app_users(id),
      request_command_id uuid NOT NULL,
      request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
      decision_command_id uuid,
      decision_hash text CHECK (
        decision_hash IS NULL OR decision_hash ~ '^[0-9a-f]{64}$'
      ),
      decision_note text CHECK (
        decision_note IS NULL OR length(trim(decision_note)) BETWEEN 1 AND 500
      ),
      result_json jsonb,
      requested_at timestamptz NOT NULL DEFAULT now(),
      decided_at timestamptz,
      applied_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (business_id, request_command_id),
      UNIQUE (business_id, decision_command_id),
      CHECK (
        (status = 'REQUESTED'
          AND decided_by IS NULL AND applied_by IS NULL
          AND decision_command_id IS NULL AND decision_hash IS NULL
          AND decided_at IS NULL AND applied_at IS NULL AND result_json IS NULL)
        OR
        (status = 'REJECTED'
          AND decided_by IS NOT NULL AND applied_by IS NULL
          AND decision_command_id IS NOT NULL AND decision_hash IS NOT NULL
          AND decided_at IS NOT NULL AND applied_at IS NULL
          AND result_json IS NOT NULL)
        OR
        (status = 'APPLIED'
          AND decided_by IS NOT NULL AND applied_by IS NOT NULL
          AND decision_command_id IS NOT NULL AND decision_hash IS NOT NULL
          AND decided_at IS NOT NULL AND applied_at IS NOT NULL
          AND result_json IS NOT NULL)
      )
    );

    CREATE INDEX stock_adjustments_pending
      ON stock_adjustments (business_id, status, requested_at);
    CREATE INDEX stock_adjustments_history
      ON stock_adjustments
        (business_id, variant_id, stock_condition, requested_at DESC);

    GRANT SELECT, INSERT ON stock_adjustments TO ${role};
    GRANT UPDATE (
      status, decided_by, applied_by, decision_command_id, decision_hash,
      decision_note, result_json, decided_at, applied_at, updated_at
    ) ON stock_adjustments TO ${role};
  `);
};

exports.down = false;
