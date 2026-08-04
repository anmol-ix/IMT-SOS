import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CurrentUser } from "@/server/auth/current-user";

const runtimeUrl = process.env.TEST_DATABASE_URL;
const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const describeWithDatabase = runtimeUrl && migrationUrl ? describe : describe.skip;

describeWithDatabase("queued offline sale synchronization", () => {
  const runtimePool = new Pool({ connectionString: runtimeUrl });
  const migrationPool = new Pool({ connectionString: migrationUrl });
  const suffix = randomUUID();
  const devicePublicId = randomUUID();
  let user: CurrentUser;
  let locationId: string;
  let variantId: string;
  let priceVersionId: string;
  let deviceId: string;
  let validatedAt: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = runtimeUrl;
    const business = await migrationPool.query<{ id: string }>(
      "INSERT INTO businesses (name) VALUES ($1) RETURNING id",
      [`Offline sale sync ${suffix}`],
    );
    const location = await migrationPool.query<{ id: string }>(
      "SELECT id FROM locations WHERE business_id = $1",
      [business.rows[0].id],
    );
    locationId = location.rows[0].id;
    const actor = await migrationPool.query<{ id: string }>(
      `INSERT INTO app_users (
         business_id, email, display_name, role, status
       )
       VALUES ($1, $2, 'Offline Operator', 'STORE_OPERATOR', 'ACTIVE')
       RETURNING id`,
      [
        business.rows[0].id,
        `offline-sale-${suffix}@example.com`,
      ],
    );
    user = {
      id: actor.rows[0].id,
      businessId: business.rows[0].id,
      email: `offline-sale-${suffix}@example.com`,
      displayName: "Offline Operator",
      role: "STORE_OPERATOR",
    };
    const product = await migrationPool.query<{ id: string }>(
      "INSERT INTO products (business_id, name) VALUES ($1, 'Queued Car') RETURNING id",
      [user.businessId],
    );
    const variant = await migrationPool.query<{ id: string }>(
      `INSERT INTO product_variants (product_id, sku, variant_name)
       VALUES ($1, $2, 'Blue') RETURNING id`,
      [product.rows[0].id, `IMT-QUEUE-${suffix}`],
    );
    variantId = variant.rows[0].id;
    await migrationPool.query(
      `INSERT INTO barcodes (variant_id, barcode_value, is_primary)
       VALUES ($1, $2, true)`,
      [variantId, `QUEUE-${suffix}`],
    );
    const price = await migrationPool.query<{ id: string }>(
      `INSERT INTO price_versions (
         variant_id, purchase_price_paise, mrp_paise, standard_price_paise,
         wholesale_price_paise,
         owner_floor_paise, trusted_operator_floor_paise,
         store_operator_floor_paise, effective_from, created_by
       )
       VALUES ($1, 40000, 90000, 80000, 80000, 60000, 68000, 72000, now(), $2)
       RETURNING id`,
      [variantId, user.id],
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
    const device = await runtimePool.query<{
      id: string;
      last_validated_at: Date;
    }>(
      "SELECT id, last_validated_at FROM enroll_app_device($1, $2, 'Test phone')",
      [user.id, devicePublicId],
    );
    deviceId = device.rows[0].id;
    await runtimePool.query(
      "SELECT * FROM update_app_device($1, $2, 'APPROVE')",
      [
        (await migrationPool.query<{ id: string }>(
          `INSERT INTO app_users (
             business_id, display_name, role, status
           )
           VALUES ($1, 'Test Owner', 'BUSINESS_OWNER', 'ACTIVE')
           RETURNING id`,
          [user.businessId],
        )).rows[0].id,
        deviceId,
      ],
    );
    const refreshed = await runtimePool.query<{ last_validated_at: Date }>(
      "SELECT last_validated_at FROM enroll_app_device($1, $2, 'Test phone')",
      [user.id, devicePublicId],
    );
    validatedAt = refreshed.rows[0].last_validated_at.toISOString();
  });

  afterAll(async () => {
    const { getDatabase } = await import("@/server/database");
    await getDatabase().end();
    await runtimePool.end();
    await migrationPool.end();
  });

  it("atomically syncs once and preserves its offline audit metadata", async () => {
    const { completeSale } = await import("@/server/complete-sale");
    const commandId = randomUUID();
    const createdAt = new Date(Date.parse(validatedAt) + 1_000).toISOString();
    const input = {
      lines: [{ variantId, quantity: 2, unitPricePaise: 75_000 }],
      payments: [{ paymentMode: "CASH" as const, amountPaise: 150_000 }],
      offline: {
        schemaVersion: 1 as const,
        deviceId,
        devicePublicId,
        validatedAt,
        createdAt,
        catalogAsOf: validatedAt,
        lines: [{
          variantId,
          priceVersionId,
          cachedStock: 4,
          queuedBeforeQuantity: 0,
        }],
      },
    };

    const completed = await completeSale(user, commandId, input);
    expect(completed).toMatchObject({
      replayed: false,
      totalPaise: 150_000,
      lines: [{ variantId, remainingStock: 2 }],
    });
    await expect(completeSale(user, commandId, input))
      .resolves.toMatchObject({ saleId: completed.saleId, replayed: true });

    const stored = await migrationPool.query<{
      count: string;
      offline_device_id: string;
      offline_created_at: Date;
    }>(
      `SELECT count(*) OVER ()::text AS count, offline_device_id, offline_created_at
         FROM sales
        WHERE command_id = $1`,
      [commandId],
    );
    expect(stored.rows[0]).toMatchObject({
      count: "1",
      offline_device_id: deviceId,
    });
    expect(stored.rows[0].offline_created_at.toISOString()).toBe(createdAt);
  });
});
