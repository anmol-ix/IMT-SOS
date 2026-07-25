import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  IdempotencyConflictError,
  recordProofCommand,
} from "@/server/proof-command";

const runtimeUrl = process.env.TEST_DATABASE_URL;
const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const describeWithDatabase = runtimeUrl && migrationUrl ? describe : describe.skip;

describeWithDatabase("idempotent PostgreSQL command", () => {
  const runtimePool = new Pool({ connectionString: runtimeUrl, max: 12 });
  const migrationPool = new Pool({ connectionString: migrationUrl });
  let actorUserId: string;

  const transaction = async <T>(work: (client: PoolClient) => Promise<T>) => {
    const client = await runtimePool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };

  beforeAll(async () => {
    const business = await migrationPool.query<{ id: string }>(
      "INSERT INTO businesses (name) VALUES ($1) RETURNING id",
      [`Integration ${randomUUID()}`],
    );
    const user = await migrationPool.query<{ id: string }>(
      `INSERT INTO app_users (business_id, workos_user_id, display_name, role, status)
       VALUES ($1, $2, 'Test Owner', 'BUSINESS_OWNER', 'ACTIVE')
       RETURNING id`,
      [business.rows[0].id, `workos_${randomUUID()}`],
    );
    actorUserId = user.rows[0].id;
  });

  afterAll(async () => {
    await runtimePool.end();
    await migrationPool.end();
  });

  it("returns the original result when the same command is replayed concurrently", async () => {
    const commandId = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        recordProofCommand(actorUserId, commandId, { note: "same request" }, transaction),
      ),
    );

    expect(new Set(results.map((result) => JSON.stringify(result))).size).toBe(1);
    const count = await runtimePool.query<{ count: string }>(
      "SELECT count(*) FROM walking_skeleton_commands WHERE command_id = $1",
      [commandId],
    );
    expect(count.rows[0].count).toBe("1");
  });

  it("rejects reuse of an idempotency key for a different request", async () => {
    const commandId = randomUUID();
    await recordProofCommand(actorUserId, commandId, { note: "first" }, transaction);

    await expect(
      recordProofCommand(actorUserId, commandId, { note: "changed" }, transaction),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("keeps the runtime database role least-privileged", async () => {
    const privileges = await runtimePool.query<{
      can_read_users: boolean;
      can_change_users: boolean;
      can_insert_commands: boolean;
      can_change_commands: boolean;
      can_read_movements: boolean;
      can_change_movements: boolean;
      can_insert_adjustments: boolean;
      can_delete_adjustments: boolean;
      can_change_audit: boolean;
    }>(`
      SELECT
        has_table_privilege(current_user, 'app_users', 'SELECT') AS can_read_users,
        has_table_privilege(current_user, 'app_users', 'INSERT,UPDATE,DELETE') AS can_change_users,
        has_table_privilege(current_user, 'walking_skeleton_commands', 'INSERT') AS can_insert_commands,
        has_table_privilege(current_user, 'walking_skeleton_commands', 'UPDATE,DELETE') AS can_change_commands,
        has_table_privilege(current_user, 'inventory_movements', 'SELECT') AS can_read_movements,
        has_table_privilege(current_user, 'inventory_movements', 'UPDATE,DELETE') AS can_change_movements,
        has_table_privilege(current_user, 'stock_adjustments', 'INSERT') AS can_insert_adjustments,
        has_table_privilege(current_user, 'stock_adjustments', 'DELETE') AS can_delete_adjustments,
        has_table_privilege(current_user, 'audit_events', 'UPDATE,DELETE') AS can_change_audit
    `);

    expect(privileges.rows[0]).toEqual({
      can_read_users: true,
      can_change_users: false,
      can_insert_commands: true,
      can_change_commands: false,
      can_read_movements: true,
      can_change_movements: false,
      can_insert_adjustments: true,
      can_delete_adjustments: false,
      can_change_audit: false,
    });
  });
});
