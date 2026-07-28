const runtimeRole = process.env.RUNTIME_DATABASE_ROLE ?? "itsmytoy_runtime";

if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole)) {
  throw new Error("RUNTIME_DATABASE_ROLE must be a safe PostgreSQL identifier");
}

const role = `"${runtimeRole}"`;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE devices (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id),
      app_user_id uuid NOT NULL REFERENCES app_users(id),
      device_public_id uuid NOT NULL UNIQUE,
      display_name text NOT NULL CHECK (
        length(trim(display_name)) BETWEEN 1 AND 120
      ),
      status text NOT NULL DEFAULT 'PENDING' CHECK (
        status IN ('PENDING', 'ACTIVE', 'REVOKED')
      ),
      enrolled_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      last_validated_at timestamptz,
      approved_by uuid REFERENCES app_users(id),
      approved_at timestamptz,
      revoked_by uuid REFERENCES app_users(id),
      revoked_at timestamptz,
      CHECK (
        (status = 'PENDING' AND approved_at IS NULL AND revoked_at IS NULL)
        OR (status = 'ACTIVE' AND approved_at IS NOT NULL AND revoked_at IS NULL)
        OR (status = 'REVOKED' AND revoked_at IS NOT NULL)
      )
    );

    CREATE INDEX devices_business_status
      ON devices (business_id, status, last_seen_at DESC);
    CREATE INDEX devices_user_lookup
      ON devices (app_user_id, last_seen_at DESC);

    CREATE OR REPLACE FUNCTION enroll_app_device(
      p_actor_user_id uuid,
      p_device_public_id uuid,
      p_display_name text
    )
    RETURNS devices
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_actor app_users%ROWTYPE;
      v_device devices%ROWTYPE;
      v_display_name text := left(trim(p_display_name), 120);
      v_initial_status text;
    BEGIN
      SELECT *
        INTO v_actor
        FROM app_users
       WHERE id = p_actor_user_id
         AND status = 'ACTIVE';

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Only an active user can enroll a device'
          USING ERRCODE = '42501';
      END IF;

      IF length(v_display_name) < 1 THEN
        RAISE EXCEPTION 'Enter a device name'
          USING ERRCODE = '22023';
      END IF;

      SELECT *
        INTO v_device
        FROM devices
       WHERE device_public_id = p_device_public_id
       FOR UPDATE;

      IF FOUND THEN
        IF v_device.app_user_id <> v_actor.id
          OR v_device.business_id <> v_actor.business_id
        THEN
          RAISE EXCEPTION 'This device identity belongs to another user'
            USING ERRCODE = '42501';
        END IF;

        UPDATE devices
           SET display_name = v_display_name,
               last_seen_at = now(),
               last_validated_at = CASE
                 WHEN devices.status = 'ACTIVE' THEN now()
                 ELSE devices.last_validated_at
               END
         WHERE id = v_device.id
        RETURNING * INTO v_device;

        RETURN v_device;
      END IF;

      v_initial_status := CASE
        WHEN v_actor.role = 'BUSINESS_OWNER' THEN 'ACTIVE'
        ELSE 'PENDING'
      END;

      INSERT INTO devices (
        business_id,
        app_user_id,
        device_public_id,
        display_name,
        status,
        last_validated_at,
        approved_by,
        approved_at
      )
      VALUES (
        v_actor.business_id,
        v_actor.id,
        p_device_public_id,
        v_display_name,
        v_initial_status,
        CASE WHEN v_initial_status = 'ACTIVE' THEN now() END,
        CASE WHEN v_initial_status = 'ACTIVE' THEN v_actor.id END,
        CASE WHEN v_initial_status = 'ACTIVE' THEN now() END
      )
      RETURNING * INTO v_device;

      INSERT INTO audit_events (
        business_id, actor_user_id, event_type, entity_type, entity_id, details
      )
      VALUES (
        v_actor.business_id,
        v_actor.id,
        'DEVICE_ENROLLED',
        'DEVICE',
        v_device.id,
        jsonb_build_object(
          'displayName', v_device.display_name,
          'status', v_device.status
        )
      );

      RETURN v_device;
    END;
    $$;

    CREATE OR REPLACE FUNCTION list_app_devices(p_actor_user_id uuid)
    RETURNS TABLE (
      id uuid,
      app_user_id uuid,
      device_public_id uuid,
      user_display_name text,
      user_role text,
      display_name text,
      status text,
      enrolled_at timestamptz,
      last_seen_at timestamptz,
      last_validated_at timestamptz,
      approved_at timestamptz,
      revoked_at timestamptz
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_business_id uuid;
    BEGIN
      SELECT business_id
        INTO v_business_id
        FROM app_users
       WHERE app_users.id = p_actor_user_id
         AND app_users.role = 'BUSINESS_OWNER'
         AND app_users.status = 'ACTIVE';

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Only an active business owner can view devices'
          USING ERRCODE = '42501';
      END IF;

      RETURN QUERY
      SELECT
        device.id,
        device.app_user_id,
        device.device_public_id,
        app_user.display_name,
        app_user.role,
        device.display_name,
        device.status,
        device.enrolled_at,
        device.last_seen_at,
        device.last_validated_at,
        device.approved_at,
        device.revoked_at
      FROM devices device
      JOIN app_users app_user ON app_user.id = device.app_user_id
      WHERE device.business_id = v_business_id
      ORDER BY
        CASE device.status WHEN 'PENDING' THEN 0 WHEN 'ACTIVE' THEN 1 ELSE 2 END,
        device.last_seen_at DESC;
    END;
    $$;

    CREATE OR REPLACE FUNCTION update_app_device(
      p_actor_user_id uuid,
      p_device_id uuid,
      p_action text
    )
    RETURNS devices
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_actor app_users%ROWTYPE;
      v_device devices%ROWTYPE;
      v_event_type text;
    BEGIN
      SELECT *
        INTO v_actor
        FROM app_users
       WHERE id = p_actor_user_id
         AND role = 'BUSINESS_OWNER'
         AND status = 'ACTIVE';

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Only an active business owner can manage devices'
          USING ERRCODE = '42501';
      END IF;

      IF p_action NOT IN ('APPROVE', 'REVOKE') THEN
        RAISE EXCEPTION 'Invalid device action'
          USING ERRCODE = '22023';
      END IF;

      SELECT *
        INTO v_device
        FROM devices
       WHERE id = p_device_id
         AND business_id = v_actor.business_id
       FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Device not found'
          USING ERRCODE = 'P0002';
      END IF;

      IF p_action = 'APPROVE' THEN
        IF v_device.status = 'REVOKED' THEN
          RAISE EXCEPTION 'A revoked device cannot be reactivated'
            USING ERRCODE = '55000';
        END IF;

        IF v_device.status = 'PENDING' THEN
          UPDATE devices
             SET status = 'ACTIVE',
                 approved_by = v_actor.id,
                 approved_at = now(),
                 last_validated_at = now()
           WHERE id = v_device.id
          RETURNING * INTO v_device;
          v_event_type := 'DEVICE_APPROVED';
        END IF;
      ELSE
        IF v_device.status <> 'REVOKED' THEN
          UPDATE devices
             SET status = 'REVOKED',
                 revoked_by = v_actor.id,
                 revoked_at = now()
           WHERE id = v_device.id
          RETURNING * INTO v_device;
          v_event_type := 'DEVICE_REVOKED';
        END IF;
      END IF;

      IF v_event_type IS NOT NULL THEN
        INSERT INTO audit_events (
          business_id, actor_user_id, event_type, entity_type, entity_id, details
        )
        VALUES (
          v_actor.business_id,
          v_actor.id,
          v_event_type,
          'DEVICE',
          v_device.id,
          jsonb_build_object(
            'displayName', v_device.display_name,
            'userId', v_device.app_user_id
          )
        );
      END IF;

      RETURN v_device;
    END;
    $$;

    REVOKE ALL ON FUNCTION enroll_app_device(uuid, uuid, text) FROM PUBLIC;
    REVOKE ALL ON FUNCTION list_app_devices(uuid) FROM PUBLIC;
    REVOKE ALL ON FUNCTION update_app_device(uuid, uuid, text) FROM PUBLIC;

    GRANT EXECUTE ON FUNCTION enroll_app_device(uuid, uuid, text) TO ${role};
    GRANT EXECUTE ON FUNCTION list_app_devices(uuid) TO ${role};
    GRANT EXECUTE ON FUNCTION update_app_device(uuid, uuid, text) TO ${role};
  `);
};

exports.down = false;
