import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CurrentUser } from "@/server/auth/current-user";
import type { SaleRequest } from "@/server/sale-request";

const runtimeUrl = process.env.TEST_DATABASE_URL;
const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const describeWithDatabase = runtimeUrl && migrationUrl ? describe : describe.skip;

describeWithDatabase("offline-sale owner conflict resolution", () => {
  const runtimePool = new Pool({ connectionString: runtimeUrl });
  const migrationPool = new Pool({ connectionString: migrationUrl });
  const suffix = randomUUID();
  const devicePublicId = randomUUID();
  let operator: CurrentUser;
  let owner: CurrentUser;
  let locationId: string;
  let variantId: string;
  let priceVersionId: string;
  let deviceId: string;
  let validatedAt: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = runtimeUrl;
    const business = await migrationPool.query<{ id: string }>(
      "INSERT INTO businesses (name) VALUES ($1) RETURNING id",
      [`Offline conflict ${suffix}`],
    );
    const location = await migrationPool.query<{ id: string }>(
      "SELECT id FROM locations WHERE business_id = $1",
      [business.rows[0].id],
    );
    locationId = location.rows[0].id;
    const users = await migrationPool.query<{
      id: string;
      workos_user_id: string;
      display_name: string;
      role: CurrentUser["role"];
    }>(
      `INSERT INTO app_users (
         business_id, workos_user_id, display_name, role, status
       )
       VALUES
         ($1, $2, 'Offline Operator', 'STORE_OPERATOR', 'ACTIVE'),
         ($1, $3, 'Offline Owner', 'BUSINESS_OWNER', 'ACTIVE')
       RETURNING id, workos_user_id, display_name, role`,
      [
        business.rows[0].id,
        `conflict-operator-${suffix}`,
        `conflict-owner-${suffix}`,
      ],
    );
    const [operatorRow, ownerRow] = users.rows;
    operator = {
      id: operatorRow.id,
      businessId: business.rows[0].id,
      workosUserId: operatorRow.workos_user_id,
      email: null,
      displayName: operatorRow.display_name,
      role: operatorRow.role,
    };
    owner = {
      id: ownerRow.id,
      businessId: business.rows[0].id,
      workosUserId: ownerRow.workos_user_id,
      email: null,
      displayName: ownerRow.display_name,
      role: ownerRow.role,
    };
    const product = await migrationPool.query<{ id: string }>(
      "INSERT INTO products (business_id, name) VALUES ($1, 'Offline Car') RETURNING id",
      [operator.businessId],
    );
    const variant = await migrationPool.query<{ id: string }>(
      `INSERT INTO product_variants (product_id, sku, variant_name)
       VALUES ($1, $2, 'Red') RETURNING id`,
      [product.rows[0].id, `IMT-CONFLICT-${suffix}`],
    );
    variantId = variant.rows[0].id;
    const price = await migrationPool.query<{ id: string }>(
      `INSERT INTO price_versions (
         variant_id, purchase_price_paise, mrp_paise, standard_price_paise,
         owner_floor_paise, trusted_operator_floor_paise,
         store_operator_floor_paise, effective_from, created_by
       )
       VALUES ($1, 40000, 90000, 80000, 60000, 68000, 72000, now(), $2)
       RETURNING id`,
      [variantId, owner.id],
    );
    priceVersionId = price.rows[0].id;
    await migrationPool.query(
      `INSERT INTO inventory_balances (
         location_id, variant_id, quantity_on_hand,
         inventory_value_paise, latest_landed_cost_paise
       )
       VALUES ($1, $2, 4, 160000, 40000)`,
      [locationId, variantId],
    );
    const device = await runtimePool.query<{ id: string }>(
      "SELECT id FROM enroll_app_device($1, $2, 'Operator phone')",
      [operator.id, devicePublicId],
    );
    deviceId = device.rows[0].id;
    await runtimePool.query(
      "SELECT * FROM update_app_device($1, $2, 'APPROVE')",
      [owner.id, deviceId],
    );
    const refreshed = await runtimePool.query<{ last_validated_at: Date }>(
      "SELECT last_validated_at FROM enroll_app_device($1, $2, 'Operator phone')",
      [operator.id, devicePublicId],
    );
    validatedAt = refreshed.rows[0].last_validated_at.toISOString();
  });

  afterAll(async () => {
    const { getDatabase } = await import("@/server/database");
    await getDatabase().end();
    await runtimePool.end();
    await migrationPool.end();
  });

  function payload(): SaleRequest {
    return {
      lines: [{ variantId, quantity: 2, unitPricePaise: 75_000 }],
      payments: [{ paymentMode: "UPI", amountPaise: 150_000 }],
      offline: {
        schemaVersion: 1,
        deviceId,
        devicePublicId,
        validatedAt,
        createdAt: new Date(Date.parse(validatedAt) + 1_000).toISOString(),
        catalogAsOf: validatedAt,
        lines: [{
          variantId,
          priceVersionId,
          cachedStock: 4,
          queuedBeforeQuantity: 0,
        }],
      },
    };
  }

  function display() {
    return {
      totalPaise: 150_000,
      units: 2,
      paymentMode: "UPI" as const,
      products: [{
        variantId,
        name: "Offline Car",
        sku: `IMT-CONFLICT-${suffix}`,
        quantity: 2,
      }],
    };
  }

  it("lets an owner record the exact physical sale after a price conflict", async () => {
    const {
      listOfflineSaleConflicts,
      reportOfflineSaleConflict,
      resolveOfflineSaleConflict,
    } = await import("@/server/offline-sale-conflicts");
    const commandId = randomUUID();
    const conflict = await reportOfflineSaleConflict(operator, {
      commandId,
      payload: payload(),
      display: display(),
      errorCode: "PRICE_VERSION_CHANGED",
      errorMessage: "Offline Car was repriced after this device went offline.",
    });
    await expect(reportOfflineSaleConflict(operator, {
      commandId,
      payload: payload(),
      display: display(),
      errorCode: "PRICE_VERSION_CHANGED",
      errorMessage: "Offline Car was repriced after this device went offline.",
    })).resolves.toMatchObject({ id: conflict.id });
    await expect(listOfflineSaleConflicts(owner))
      .resolves.toMatchObject([{ commandId, status: "PENDING" }]);

    await migrationPool.query(
      "UPDATE price_versions SET effective_to = now() WHERE id = $1",
      [priceVersionId],
    );
    await migrationPool.query(
      `INSERT INTO price_versions (
         variant_id, purchase_price_paise, mrp_paise, standard_price_paise,
         owner_floor_paise, trusted_operator_floor_paise,
         store_operator_floor_paise, effective_from, created_by
       )
       VALUES ($1, 45000, 100000, 90000, 70000, 80000, 85000, now(), $2)`,
      [variantId, owner.id],
    );

    const resolved = await resolveOfflineSaleConflict(owner, conflict.id, {
      action: "CONFIRM_SALE",
      note: "Checked product handover and UPI payment.",
    });
    expect(resolved).toMatchObject({
      conflict: { status: "COMPLETED", resolutionAction: "OWNER_CONFIRMED" },
    });

    const stored = await migrationPool.query<{
      created_by: string;
      unit_price_paise: string;
      quantity_on_hand: number;
      actor_user_id: string;
    }>(
      `SELECT
         sale.created_by, line.unit_price_paise, balance.quantity_on_hand,
         audit.actor_user_id
       FROM sales sale
       JOIN sale_lines line ON line.sale_id = sale.id
       JOIN inventory_balances balance ON balance.variant_id = line.variant_id
       JOIN audit_events audit
         ON audit.entity_id = $2
        AND audit.event_type = 'OFFLINE_SALE_OWNER_CONFIRMED'
       WHERE sale.command_id = $1`,
      [commandId, conflict.id],
    );
    expect(stored.rows[0]).toMatchObject({
      created_by: operator.id,
      unit_price_paise: "75000",
      quantity_on_hand: 2,
      actor_user_id: owner.id,
    });

    const { completeSale } = await import("@/server/complete-sale");
    await expect(completeSale(operator, commandId, payload()))
      .resolves.toMatchObject({ replayed: true });
  });

  it("lets an owner release the local reservation only after confirming no sale", async () => {
    const {
      listOfflineSaleConflicts,
      reportOfflineSaleConflict,
      resolveOfflineSaleConflict,
    } = await import("@/server/offline-sale-conflicts");
    const commandId = randomUUID();
    const conflict = await reportOfflineSaleConflict(operator, {
      commandId,
      payload: payload(),
      display: display(),
      errorCode: "INSUFFICIENT_STOCK",
      errorMessage: "There is not enough stock to complete this cart.",
    });
    const resolved = await resolveOfflineSaleConflict(owner, conflict.id, {
      action: "NOT_SOLD",
      note: "Checked with operator: customer did not take the product.",
    });
    expect(resolved.conflict).toMatchObject({
      status: "DISMISSED",
      resolutionAction: "NOT_SOLD",
    });
    await expect(listOfflineSaleConflicts(operator)).resolves.toContainEqual(
      expect.objectContaining({ commandId, status: "DISMISSED" }),
    );
    const sale = await migrationPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM sales WHERE command_id = $1",
      [commandId],
    );
    expect(sale.rows[0].count).toBe("0");
    const { completeSale } = await import("@/server/complete-sale");
    await expect(completeSale(operator, commandId, payload()))
      .rejects.toMatchObject({ code: "OFFLINE_SALE_DISMISSED" });
  });

  it("keeps the conflict pending when current stock cannot cover the sale", async () => {
    const {
      listOfflineSaleConflicts,
      reportOfflineSaleConflict,
      resolveOfflineSaleConflict,
    } = await import("@/server/offline-sale-conflicts");
    const commandId = randomUUID();
    const input = payload();
    input.lines[0].quantity = 3;
    input.payments[0].amountPaise = 225_000;
    input.offline!.lines[0].cachedStock = 4;
    const conflict = await reportOfflineSaleConflict(operator, {
      commandId,
      payload: input,
      display: {
        ...display(),
        totalPaise: 225_000,
        units: 3,
        products: [{ ...display().products[0], quantity: 3 }],
      },
      errorCode: "INSUFFICIENT_STOCK",
      errorMessage: "There is not enough stock to complete this cart.",
    });
    await expect(resolveOfflineSaleConflict(operator, conflict.id, {
      action: "NOT_SOLD",
      note: "Operator must not resolve this.",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(resolveOfflineSaleConflict(owner, conflict.id, {
      action: "CONFIRM_SALE",
      note: "Payment checked; stock correction still required.",
    })).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    await expect(listOfflineSaleConflicts(owner)).resolves.toContainEqual(
      expect.objectContaining({ commandId, status: "PENDING" }),
    );
  });
});
