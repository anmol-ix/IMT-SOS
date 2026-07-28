const runtimeRole = process.env.RUNTIME_DATABASE_ROLE ?? "itsmytoy_runtime";

if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole)) {
  throw new Error("RUNTIME_DATABASE_ROLE must be a safe PostgreSQL identifier");
}

const role = `"${runtimeRole}"`;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE offline_sale_conflicts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id),
      command_id uuid NOT NULL UNIQUE,
      operator_user_id uuid NOT NULL REFERENCES app_users(id),
      device_id uuid NOT NULL REFERENCES devices(id),
      device_name text NOT NULL CHECK (length(trim(device_name)) BETWEEN 1 AND 120),
      request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
      payload jsonb NOT NULL,
      display jsonb NOT NULL,
      error_code text NOT NULL CHECK (length(error_code) BETWEEN 1 AND 100),
      error_message text NOT NULL CHECK (length(error_message) BETWEEN 1 AND 500),
      status text NOT NULL DEFAULT 'PENDING' CHECK (
        status IN ('PENDING', 'COMPLETED', 'DISMISSED')
      ),
      reported_at timestamptz NOT NULL DEFAULT now(),
      last_reported_at timestamptz NOT NULL DEFAULT now(),
      resolved_by uuid REFERENCES app_users(id),
      resolved_at timestamptz,
      resolution_action text CHECK (
        resolution_action IS NULL
        OR resolution_action IN ('SYNCED_AFTER_RETRY', 'OWNER_CONFIRMED', 'NOT_SOLD')
      ),
      resolution_note text CHECK (
        resolution_note IS NULL OR length(trim(resolution_note)) BETWEEN 1 AND 500
      ),
      sale_id uuid REFERENCES sales(id),
      CHECK (
        (status = 'PENDING'
          AND resolved_at IS NULL
          AND resolution_action IS NULL
          AND sale_id IS NULL)
        OR
        (status = 'COMPLETED'
          AND resolved_at IS NOT NULL
          AND resolution_action IN ('SYNCED_AFTER_RETRY', 'OWNER_CONFIRMED')
          AND (
            resolution_action <> 'OWNER_CONFIRMED'
            OR (resolved_by IS NOT NULL AND resolution_note IS NOT NULL)
          )
          AND sale_id IS NOT NULL)
        OR
        (status = 'DISMISSED'
          AND resolved_at IS NOT NULL
          AND resolution_action = 'NOT_SOLD'
          AND sale_id IS NULL
          AND resolved_by IS NOT NULL
          AND resolution_note IS NOT NULL)
      )
    );

    CREATE INDEX offline_sale_conflicts_owner_queue
      ON offline_sale_conflicts (business_id, status, reported_at);
    CREATE INDEX offline_sale_conflicts_operator_queue
      ON offline_sale_conflicts (operator_user_id, last_reported_at DESC);

    CREATE FUNCTION identify_offline_conflict_device(
      p_actor_user_id uuid,
      p_device_id uuid,
      p_device_public_id uuid
    )
    RETURNS TABLE (
      id uuid,
      display_name text
    )
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
      SELECT device.id, device.display_name
        FROM devices device
        JOIN app_users actor ON actor.id = p_actor_user_id
       WHERE device.id = p_device_id
         AND device.device_public_id = p_device_public_id
         AND device.app_user_id = actor.id
         AND device.business_id = actor.business_id
         AND actor.status = 'ACTIVE'
    $$;

    REVOKE ALL ON FUNCTION identify_offline_conflict_device(uuid, uuid, uuid)
      FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION identify_offline_conflict_device(uuid, uuid, uuid)
      TO ${role};
    GRANT SELECT, INSERT, UPDATE ON offline_sale_conflicts TO ${role};
  `);
};

exports.down = false;
