const runtimeRole = process.env.RUNTIME_DATABASE_ROLE ?? "itsmytoy_runtime";

if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole)) {
  throw new Error("RUNTIME_DATABASE_ROLE must be a safe PostgreSQL identifier");
}

const role = `"${runtimeRole}"`;

exports.up = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS claim_app_access(text, text, boolean, text, text);
    DROP FUNCTION IF EXISTS attach_workos_invitation(uuid, uuid, text);

    ALTER TABLE access_invitations
      DROP COLUMN IF EXISTS workos_invitation_id;

    ALTER TABLE app_users
      DROP COLUMN IF EXISTS workos_user_id,
      ADD COLUMN password_hash text CHECK (
        password_hash IS NULL OR length(password_hash) BETWEEN 80 AND 300
      ),
      ADD COLUMN failed_login_attempts integer NOT NULL DEFAULT 0 CHECK (
        failed_login_attempts BETWEEN 0 AND 100
      ),
      ADD COLUMN locked_until timestamptz,
      ADD COLUMN password_changed_at timestamptz;

    CREATE TABLE auth_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      token_hash char(64) NOT NULL UNIQUE CHECK (
        token_hash ~ '^[a-f0-9]{64}$'
      ),
      created_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      CHECK (expires_at > created_at)
    );

    CREATE INDEX active_auth_session_lookup
      ON auth_sessions (token_hash, expires_at)
      WHERE revoked_at IS NULL;
    CREATE INDEX auth_sessions_by_user
      ON auth_sessions (user_id, created_at DESC);

    CREATE TABLE auth_setup_tokens (
      token_hash char(64) PRIMARY KEY CHECK (
        token_hash ~ '^[a-f0-9]{64}$'
      ),
      user_id uuid REFERENCES app_users(id) ON DELETE CASCADE,
      invitation_id uuid REFERENCES access_invitations(id) ON DELETE CASCADE,
      created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      CHECK ((user_id IS NULL) <> (invitation_id IS NULL)),
      CHECK (expires_at > created_at)
    );

    CREATE INDEX active_setup_tokens_by_user
      ON auth_setup_tokens (user_id, expires_at DESC)
      WHERE used_at IS NULL;
    CREATE INDEX active_setup_tokens_by_invitation
      ON auth_setup_tokens (invitation_id, expires_at DESC)
      WHERE used_at IS NULL;

    CREATE OR REPLACE FUNCTION create_internal_auth_setup_token(
      p_actor_user_id uuid,
      p_target_user_id uuid,
      p_invitation_id uuid,
      p_token_hash text,
      p_expires_at timestamptz
    )
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_actor app_users%ROWTYPE;
    BEGIN
      SELECT *
        INTO v_actor
        FROM app_users
       WHERE id = p_actor_user_id
         AND role = 'BUSINESS_OWNER'
         AND status = 'ACTIVE';

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Only an active business owner can create setup links'
          USING ERRCODE = '42501';
      END IF;

      IF (p_target_user_id IS NULL) = (p_invitation_id IS NULL)
        OR p_token_hash !~ '^[a-f0-9]{64}$'
        OR p_expires_at <= now()
      THEN
        RAISE EXCEPTION 'Invalid setup link request'
          USING ERRCODE = '22023';
      END IF;

      IF p_target_user_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
          FROM app_users
         WHERE id = p_target_user_id
           AND business_id = v_actor.business_id
      ) THEN
        RAISE EXCEPTION 'Team member not found'
          USING ERRCODE = 'P0002';
      END IF;

      IF p_invitation_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
          FROM access_invitations
         WHERE id = p_invitation_id
           AND business_id = v_actor.business_id
           AND status = 'PENDING'
      ) THEN
        RAISE EXCEPTION 'Pending invitation not found'
          USING ERRCODE = 'P0002';
      END IF;

      UPDATE auth_setup_tokens
         SET used_at = now()
       WHERE used_at IS NULL
         AND (
           (p_target_user_id IS NOT NULL AND user_id = p_target_user_id)
           OR (p_invitation_id IS NOT NULL AND invitation_id = p_invitation_id)
         );

      INSERT INTO auth_setup_tokens (
        token_hash, user_id, invitation_id, created_by, expires_at
      )
      VALUES (
        p_token_hash, p_target_user_id, p_invitation_id, v_actor.id, p_expires_at
      );
    END;
    $$;

    CREATE OR REPLACE FUNCTION activate_internal_account(
      p_token_hash text,
      p_password_hash text
    )
    RETURNS TABLE (
      id uuid,
      business_id uuid,
      email text,
      display_name text,
      role text
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_token auth_setup_tokens%ROWTYPE;
      v_invitation access_invitations%ROWTYPE;
      v_user app_users%ROWTYPE;
    BEGIN
      IF p_token_hash !~ '^[a-f0-9]{64}$'
        OR length(p_password_hash) NOT BETWEEN 80 AND 300
      THEN
        RETURN;
      END IF;

      SELECT *
        INTO v_token
        FROM auth_setup_tokens
       WHERE token_hash = p_token_hash
         AND used_at IS NULL
         AND expires_at > now()
       FOR UPDATE;

      IF NOT FOUND THEN
        RETURN;
      END IF;

      IF v_token.user_id IS NOT NULL THEN
        SELECT *
          INTO v_user
          FROM app_users
         WHERE app_users.id = v_token.user_id
         FOR UPDATE;

        IF NOT FOUND THEN
          RETURN;
        END IF;

        UPDATE app_users
           SET password_hash = p_password_hash,
               failed_login_attempts = 0,
               locked_until = NULL,
               password_changed_at = now(),
               updated_at = now()
         WHERE app_users.id = v_user.id
        RETURNING * INTO v_user;
      ELSE
        SELECT *
          INTO v_invitation
          FROM access_invitations
         WHERE access_invitations.id = v_token.invitation_id
           AND access_invitations.status = 'PENDING'
         FOR UPDATE;

        IF NOT FOUND THEN
          RETURN;
        END IF;

        INSERT INTO app_users (
          business_id, email, display_name, role, status, password_hash,
          password_changed_at
        )
        VALUES (
          v_invitation.business_id,
          v_invitation.email,
          COALESCE(
            NULLIF(trim(v_invitation.display_name), ''),
            split_part(v_invitation.email, '@', 1)
          ),
          v_invitation.role,
          'ACTIVE',
          p_password_hash,
          now()
        )
        RETURNING * INTO v_user;

        UPDATE access_invitations
           SET status = 'ACCEPTED',
               accepted_by = v_user.id,
               accepted_at = now(),
               updated_at = now()
         WHERE access_invitations.id = v_invitation.id;
      END IF;

      UPDATE auth_setup_tokens
         SET used_at = now()
       WHERE used_at IS NULL
         AND (
           (v_token.user_id IS NOT NULL AND user_id = v_token.user_id)
           OR (
             v_token.invitation_id IS NOT NULL
             AND invitation_id = v_token.invitation_id
           )
         );

      UPDATE auth_sessions
         SET revoked_at = now()
       WHERE user_id = v_user.id
         AND revoked_at IS NULL;

      INSERT INTO audit_events (
        business_id, actor_user_id, event_type, entity_type, entity_id, details
      )
      VALUES (
        v_user.business_id,
        v_user.id,
        CASE
          WHEN v_invitation.id IS NULL THEN 'TEAM_PASSWORD_CONFIGURED'
          ELSE 'TEAM_INVITATION_ACCEPTED'
        END,
        'APP_USER',
        v_user.id,
        jsonb_build_object('email', v_user.email)
      );

      RETURN QUERY
      SELECT v_user.id, v_user.business_id, v_user.email,
             v_user.display_name, v_user.role;
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

      UPDATE auth_setup_tokens
         SET used_at = now()
       WHERE invitation_id = v_invitation.id
         AND used_at IS NULL;

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

    CREATE OR REPLACE FUNCTION revoke_sessions_for_disabled_user()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    BEGIN
      IF NEW.status <> 'ACTIVE' AND OLD.status = 'ACTIVE' THEN
        UPDATE auth_sessions
           SET revoked_at = now()
         WHERE user_id = NEW.id
           AND revoked_at IS NULL;
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER revoke_sessions_when_user_disabled
      AFTER UPDATE OF status ON app_users
      FOR EACH ROW
      EXECUTE FUNCTION revoke_sessions_for_disabled_user();

    REVOKE ALL ON auth_sessions, auth_setup_tokens FROM PUBLIC;
    REVOKE ALL ON FUNCTION create_internal_auth_setup_token(
      uuid, uuid, uuid, text, timestamptz
    ) FROM PUBLIC;
    REVOKE ALL ON FUNCTION activate_internal_account(text, text) FROM PUBLIC;

    GRANT SELECT ON app_users TO ${role};
    GRANT UPDATE (
      failed_login_attempts, locked_until, updated_at
    ) ON app_users TO ${role};
    GRANT SELECT, INSERT, DELETE ON auth_sessions TO ${role};
    GRANT UPDATE (last_seen_at, revoked_at) ON auth_sessions TO ${role};
    GRANT EXECUTE ON FUNCTION create_internal_auth_setup_token(
      uuid, uuid, uuid, text, timestamptz
    ) TO ${role};
    GRANT EXECUTE ON FUNCTION activate_internal_account(text, text) TO ${role};
  `);
};

exports.down = false;
