import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const runtimeUrl = process.env.TEST_DATABASE_URL;
const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const describeWithDatabase = runtimeUrl && migrationUrl ? describe : describe.skip;

describeWithDatabase("database-enforced team access", () => {
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
    await migrationPool.query(
      `INSERT INTO access_invitations (business_id, email, role)
       VALUES ($1, $2, 'BUSINESS_OWNER')`,
      [businessId, ownerEmail],
    );
  });

  afterAll(async () => {
    await runtimePool.end();
    await migrationPool.end();
  });

  it("claims only a verified, pre-approved owner email", async () => {
    const rejected = await runtimePool.query(
      "SELECT * FROM claim_app_access($1, $2, false, 'Test Owner', $3)",
      [`workos-${suffix}`, ownerEmail, `Access test ${suffix}`],
    );
    expect(rejected.rowCount).toBe(0);

    const claimed = await runtimePool.query<{
      id: string;
      role: string;
      email: string;
    }>(
      "SELECT * FROM claim_app_access($1, $2, true, 'Test Owner', $3)",
      [`workos-${suffix}`, ownerEmail, `Access test ${suffix}`],
    );
    expect(claimed.rows[0]).toMatchObject({
      role: "BUSINESS_OWNER",
      email: ownerEmail,
    });
    ownerId = claimed.rows[0].id;
  });

  it("keeps direct user writes denied to the runtime role", async () => {
    await expect(
      runtimePool.query(
        `INSERT INTO app_users (
           business_id, workos_user_id, email, display_name, role
         )
         VALUES ($1, $2, $3, 'Bypass', 'BUSINESS_OWNER')`,
        [businessId, `bypass-${suffix}`, `bypass-${suffix}@example.com`],
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("lets the owner invite and control an operator through narrow functions", async () => {
    await expect(
      runtimePool.query(
        `SELECT * FROM create_app_access_invitation(
          $1, $2, '', 'BUSINESS_OWNER'
        )`,
        [ownerId, `other-owner-${suffix}@example.com`],
      ),
    ).rejects.toMatchObject({ code: "22023" });

    const invitation = await runtimePool.query<{ id: string }>(
      `SELECT * FROM create_app_access_invitation(
         $1, $2, 'Test Operator', 'STORE_OPERATOR'
       )`,
      [ownerId, operatorEmail],
    );
    expect(invitation.rows[0].id).toBeTruthy();

    const claimed = await runtimePool.query<{
      id: string;
      role: string;
      email: string;
    }>(
      "SELECT * FROM claim_app_access($1, $2, true, 'OAuth Name', $3)",
      [`operator-workos-${suffix}`, operatorEmail, `Access test ${suffix}`],
    );
    expect(claimed.rows[0]).toMatchObject({
      role: "STORE_OPERATOR",
      email: operatorEmail,
    });
    operatorId = claimed.rows[0].id;

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

    const disabledClaim = await runtimePool.query(
      "SELECT * FROM claim_app_access($1, $2, true, 'Test Operator', $3)",
      [`operator-workos-${suffix}`, operatorEmail, `Access test ${suffix}`],
    );
    expect(disabledClaim.rowCount).toBe(0);
  });

  it("protects the owner and records access changes", async () => {
    await expect(
      runtimePool.query(
        `SELECT * FROM update_app_team_member(
          $1, $1, 'STORE_OPERATOR', 'DISABLED'
        )`,
        [ownerId],
      ),
    ).rejects.toMatchObject({ code: "42501" });

    const audits = await migrationPool.query<{ event_type: string }>(
      `SELECT event_type
         FROM audit_events
        WHERE business_id = $1
        ORDER BY created_at`,
      [businessId],
    );
    expect(audits.rows.map((row) => row.event_type)).toEqual([
      "TEAM_INVITATION_ACCEPTED",
      "TEAM_INVITATION_CREATED",
      "TEAM_INVITATION_ACCEPTED",
      "TEAM_MEMBER_ACCESS_CHANGED",
    ]);
  });
});
