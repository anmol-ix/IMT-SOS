const runtimeRole = process.env.RUNTIME_DATABASE_ROLE ?? "itsmytoy_runtime";

if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole)) {
  throw new Error("RUNTIME_DATABASE_ROLE must be a safe PostgreSQL identifier");
}

const role = `"${runtimeRole}"`;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE sales
      ADD COLUMN offline_device_id uuid REFERENCES devices(id),
      ADD COLUMN offline_created_at timestamptz,
      ADD COLUMN offline_catalog_as_of timestamptz,
      ADD CONSTRAINT offline_sale_metadata_complete CHECK (
        (offline_device_id IS NULL
          AND offline_created_at IS NULL
          AND offline_catalog_as_of IS NULL)
        OR
        (offline_device_id IS NOT NULL
          AND offline_created_at IS NOT NULL
          AND offline_catalog_as_of IS NOT NULL)
      );

    CREATE OR REPLACE FUNCTION validate_offline_sale_device(
      p_actor_user_id uuid,
      p_device_id uuid,
      p_device_public_id uuid
    )
    RETURNS TABLE (
      status text,
      last_validated_at timestamptz
    )
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
      SELECT device.status, device.last_validated_at
        FROM devices device
        JOIN app_users actor ON actor.id = p_actor_user_id
       WHERE device.id = p_device_id
         AND device.device_public_id = p_device_public_id
         AND device.app_user_id = actor.id
         AND device.business_id = actor.business_id
         AND actor.status = 'ACTIVE'
    $$;

    REVOKE ALL ON FUNCTION validate_offline_sale_device(uuid, uuid, uuid)
      FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION validate_offline_sale_device(uuid, uuid, uuid)
      TO ${role};
  `);
};

exports.down = false;
