const runtimeRole = process.env.RUNTIME_DATABASE_ROLE ?? "itsmytoy_runtime";

if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole)) {
  throw new Error("RUNTIME_DATABASE_ROLE must be a safe PostgreSQL identifier");
}

const role = `"${runtimeRole}"`;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE app_users
      ADD COLUMN email text CHECK (
        email IS NULL OR length(trim(email)) BETWEEN 3 AND 320
      );

    CREATE UNIQUE INDEX app_users_business_email
      ON app_users (business_id, lower(email))
      WHERE email IS NOT NULL;

    CREATE TABLE access_invitations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id),
      email text NOT NULL CHECK (
        email = lower(trim(email))
        AND length(email) BETWEEN 3 AND 320
      ),
      display_name text CHECK (
        display_name IS NULL OR length(trim(display_name)) BETWEEN 1 AND 120
      ),
      role text NOT NULL CHECK (
        role IN ('BUSINESS_OWNER', 'TRUSTED_OPERATOR', 'STORE_OPERATOR')
      ),
      status text NOT NULL DEFAULT 'PENDING' CHECK (
        status IN ('PENDING', 'ACCEPTED', 'REVOKED')
      ),
      invited_by uuid REFERENCES app_users(id),
      accepted_by uuid REFERENCES app_users(id),
      workos_invitation_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      accepted_at timestamptz,
      revoked_at timestamptz,
      CHECK (
        (status = 'ACCEPTED') = (accepted_by IS NOT NULL AND accepted_at IS NOT NULL)
      ),
      CHECK (
        (status = 'REVOKED') = (revoked_at IS NOT NULL)
      )
    );

    CREATE UNIQUE INDEX one_pending_access_invitation_per_email
      ON access_invitations (business_id, lower(email))
      WHERE status = 'PENDING';
    CREATE INDEX access_invitation_lookup
      ON access_invitations (lower(email), status, created_at DESC);

    CREATE OR REPLACE FUNCTION claim_app_access(
      p_workos_user_id text,
      p_email text,
      p_email_verified boolean,
      p_display_name text,
      p_business_name text
    )
    RETURNS TABLE (
      id uuid,
      business_id uuid,
      workos_user_id text,
      email text,
      display_name text,
      role text
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_user app_users%ROWTYPE;
      v_invitation access_invitations%ROWTYPE;
      v_business_id uuid;
      v_email text := lower(trim(p_email));
      v_display_name text := left(trim(p_display_name), 120);
      v_business_name text := left(trim(p_business_name), 120);
    BEGIN
      IF NOT p_email_verified
        OR length(trim(p_workos_user_id)) < 3
        OR length(v_email) NOT BETWEEN 3 AND 320
        OR length(v_display_name) < 1
        OR length(v_business_name) < 1
      THEN
        RETURN;
      END IF;

      SELECT *
        INTO v_user
        FROM app_users
       WHERE app_users.workos_user_id = p_workos_user_id
       FOR UPDATE;

      IF FOUND THEN
        IF v_user.status <> 'ACTIVE' THEN
          RETURN;
        END IF;

        IF v_user.email IS NULL OR lower(v_user.email) = v_email THEN
          UPDATE app_users
             SET email = COALESCE(app_users.email, v_email),
                 updated_at = now()
           WHERE app_users.id = v_user.id
          RETURNING * INTO v_user;
        END IF;

        RETURN QUERY
        SELECT v_user.id, v_user.business_id, v_user.workos_user_id,
               v_user.email, v_user.display_name, v_user.role;
        RETURN;
      END IF;

      SELECT *
        INTO v_invitation
        FROM access_invitations
       WHERE lower(access_invitations.email) = v_email
         AND access_invitations.status = 'PENDING'
       ORDER BY
         CASE WHEN access_invitations.role = 'BUSINESS_OWNER' THEN 0 ELSE 1 END,
         access_invitations.created_at
       LIMIT 1
       FOR UPDATE SKIP LOCKED;

      IF NOT FOUND THEN
        PERFORM pg_advisory_xact_lock(hashtext('itsmytoy-first-owner'));

        IF EXISTS (SELECT 1 FROM app_users)
          OR EXISTS (
            SELECT 1
              FROM access_invitations
             WHERE status = 'PENDING'
          )
        THEN
          RETURN;
        END IF;

        INSERT INTO businesses (name)
        VALUES (v_business_name)
        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
        RETURNING businesses.id INTO v_business_id;

        INSERT INTO app_users (
          business_id, workos_user_id, email, display_name, role, status
        )
        VALUES (
          v_business_id,
          p_workos_user_id,
          v_email,
          v_display_name,
          'BUSINESS_OWNER',
          'ACTIVE'
        )
        RETURNING * INTO v_user;

        INSERT INTO audit_events (
          business_id, actor_user_id, event_type, entity_type, entity_id, details
        )
        VALUES (
          v_user.business_id,
          v_user.id,
          'INITIAL_OWNER_CLAIMED',
          'APP_USER',
          v_user.id,
          jsonb_build_object('email', v_email)
        );

        RETURN QUERY
        SELECT v_user.id, v_user.business_id, v_user.workos_user_id,
               v_user.email, v_user.display_name, v_user.role;
        RETURN;
      END IF;

      INSERT INTO app_users (
        business_id, workos_user_id, email, display_name, role, status
      )
      VALUES (
        v_invitation.business_id,
        p_workos_user_id,
        v_email,
        COALESCE(NULLIF(trim(v_invitation.display_name), ''), v_display_name),
        v_invitation.role,
        'ACTIVE'
      )
      RETURNING * INTO v_user;

      UPDATE access_invitations
         SET status = 'ACCEPTED',
             accepted_by = v_user.id,
             accepted_at = now(),
             updated_at = now()
       WHERE access_invitations.id = v_invitation.id;

      INSERT INTO audit_events (
        business_id, actor_user_id, event_type, entity_type, entity_id, details
      )
      VALUES (
        v_user.business_id,
        v_user.id,
        'TEAM_INVITATION_ACCEPTED',
        'APP_USER',
        v_user.id,
        jsonb_build_object(
          'email', v_email,
          'role', v_user.role,
          'invitationId', v_invitation.id
        )
      );

      RETURN QUERY
      SELECT v_user.id, v_user.business_id, v_user.workos_user_id,
             v_user.email, v_user.display_name, v_user.role;
    END;
    $$;

    CREATE OR REPLACE FUNCTION create_app_access_invitation(
      p_actor_user_id uuid,
      p_email text,
      p_display_name text,
      p_role text
    )
    RETURNS access_invitations
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_actor app_users%ROWTYPE;
      v_invitation access_invitations%ROWTYPE;
      v_email text := lower(trim(p_email));
      v_display_name text := NULLIF(trim(p_display_name), '');
    BEGIN
      SELECT *
        INTO v_actor
        FROM app_users
       WHERE app_users.id = p_actor_user_id
         AND app_users.role = 'BUSINESS_OWNER'
         AND app_users.status = 'ACTIVE';

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Only an active business owner can invite team members'
          USING ERRCODE = '42501';
      END IF;

      IF p_role NOT IN ('TRUSTED_OPERATOR', 'STORE_OPERATOR') THEN
        RAISE EXCEPTION 'Only operator roles can be invited from the application'
          USING ERRCODE = '22023';
      END IF;

      IF length(v_email) NOT BETWEEN 3 AND 320 OR position('@' IN v_email) < 2 THEN
        RAISE EXCEPTION 'Enter a valid email address'
          USING ERRCODE = '22023';
      END IF;

      IF EXISTS (
        SELECT 1
          FROM app_users
         WHERE app_users.business_id = v_actor.business_id
           AND lower(app_users.email) = v_email
      ) THEN
        RAISE EXCEPTION 'This email already belongs to a team member'
          USING ERRCODE = '23505';
      END IF;

      INSERT INTO access_invitations (
        business_id, email, display_name, role, invited_by
      )
      VALUES (
        v_actor.business_id, v_email, v_display_name, p_role, v_actor.id
      )
      RETURNING * INTO v_invitation;

      INSERT INTO audit_events (
        business_id, actor_user_id, event_type, entity_type, entity_id, details
      )
      VALUES (
        v_actor.business_id,
        v_actor.id,
        'TEAM_INVITATION_CREATED',
        'ACCESS_INVITATION',
        v_invitation.id,
        jsonb_build_object('email', v_email, 'role', p_role)
      );

      RETURN v_invitation;
    END;
    $$;

    CREATE OR REPLACE FUNCTION attach_workos_invitation(
      p_actor_user_id uuid,
      p_invitation_id uuid,
      p_workos_invitation_id text
    )
    RETURNS void
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
       WHERE id = p_actor_user_id
         AND role = 'BUSINESS_OWNER'
         AND status = 'ACTIVE';

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Only an active business owner can update invitations'
          USING ERRCODE = '42501';
      END IF;

      UPDATE access_invitations
         SET workos_invitation_id = p_workos_invitation_id,
             updated_at = now()
       WHERE id = p_invitation_id
         AND business_id = v_business_id
         AND status = 'PENDING';

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Pending invitation not found'
          USING ERRCODE = 'P0002';
      END IF;
    END;
    $$;

    CREATE OR REPLACE FUNCTION revoke_app_access_invitation(
      p_actor_user_id uuid,
      p_invitation_id uuid,
      p_reason text DEFAULT 'OWNER_REVOKED'
    )
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_actor app_users%ROWTYPE;
      v_invitation access_invitations%ROWTYPE;
    BEGIN
      SELECT *
        INTO v_actor
        FROM app_users
       WHERE id = p_actor_user_id
         AND role = 'BUSINESS_OWNER'
         AND status = 'ACTIVE';

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Only an active business owner can revoke invitations'
          USING ERRCODE = '42501';
      END IF;

      UPDATE access_invitations
         SET status = 'REVOKED',
             revoked_at = now(),
             updated_at = now()
       WHERE id = p_invitation_id
         AND business_id = v_actor.business_id
         AND status = 'PENDING'
      RETURNING * INTO v_invitation;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Pending invitation not found'
          USING ERRCODE = 'P0002';
      END IF;

      INSERT INTO audit_events (
        business_id, actor_user_id, event_type, entity_type, entity_id, details
      )
      VALUES (
        v_actor.business_id,
        v_actor.id,
        'TEAM_INVITATION_REVOKED',
        'ACCESS_INVITATION',
        v_invitation.id,
        jsonb_build_object(
          'email', v_invitation.email,
          'role', v_invitation.role,
          'reason', p_reason
        )
      );
    END;
    $$;

    CREATE OR REPLACE FUNCTION update_app_team_member(
      p_actor_user_id uuid,
      p_target_user_id uuid,
      p_role text,
      p_status text
    )
    RETURNS app_users
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_actor app_users%ROWTYPE;
      v_before app_users%ROWTYPE;
      v_after app_users%ROWTYPE;
    BEGIN
      SELECT *
        INTO v_actor
        FROM app_users
       WHERE id = p_actor_user_id
         AND role = 'BUSINESS_OWNER'
         AND status = 'ACTIVE';

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Only an active business owner can manage team access'
          USING ERRCODE = '42501';
      END IF;

      SELECT *
        INTO v_before
        FROM app_users
       WHERE id = p_target_user_id
         AND business_id = v_actor.business_id
       FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Team member not found'
          USING ERRCODE = 'P0002';
      END IF;

      IF v_before.id = v_actor.id OR v_before.role = 'BUSINESS_OWNER' THEN
        RAISE EXCEPTION 'Owner access cannot be changed from this screen'
          USING ERRCODE = '42501';
      END IF;

      IF p_role NOT IN ('TRUSTED_OPERATOR', 'STORE_OPERATOR')
        OR p_status NOT IN ('ACTIVE', 'DISABLED')
      THEN
        RAISE EXCEPTION 'Invalid team access setting'
          USING ERRCODE = '22023';
      END IF;

      UPDATE app_users
         SET role = p_role,
             status = p_status,
             updated_at = now()
       WHERE id = v_before.id
      RETURNING * INTO v_after;

      INSERT INTO audit_events (
        business_id, actor_user_id, event_type, entity_type, entity_id, details
      )
      VALUES (
        v_actor.business_id,
        v_actor.id,
        'TEAM_MEMBER_ACCESS_CHANGED',
        'APP_USER',
        v_after.id,
        jsonb_build_object(
          'oldRole', v_before.role,
          'newRole', v_after.role,
          'oldStatus', v_before.status,
          'newStatus', v_after.status
        )
      );

      RETURN v_after;
    END;
    $$;

    REVOKE ALL ON FUNCTION claim_app_access(text, text, boolean, text, text) FROM PUBLIC;
    REVOKE ALL ON FUNCTION create_app_access_invitation(uuid, text, text, text) FROM PUBLIC;
    REVOKE ALL ON FUNCTION attach_workos_invitation(uuid, uuid, text) FROM PUBLIC;
    REVOKE ALL ON FUNCTION revoke_app_access_invitation(uuid, uuid, text) FROM PUBLIC;
    REVOKE ALL ON FUNCTION update_app_team_member(uuid, uuid, text, text) FROM PUBLIC;

    GRANT SELECT ON access_invitations TO ${role};
    GRANT EXECUTE ON FUNCTION claim_app_access(text, text, boolean, text, text) TO ${role};
    GRANT EXECUTE ON FUNCTION create_app_access_invitation(uuid, text, text, text) TO ${role};
    GRANT EXECUTE ON FUNCTION attach_workos_invitation(uuid, uuid, text) TO ${role};
    GRANT EXECUTE ON FUNCTION revoke_app_access_invitation(uuid, uuid, text) TO ${role};
    GRANT EXECUTE ON FUNCTION update_app_team_member(uuid, uuid, text, text) TO ${role};
  `);
};

exports.down = false;
