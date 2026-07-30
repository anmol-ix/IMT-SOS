import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/server/auth/current-user";

const runtimeUrl = process.env.TEST_DATABASE_URL;
const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const describeWithDatabase = runtimeUrl && migrationUrl ? describe : describe.skip;

const inventoryCsv = `Inventory Master
SKU,Item Name,Category,Sub-category,Entry Type,Brand,PP (₹),SP (₹),MRP (₹),Opening Qty,Purchased Qty,Sold Qty,On Hand Qty,Sales Value (Actual ₹),Last Sold Date,Notes
IMT-CAR-RC-0001,Stunt Car,Toys,Remote,Single Item,,100,200,250,2,1,1,2,,,`;
const salesCsv = `
Date,Sale ID,Customer Name,Contact Number,SKU,Item Name,Qty Sold,MRP (₹),PP (₹),Standard S.Price (₹),Actual S.Price (₹),Gross Sales (₹),Customer Discount (₹),Actual Discount (₹),Actual Discount %age,Profit (₹),Payment Mode,Channel,Notes
28/07/2026,S-0001,Anmol,9876543210,IMT-CAR-RC-0001,Stunt Car,1,250,100,200,180,180,,,,80,Cash,Store Walk-in,`;
const customersCsv = `
Customer ID,Customer Name,Phone Number,WhatsApp Number,Email,Child Name,Child Birthday,Child Age,Address,Area / Locality,Source,First Visit Date,Last Purchase Date,Purchase Lines,Total Spend (₹),Notes,Status
CUS-0001,Anmol,9876543210,,,,,,,Sunny Enclave,Store Walk-in,,,,,,Active`;

describeWithDatabase("workbook validation persistence", () => {
  const runtimePool = new Pool({ connectionString: runtimeUrl });
  const migrationPool = new Pool({ connectionString: migrationUrl });
  let owner: CurrentUser;
  let operator: CurrentUser;
  let storedBatchId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = runtimeUrl;
    const business = await migrationPool.query<{ id: string }>(
      "INSERT INTO businesses (name) VALUES ($1) RETURNING id",
      [`Workbook import ${randomUUID()}`],
    );
    const users = await migrationPool.query<{
      id: string;
      display_name: string;
      role: CurrentUser["role"];
    }>(
      `INSERT INTO app_users (
         business_id, display_name, role, status
       )
       VALUES
         ($1, 'Import Owner', 'BUSINESS_OWNER', 'ACTIVE'),
         ($1, 'Import Operator', 'STORE_OPERATOR', 'ACTIVE')
       RETURNING id, display_name, role`,
      [business.rows[0].id],
    );
    owner = {
      id: users.rows[0].id,
      businessId: business.rows[0].id,
      email: null,
      displayName: users.rows[0].display_name,
      role: users.rows[0].role,
    };
    operator = {
      id: users.rows[1].id,
      businessId: business.rows[0].id,
      email: null,
      displayName: users.rows[1].display_name,
      role: users.rows[1].role,
    };
  });

  afterAll(async () => {
    const { getDatabase } = await import("@/server/database");
    await getDatabase().end();
    await runtimePool.end();
    await migrationPool.end();
  });

  it("stores one immutable report for repeated matching snapshots", async () => {
    const {
      createWorkbookValidation,
      getWorkbookReport,
      listWorkbookBatches,
    } = await import("@/server/workbook-import");
    const files = [
      { sheet: "Inventory Master" as const, name: "Inventory Master.csv", content: inventoryCsv },
      { sheet: "Sales Log" as const, name: "Sales Log.csv", content: salesCsv },
      { sheet: "Customers" as const, name: "Customers.csv", content: customersCsv },
    ];
    const first = await createWorkbookValidation(owner, files);
    storedBatchId = first.batch.id;
    const replay = await createWorkbookValidation(owner, files);

    expect(replay.batch.id).toBe(first.batch.id);
    await expect(listWorkbookBatches(owner)).resolves.toHaveLength(1);
    await expect(getWorkbookReport(owner, first.batch.id)).resolves.toMatchObject({
      batch: {
        reconciliation: {
          accepted: { products: 1, saleLines: 1, customers: 1 },
          quarantined: 0,
        },
      },
    });

    const stored = await migrationPool.query<{
      rows: number;
      audit_events: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM import_rows WHERE batch_id = $1) AS rows,
         (SELECT count(*)::int FROM audit_events
           WHERE entity_id = $1 AND event_type = 'WORKBOOK_SNAPSHOT_VALIDATED') AS audit_events`,
      [first.batch.id],
    );
    expect(stored.rows[0]).toEqual({ rows: 3, audit_events: 1 });
  });

  it("denies validation and report access to an operator", async () => {
    const {
      createWorkbookValidation,
      listWorkbookBatches,
    } = await import("@/server/workbook-import");
    await expect(listWorkbookBatches(operator)).rejects.toMatchObject({ status: 403 });
    await expect(createWorkbookValidation(operator, [
      { sheet: "Inventory Master", name: "Inventory Master.csv", content: inventoryCsv },
      { sheet: "Sales Log", name: "Sales Log.csv", content: salesCsv },
      { sheet: "Customers", name: "Customers.csv", content: customersCsv },
    ])).rejects.toMatchObject({ status: 403 });
  });

  it("keeps staged evidence immutable for the runtime database role", async () => {
    await expect(runtimePool.query(
      "UPDATE import_batches SET status = 'VALIDATED' WHERE id = $1",
      [storedBatchId],
    )).rejects.toMatchObject({ code: "42501" });
    await expect(runtimePool.query(
      "DELETE FROM import_rows WHERE batch_id = $1",
      [storedBatchId],
    )).rejects.toMatchObject({ code: "42501" });
  });

  it("keeps production uploads locked until the safety gate is enabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WORKBOOK_VALIDATION_ENABLED", "0");
    try {
      const { createWorkbookValidation } = await import("@/server/workbook-import");
      await expect(createWorkbookValidation(owner, [
        { sheet: "Inventory Master", name: "Inventory Master.csv", content: inventoryCsv },
        { sheet: "Sales Log", name: "Sales Log.csv", content: salesCsv },
        { sheet: "Customers", name: "Customers.csv", content: customersCsv },
      ])).rejects.toMatchObject({
        status: 503,
        code: "WORKBOOK_VALIDATION_DISABLED",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
