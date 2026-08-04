import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const runtimeUrl = process.env.TEST_DATABASE_URL;
const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const describeWithDatabase = runtimeUrl && migrationUrl ? describe : describe.skip;

describeWithDatabase("database-enforced internal authentication", () => {
  const runtimePool = new Pool({ connectionString: runtimeUrl });
  const migrationPool = new Pool({ connectionString: migrationUrl });
  const suffix = randomUUID();
  const ownerEmail = `owner-${suffix}@example.com`;
  const operatorEmail = `operator-${suffix}@example.com`;
  let businessId: string;
  let ownerId: string;
  let operatorId: string;

  beforeAll(async () => {
    const business = await migrationPool.query<{ id: string }>(
      "INSERT INTO businesses (name) VALUES ($1) RETURNING id",
      [`Access test ${suffix}`],
    );
    businessId = business.rows[0].id;
    const owner = await migrationPool.query<{ id: string }>(
      `INSERT INTO app_users (
         business_id, email, display_name, role, status, password_hash
       )
       VALUES ($1, $2, 'Test Owner', 'BUSINESS_OWNER', 'ACTIVE', $3)
       RETURNING id`,
      [businessId, ownerEmail, "x".repeat(80)],
    );
    ownerId = owner.rows[0].id;
  });

  afterAll(async () => {
    await runtimePool.end();
    await migrationPool.end();
  });

  it("creates an active Main Store for every new business", async () => {
    const location = await migrationPool.query<{
      name: string;
      timezone: string;
      status: string;
    }>(
      `SELECT name, timezone, status
         FROM locations
        WHERE business_id = $1`,
      [businessId],
    );

    expect(location.rows).toEqual([{
      name: "Main Store",
      timezone: "Asia/Kolkata",
      status: "ACTIVE",
    }]);
  });

  it("keeps direct user writes denied to the runtime role", async () => {
    await expect(
      runtimePool.query(
        `INSERT INTO app_users (
           business_id, email, display_name, role
         )
         VALUES ($1, $2, 'Bypass', 'BUSINESS_OWNER')`,
        [businessId, `bypass-${suffix}@example.com`],
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("activates only a pending invitation with its one-time setup token", async () => {
    const invitation = await runtimePool.query<{ id: string }>(
      `SELECT * FROM create_app_access_invitation(
         $1, $2, 'Test Operator', 'STORE_OPERATOR'
       )`,
      [ownerId, operatorEmail],
    );
    const tokenHash = createHash("sha256")
      .update(`setup-${suffix}`)
      .digest("hex");
    await runtimePool.query(
      `SELECT create_internal_auth_setup_token(
         $1, NULL, $2, $3, now() + interval '1 hour'
       )`,
      [ownerId, invitation.rows[0].id, tokenHash],
    );

    const activated = await runtimePool.query<{
      id: string;
      role: string;
      email: string;
    }>(
      "SELECT * FROM activate_internal_account($1, $2)",
      [tokenHash, "y".repeat(80)],
    );
    expect(activated.rows[0]).toMatchObject({
      role: "STORE_OPERATOR",
      email: operatorEmail,
    });
    operatorId = activated.rows[0].id;

    const replay = await runtimePool.query(
      "SELECT * FROM activate_internal_account($1, $2)",
      [tokenHash, "z".repeat(80)],
    );
    expect(replay.rowCount).toBe(0);
  });

  it("revokes active sessions when an owner disables a member", async () => {
    const tokenHash = createHash("sha256")
      .update(`session-${suffix}`)
      .digest("hex");
    await runtimePool.query(
      `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '1 day')`,
      [operatorId, tokenHash],
    );
    const changed = await runtimePool.query<{ role: string; status: string }>(
      `SELECT role, status
         FROM update_app_team_member(
           $1, $2, 'TRUSTED_OPERATOR', 'DISABLED'
         )`,
      [ownerId, operatorId],
    );
    expect(changed.rows[0]).toEqual({
      role: "TRUSTED_OPERATOR",
      status: "DISABLED",
    });
    const session = await migrationPool.query<{ revoked: boolean }>(
      `SELECT revoked_at IS NOT NULL AS revoked
         FROM auth_sessions
        WHERE token_hash = $1`,
      [tokenHash],
    );
    expect(session.rows[0].revoked).toBe(true);
  });

  it("protects the owner account from access changes", async () => {
    await expect(
      runtimePool.query(
        `SELECT * FROM update_app_team_member(
          $1, $1, 'STORE_OPERATOR', 'DISABLED'
        )`,
        [ownerId],
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
