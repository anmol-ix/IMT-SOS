import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const runtimeUrl = process.env.TEST_DATABASE_URL;
const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const describeWithDatabase = runtimeUrl && migrationUrl ? describe : describe.skip;

describeWithDatabase("database-enforced device enrollment", () => {
  const runtimePool = new Pool({ connectionString: runtimeUrl });
  const migrationPool = new Pool({ connectionString: migrationUrl });
  const suffix = randomUUID();
  const ownerPublicId = randomUUID();
  const operatorPublicId = randomUUID();
  let businessId: string;
  let ownerId: string;
  let operatorId: string;
  let operatorDeviceId: string;

  beforeAll(async () => {
    const business = await migrationPool.query<{ id: string }>(
      "INSERT INTO businesses (name) VALUES ($1) RETURNING id",
      [`Device test ${suffix}`],
    );
    businessId = business.rows[0].id;
    const users = await migrationPool.query<{ id: string; role: string }>(
      `INSERT INTO app_users (
         business_id, workos_user_id, email, display_name, role, status
       )
       VALUES
         ($1, $2, $3, 'Test Owner', 'BUSINESS_OWNER', 'ACTIVE'),
         ($1, $4, $5, 'Test Operator', 'STORE_OPERATOR', 'ACTIVE')
       RETURNING id, role`,
      [
        businessId,
        `owner-workos-${suffix}`,
        `owner-${suffix}@example.com`,
        `operator-workos-${suffix}`,
        `operator-${suffix}@example.com`,
      ],
    );
    ownerId = users.rows.find((row) => row.role === "BUSINESS_OWNER")!.id;
    operatorId = users.rows.find((row) => row.role === "STORE_OPERATOR")!.id;
  });

  afterAll(async () => {
    await runtimePool.end();
    await migrationPool.end();
  });

  it("auto-approves an owner but keeps an operator pending", async () => {
    const owner = await runtimePool.query<{ status: string }>(
      "SELECT status FROM enroll_app_device($1, $2, 'Safari on Mac')",
      [ownerId, ownerPublicId],
    );
    expect(owner.rows[0].status).toBe("ACTIVE");

    const operator = await runtimePool.query<{
      id: string;
      status: string;
      last_validated_at: Date | null;
    }>(
      "SELECT id, status, last_validated_at FROM enroll_app_device($1, $2, 'Safari on iPhone')",
      [operatorId, operatorPublicId],
    );
    expect(operator.rows[0]).toMatchObject({
      status: "PENDING",
      last_validated_at: null,
    });
    operatorDeviceId = operator.rows[0].id;
  });

  it("keeps direct device reads and writes denied to the runtime role", async () => {
    await expect(runtimePool.query("SELECT * FROM devices"))
      .rejects.toMatchObject({ code: "42501" });
    await expect(
      runtimePool.query(
        `INSERT INTO devices (
           business_id, app_user_id, device_public_id, display_name
         ) VALUES ($1, $2, $3, 'Bypass')`,
        [businessId, operatorId, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("lets only the owner approve and list devices", async () => {
    await expect(
      runtimePool.query("SELECT * FROM list_app_devices($1)", [operatorId]),
    ).rejects.toMatchObject({ code: "42501" });

    const approved = await runtimePool.query<{
      status: string;
      last_validated_at: Date | null;
    }>(
      "SELECT status, last_validated_at FROM update_app_device($1, $2, 'APPROVE')",
      [ownerId, operatorDeviceId],
    );
    expect(approved.rows[0].status).toBe("ACTIVE");
    expect(approved.rows[0].last_validated_at).toBeInstanceOf(Date);

    const devices = await runtimePool.query<{ id: string; status: string }>(
      "SELECT id, status FROM list_app_devices($1)",
      [ownerId],
    );
    expect(devices.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: operatorDeviceId, status: "ACTIVE" }),
    ]));

    const validation = await runtimePool.query<{
      status: string;
      last_validated_at: Date;
    }>(
      "SELECT * FROM validate_offline_sale_device($1, $2, $3)",
      [operatorId, operatorDeviceId, operatorPublicId],
    );
    expect(validation.rows[0].status).toBe("ACTIVE");
    expect(validation.rows[0].last_validated_at).toBeInstanceOf(Date);

    const wrongUser = await runtimePool.query(
      "SELECT * FROM validate_offline_sale_device($1, $2, $3)",
      [ownerId, operatorDeviceId, operatorPublicId],
    );
    expect(wrongUser.rowCount).toBe(0);
  });

  it("does not silently reactivate a revoked device", async () => {
    const revoked = await runtimePool.query<{ status: string }>(
      "SELECT status FROM update_app_device($1, $2, 'REVOKE')",
      [ownerId, operatorDeviceId],
    );
    expect(revoked.rows[0].status).toBe("REVOKED");

    const reenrolled = await runtimePool.query<{
      status: string;
      last_validated_at: Date | null;
    }>(
      "SELECT status, last_validated_at FROM enroll_app_device($1, $2, 'Safari on iPhone')",
      [operatorId, operatorPublicId],
    );
    expect(reenrolled.rows[0].status).toBe("REVOKED");

    await expect(
      runtimePool.query(
        "SELECT * FROM update_app_device($1, $2, 'APPROVE')",
        [ownerId, operatorDeviceId],
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });
});
