const runtimeRole = process.env.RUNTIME_DATABASE_ROLE ?? "itsmytoy_runtime";

if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole)) {
  throw new Error("RUNTIME_DATABASE_ROLE must be a safe PostgreSQL identifier");
}

const role = `"${runtimeRole}"`;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE customers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id),
      name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
      phone_normalized text NOT NULL CHECK (phone_normalized ~ '^[0-9]{10,15}$'),
      locality text CHECK (locality IS NULL OR length(trim(locality)) BETWEEN 1 AND 120),
      email text CHECK (email IS NULL OR length(trim(email)) BETWEEN 3 AND 254),
      status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
      created_by uuid NOT NULL REFERENCES app_users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (business_id, phone_normalized)
    );

    CREATE INDEX customer_name_lookup ON customers (business_id, lower(name));

    CREATE TABLE guest_sale_approval_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id),
      requester_user_id uuid NOT NULL REFERENCES app_users(id),
      approver_user_id uuid REFERENCES app_users(id),
      sale_command_id uuid NOT NULL,
      cart_hash text NOT NULL CHECK (cart_hash ~ '^[0-9a-f]{64}$'),
      total_paise bigint NOT NULL CHECK (total_paise >= 500000),
      cart_summary jsonb NOT NULL,
      status text NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CONSUMED')),
      reason text CHECK (reason = 'CUSTOMER_DECLINED'),
      note text CHECK (note IS NULL OR length(trim(note)) BETWEEN 1 AND 500),
      expires_at timestamptz NOT NULL,
      decision_at timestamptz,
      consumed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (business_id, sale_command_id),
      CHECK (status <> 'PENDING' OR (approver_user_id IS NULL AND decision_at IS NULL)),
      CHECK (status NOT IN ('APPROVED', 'CONSUMED') OR
        (approver_user_id IS NOT NULL AND reason = 'CUSTOMER_DECLINED' AND decision_at IS NOT NULL)),
      CHECK (status <> 'CONSUMED' OR consumed_at IS NOT NULL)
    );

    CREATE INDEX pending_guest_sale_approvals
      ON guest_sale_approval_requests (business_id, created_at)
      WHERE status = 'PENDING';

    ALTER TABLE sales
      ADD COLUMN customer_id uuid REFERENCES customers(id),
      ADD COLUMN guest_approval_id uuid REFERENCES guest_sale_approval_requests(id),
      ADD COLUMN guest_override_reason text CHECK (guest_override_reason = 'CUSTOMER_DECLINED');

    CREATE UNIQUE INDEX one_sale_per_guest_approval
      ON sales (guest_approval_id) WHERE guest_approval_id IS NOT NULL;

    GRANT SELECT, INSERT ON customers TO ${role};
    GRANT SELECT, INSERT ON guest_sale_approval_requests TO ${role};
    GRANT UPDATE (
      status, approver_user_id, reason, note, expires_at,
      decision_at, consumed_at, updated_at
    ) ON guest_sale_approval_requests TO ${role};
  `);
};

exports.down = false;
