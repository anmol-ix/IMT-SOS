import nextEnv from "@next/env";
import pg from "pg";
import { z } from "zod";

nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error: console.error });

const config = z
  .object({
    MIGRATION_DATABASE_URL: z.string().url(),
    BUSINESS_NAME: z.string().trim().min(1).default("ItsMyToy"),
  })
  .parse(process.env);

const products = [
  {
    name: "Remote Control Racing Car",
    category: "Cars & Vehicles",
    sku: "IMT-CAR-RC-0001-RED",
    variant: "Red",
    rack: "L1-S3",
    stock: 8,
    purchase: 45_000,
    mrp: 100_000,
    standard: 80_000,
    ownerFloor: 64_000,
    trustedFloor: 72_000,
    operatorFloor: 76_000,
  },
  {
    name: "Building Blocks 120 Pieces",
    category: "Educational",
    sku: "IMT-EDU-BLK-0002",
    variant: "Multicolour",
    rack: "C1-S2",
    stock: 12,
    purchase: 30_000,
    mrp: 70_000,
    standard: 60_000,
    ownerFloor: 48_000,
    trustedFloor: 54_000,
    operatorFloor: 57_000,
  },
  {
    name: "Family Strategy Board Game",
    category: "Board Games",
    sku: "IMT-GAM-BRD-0003",
    variant: "Classic",
    rack: "R2-S4",
    stock: 5,
    purchase: 52_000,
    mrp: 120_000,
    standard: 100_000,
    ownerFloor: 80_000,
    trustedFloor: 90_000,
    operatorFloor: 95_000,
  },
];

const database = new pg.Client({ connectionString: config.MIGRATION_DATABASE_URL });
await database.connect();

try {
  await database.query("BEGIN");
  const business = await database.query(
    "SELECT id FROM businesses WHERE name = $1",
    [config.BUSINESS_NAME],
  );
  if (!business.rows[0]) throw new Error("ItsMyToy business row is missing.");

  const owner = await database.query(
    `SELECT id FROM app_users
      WHERE business_id = $1 AND role = 'BUSINESS_OWNER' AND status = 'ACTIVE'
      ORDER BY created_at LIMIT 1`,
    [business.rows[0].id],
  );
  if (!owner.rows[0]) throw new Error("An active business owner is required.");

  const location = await database.query(
    `INSERT INTO locations (business_id, name)
     VALUES ($1, 'ItsMyToy Shop')
     ON CONFLICT (business_id, name) DO UPDATE SET status = 'ACTIVE'
     RETURNING id`,
    [business.rows[0].id],
  );

  let created = 0;
  for (const item of products) {
    const existing = await database.query(
      "SELECT id FROM product_variants WHERE sku = $1",
      [item.sku],
    );
    if (existing.rows[0]) continue;

    const product = await database.query(
      `INSERT INTO products (business_id, name, category)
       VALUES ($1, $2, $3) RETURNING id`,
      [business.rows[0].id, item.name, item.category],
    );
    const variant = await database.query(
      `INSERT INTO product_variants (product_id, sku, variant_name, rack_location)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [product.rows[0].id, item.sku, item.variant, item.rack],
    );
    await database.query(
      `INSERT INTO barcodes (variant_id, barcode_value, is_primary)
       VALUES ($1, $2, true)`,
      [variant.rows[0].id, item.sku],
    );
    await database.query(
      `INSERT INTO price_versions
         (variant_id, purchase_price_paise, mrp_paise, standard_price_paise,
          wholesale_price_paise,
          owner_floor_paise, trusted_operator_floor_paise, store_operator_floor_paise,
          effective_from, created_by)
       VALUES ($1, $2, $3, $4, $4, $5, $6, $7, now(), $8)`,
      [
        variant.rows[0].id,
        item.purchase,
        item.mrp,
        item.standard,
        item.ownerFloor,
        item.trustedFloor,
        item.operatorFloor,
        owner.rows[0].id,
      ],
    );
    await database.query(
      `INSERT INTO inventory_balances
         (location_id, variant_id, quantity_on_hand, inventory_value_paise,
          latest_landed_cost_paise)
       VALUES ($1, $2, $3, $3::bigint * $4, $4)`,
      [location.rows[0].id, variant.rows[0].id, item.stock, item.purchase],
    );
    await database.query(
      `INSERT INTO inventory_movements
         (business_id, location_id, variant_id, movement_type, quantity_delta,
          reference_type, reference_id, created_by)
       VALUES ($1, $2, $3, 'OPENING', $4, 'DEMO_SEED', $3, $5)`,
      [
        business.rows[0].id,
        location.rows[0].id,
        variant.rows[0].id,
        item.stock,
        owner.rows[0].id,
      ],
    );
    created += 1;
  }

  await database.query("COMMIT");
  console.info(JSON.stringify({ event: "demo_products_seeded", created }));
} catch (error) {
  await database.query("ROLLBACK");
  throw error;
} finally {
  await database.end();
}
