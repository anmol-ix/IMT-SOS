import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SELLABLE_PRODUCTS_SQL } from "@/server/catalog";

const runtimeUrl = process.env.TEST_DATABASE_URL;
const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const describeWithDatabase = runtimeUrl && migrationUrl ? describe : describe.skip;

describeWithDatabase("offline catalogue database query", () => {
  const runtimePool = new Pool({ connectionString: runtimeUrl });
  const migrationPool = new Pool({ connectionString: migrationUrl });
  const suffix = randomUUID();
  let businessId: string;

  beforeAll(async () => {
    const business = await migrationPool.query<{ id: string }>(
      "INSERT INTO businesses (name) VALUES ($1) RETURNING id",
      [`Offline catalogue ${suffix}`],
    );
    businessId = business.rows[0].id;
    const user = await migrationPool.query<{ id: string }>(
      `INSERT INTO app_users (
         business_id, display_name, role, status
       )
       VALUES ($1, 'Catalogue Owner', 'BUSINESS_OWNER', 'ACTIVE')
       RETURNING id`,
      [businessId],
    );
    const location = await migrationPool.query<{ id: string }>(
      `INSERT INTO locations (business_id, name)
       VALUES ($1, 'Test shop') RETURNING id`,
      [businessId],
    );
    const product = await migrationPool.query<{ id: string }>(
      `INSERT INTO products (business_id, name, category)
       VALUES ($1, 'Offline Test Car', 'Cars') RETURNING id`,
      [businessId],
    );
    const variant = await migrationPool.query<{ id: string }>(
      `INSERT INTO product_variants (
         product_id, sku, variant_name, rack_location
       )
       VALUES ($1, $2, 'Blue', 'L1-S2') RETURNING id`,
      [product.rows[0].id, `IMT-OFFLINE-${suffix}`],
    );
    await migrationPool.query(
      `INSERT INTO barcodes (variant_id, barcode_value, is_primary)
       VALUES ($1, $2, true), ($1, $3, false)`,
      [variant.rows[0].id, `PRIMARY-${suffix}`, `SUPPLIER-${suffix}`],
    );
    await migrationPool.query(
      `INSERT INTO price_versions (
         variant_id, purchase_price_paise, mrp_paise, standard_price_paise,
         wholesale_price_paise,
         owner_floor_paise, trusted_operator_floor_paise,
         store_operator_floor_paise, effective_from, created_by
       )
       VALUES ($1, 40000, 90000, 80000, 80000, 60000, 68000, 72000, now(), $2)`,
      [variant.rows[0].id, user.rows[0].id],
    );
    await migrationPool.query(
      `INSERT INTO inventory_balances (
         location_id, variant_id, quantity_on_hand,
         inventory_value_paise, latest_landed_cost_paise
       )
       VALUES ($1, $2, 3, 120000, 40000)`,
      [location.rows[0].id, variant.rows[0].id],
    );
  });

  afterAll(async () => {
    await runtimePool.end();
    await migrationPool.end();
  });

  it("returns every barcode while keeping operator-only pricing", async () => {
    const result = await runtimePool.query<{
      barcodes: string[];
      minimum_price_paise: string;
      inventory_value_paise: string | null;
    }>(
      SELLABLE_PRODUCTS_SQL,
      [businessId, "STORE_OPERATOR", `SUPPLIER-${suffix}`, 5_000],
    );

    expect(result.rows[0].barcodes).toEqual([
      `PRIMARY-${suffix}`,
      `SUPPLIER-${suffix}`,
    ]);
    expect(result.rows[0].minimum_price_paise).toBe("72000");
    expect(result.rows[0].inventory_value_paise).toBeNull();
  });
});
