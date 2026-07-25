import "server-only";

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { CurrentUser } from "./auth/current-user";
import { requireRole } from "./auth/roles";
import { inTransaction } from "./database";
import { IdempotencyConflictError } from "./proof-command";
import {
  buildInternalSku,
  isRackCode,
  normalizeSkuCode,
  priceFloorConflict,
  productPricingConflict,
  recommendedPriceFloors,
  type PriceFloors,
  type ProductUnit,
} from "@/shared/product-setup-policy";

export type CreateProductInput = {
  productName: string;
  category: string;
  categoryCode: string;
  subcategory: string;
  subcategoryCode: string;
  brand?: string;
  variantName?: string;
  variantCode?: string;
  supplierBarcode?: string;
  unitOfMeasure: ProductUnit;
  packSize: number;
  rackLocation: string;
  purchaseCostPaise: number;
  standardPricePaise: number;
  mrpPaise: number;
  ownerFloorPaise?: number;
  trustedOperatorFloorPaise?: number;
  storeOperatorFloorPaise?: number;
};

export type CreatedProduct = {
  id: string;
  name: string;
  variantName: string | null;
  sku: string;
  barcode: string;
  rackLocation: string;
  stock: number;
  openBoxStock: number;
  damagedStock: number;
  mrpPaise: number;
  standardPricePaise: number;
  minimumPricePaise: number;
  ownerFloorPaise: number;
  trustedOperatorFloorPaise: number;
  storeOperatorFloorPaise: number;
  inventoryValuePaise: number;
  latestLandedCostPaise: number;
  weightedAverageCostPaise: number;
  replayed: boolean;
};

type ProductResultRow = {
  id: string;
  name: string;
  variant_name: string | null;
  sku: string;
  rack_location: string;
  mrp_paise: string;
  standard_price_paise: string;
  owner_floor_paise: string;
  trusted_operator_floor_paise: string;
  store_operator_floor_paise: string;
  latest_landed_cost_paise: string;
  creation_request_hash: string;
};

export class InvalidProductSetupError extends Error {
  readonly status = 400;
  readonly code = "INVALID_PRODUCT_SETUP";

  constructor(message: string) {
    super(message);
    this.name = "InvalidProductSetupError";
  }
}

export class ProductIdentityConflictError extends Error {
  readonly status = 409;
  readonly code = "PRODUCT_IDENTITY_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "ProductIdentityConflictError";
  }
}

function normalizedInput(input: CreateProductInput): CreateProductInput {
  return {
    productName: input.productName.trim(),
    category: input.category.trim(),
    categoryCode: normalizeSkuCode(input.categoryCode),
    subcategory: input.subcategory.trim(),
    subcategoryCode: normalizeSkuCode(input.subcategoryCode),
    ...(input.brand?.trim() ? { brand: input.brand.trim() } : {}),
    ...(input.variantName?.trim() ? { variantName: input.variantName.trim() } : {}),
    ...(input.variantCode?.trim()
      ? { variantCode: normalizeSkuCode(input.variantCode, 4) }
      : {}),
    ...(input.supplierBarcode?.trim()
      ? { supplierBarcode: input.supplierBarcode.trim().toUpperCase() }
      : {}),
    unitOfMeasure: input.unitOfMeasure,
    packSize: input.packSize,
    rackLocation: input.rackLocation.trim().toUpperCase(),
    purchaseCostPaise: input.purchaseCostPaise,
    standardPricePaise: input.standardPricePaise,
    mrpPaise: input.mrpPaise,
    ...(input.ownerFloorPaise === undefined
      ? {}
      : { ownerFloorPaise: input.ownerFloorPaise }),
    ...(input.trustedOperatorFloorPaise === undefined
      ? {}
      : { trustedOperatorFloorPaise: input.trustedOperatorFloorPaise }),
    ...(input.storeOperatorFloorPaise === undefined
      ? {}
      : { storeOperatorFloorPaise: input.storeOperatorFloorPaise }),
  };
}

function inputHash(input: CreateProductInput): string {
  return createHash("sha256")
    .update(JSON.stringify(normalizedInput(input)))
    .digest("hex");
}

function validateInput(input: CreateProductInput) {
  if (
    input.categoryCode.length < 2 ||
    input.subcategoryCode.length < 2 ||
    (input.variantCode && input.variantCode.length < 2)
  ) {
    throw new InvalidProductSetupError(
      "SKU category, sub-category and optional variant codes need at least two letters or numbers.",
    );
  }
  if (input.variantCode && !input.variantName) {
    throw new InvalidProductSetupError(
      "Add the variant name when a variant SKU code is used.",
    );
  }
  if (!isRackCode(input.rackLocation)) {
    throw new InvalidProductSetupError("Choose a rack from the ItsMyToy rack list.");
  }
  if (!Number.isInteger(input.packSize) || input.packSize < 1) {
    throw new InvalidProductSetupError("Pack size must be at least one.");
  }
  const pricingConflict = productPricingConflict(
    input.purchaseCostPaise,
    input.standardPricePaise,
    input.mrpPaise,
  );
  if (pricingConflict) throw new InvalidProductSetupError(pricingConflict);
  const floorConflict = priceFloorConflict(
    input.purchaseCostPaise,
    input.standardPricePaise,
    resolvedFloors(input),
  );
  if (floorConflict) throw new InvalidProductSetupError(floorConflict);
}

function resolvedFloors(input: CreateProductInput): PriceFloors {
  const recommended = recommendedPriceFloors(
    input.purchaseCostPaise,
    input.standardPricePaise,
  );
  return {
    ownerFloorPaise: input.ownerFloorPaise ?? recommended.ownerFloorPaise,
    trustedOperatorFloorPaise:
      input.trustedOperatorFloorPaise ?? recommended.trustedOperatorFloorPaise,
    storeOperatorFloorPaise:
      input.storeOperatorFloorPaise ?? recommended.storeOperatorFloorPaise,
  };
}

async function findByCommand(
  client: PoolClient,
  businessId: string,
  commandId: string,
): Promise<ProductResultRow | undefined> {
  const result = await client.query<ProductResultRow>(
    `SELECT
       v.id, p.name, v.variant_name, v.sku, v.rack_location,
       pv.mrp_paise, pv.standard_price_paise, pv.owner_floor_paise,
       pv.trusted_operator_floor_paise, pv.store_operator_floor_paise,
       ib.latest_landed_cost_paise, p.creation_request_hash
     FROM products p
     JOIN product_variants v ON v.product_id = p.id
     JOIN price_versions pv ON pv.variant_id = v.id AND pv.effective_to IS NULL
     JOIN inventory_balances ib ON ib.variant_id = v.id
     WHERE p.business_id = $1 AND p.creation_command_id = $2
     ORDER BY ib.updated_at
     LIMIT 1`,
    [businessId, commandId],
  );
  return result.rows[0];
}

function resultView(row: ProductResultRow, replayed: boolean): CreatedProduct {
  return {
    id: row.id,
    name: row.name,
    variantName: row.variant_name,
    sku: row.sku,
    barcode: row.sku,
    rackLocation: row.rack_location,
    stock: 0,
    openBoxStock: 0,
    damagedStock: 0,
    mrpPaise: Number(row.mrp_paise),
    standardPricePaise: Number(row.standard_price_paise),
    minimumPricePaise: Math.max(
      Number(row.owner_floor_paise),
      Number(row.latest_landed_cost_paise),
    ),
    ownerFloorPaise: Number(row.owner_floor_paise),
    trustedOperatorFloorPaise: Number(row.trusted_operator_floor_paise),
    storeOperatorFloorPaise: Number(row.store_operator_floor_paise),
    inventoryValuePaise: 0,
    latestLandedCostPaise: Number(row.latest_landed_cost_paise),
    weightedAverageCostPaise: 0,
    replayed,
  };
}

export async function createProduct(
  user: CurrentUser,
  commandId: string,
  suppliedInput: CreateProductInput,
): Promise<CreatedProduct> {
  requireRole(user.role, ["BUSINESS_OWNER"]);
  const input = normalizedInput(suppliedInput);
  validateInput(input);
  const requestHash = inputHash(input);

  return inTransaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`${user.businessId}:product:${commandId}`],
    );
    const prior = await findByCommand(client, user.businessId, commandId);
    if (prior) {
      if (prior.creation_request_hash !== requestHash) {
        throw new IdempotencyConflictError();
      }
      return resultView(prior, true);
    }

    const location = await client.query<{ id: string }>(
      `SELECT id FROM locations
        WHERE business_id = $1 AND status = 'ACTIVE'
        ORDER BY created_at
        LIMIT 1`,
      [user.businessId],
    );
    if (!location.rows[0]) {
      throw new InvalidProductSetupError(
        "An active shop location is required before a product can be created.",
      );
    }

    if (input.supplierBarcode) {
      const barcode = await client.query(
        `SELECT 1 FROM barcodes
          WHERE upper(trim(barcode_value)) = $1
          LIMIT 1`,
        [input.supplierBarcode],
      );
      if (barcode.rows[0]) {
        throw new ProductIdentityConflictError(
          "That supplier barcode already belongs to another product.",
        );
      }
    }

    await client.query(
      `INSERT INTO business_sku_sequences (business_id, last_number)
       VALUES ($1, 0)
       ON CONFLICT (business_id) DO NOTHING`,
      [user.businessId],
    );
    const sequence = await client.query<{ last_number: number }>(
      `UPDATE business_sku_sequences
          SET last_number = last_number + 1, updated_at = now()
        WHERE business_id = $1 AND last_number < 9999
        RETURNING last_number`,
      [user.businessId],
    );
    if (!sequence.rows[0]) {
      throw new InvalidProductSetupError(
        "The four-digit SKU sequence is exhausted. Expand the SKU format before creating more products.",
      );
    }
    const sku = buildInternalSku(
      input.categoryCode,
      input.subcategoryCode,
      sequence.rows[0].last_number,
      input.variantCode,
    );
    const skuConflict = await client.query(
      `SELECT 1 FROM product_variants
        WHERE upper(trim(sku)) = $1
        LIMIT 1`,
      [sku],
    );
    if (skuConflict.rows[0]) {
      throw new ProductIdentityConflictError(
        "The generated SKU already exists. Review the SKU sequence before retrying.",
      );
    }

    const floors = resolvedFloors(input);
    const product = await client.query<{ id: string }>(
      `INSERT INTO products
         (business_id, name, category, subcategory, brand,
          creation_command_id, creation_request_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        user.businessId,
        input.productName,
        input.category,
        input.subcategory,
        input.brand ?? null,
        commandId,
        requestHash,
      ],
    );
    const variant = await client.query<{ id: string }>(
      `INSERT INTO product_variants
         (product_id, sku, variant_name, rack_location, unit_of_measure, pack_size)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        product.rows[0].id,
        sku,
        input.variantName ?? null,
        input.rackLocation,
        input.unitOfMeasure,
        input.packSize,
      ],
    );
    await client.query(
      `INSERT INTO barcodes (variant_id, barcode_value, is_primary)
       VALUES ($1, $2, true)`,
      [variant.rows[0].id, sku],
    );
    if (input.supplierBarcode && input.supplierBarcode !== sku) {
      await client.query(
        `INSERT INTO barcodes (variant_id, barcode_value, is_primary)
         VALUES ($1, $2, false)`,
        [variant.rows[0].id, input.supplierBarcode],
      );
    }
    await client.query(
      `INSERT INTO price_versions
         (variant_id, purchase_price_paise, mrp_paise, standard_price_paise,
          owner_floor_paise, trusted_operator_floor_paise,
          store_operator_floor_paise, effective_from, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8)`,
      [
        variant.rows[0].id,
        input.purchaseCostPaise,
        input.mrpPaise,
        input.standardPricePaise,
        floors.ownerFloorPaise,
        floors.trustedOperatorFloorPaise,
        floors.storeOperatorFloorPaise,
        user.id,
      ],
    );
    await client.query(
      `INSERT INTO inventory_balances
         (location_id, variant_id, quantity_on_hand, inventory_value_paise,
          latest_landed_cost_paise)
       VALUES ($1, $2, 0, 0, $3)`,
      [location.rows[0].id, variant.rows[0].id, input.purchaseCostPaise],
    );
    await client.query(
      `INSERT INTO audit_events
         (business_id, actor_user_id, event_type, entity_type, entity_id, details)
       VALUES ($1, $2, 'PRODUCT_CREATED', 'PRODUCT_VARIANT', $3, $4)`,
      [
        user.businessId,
        user.id,
        variant.rows[0].id,
        {
          sku,
          rackLocation: input.rackLocation,
          category: input.category,
          subcategory: input.subcategory,
          hasAlternateBarcode: Boolean(
            input.supplierBarcode && input.supplierBarcode !== sku,
          ),
          standardPricePaise: input.standardPricePaise,
          mrpPaise: input.mrpPaise,
        },
      ],
    );

    return {
      id: variant.rows[0].id,
      name: input.productName,
      variantName: input.variantName ?? null,
      sku,
      barcode: sku,
      rackLocation: input.rackLocation,
      stock: 0,
      openBoxStock: 0,
      damagedStock: 0,
      mrpPaise: input.mrpPaise,
      standardPricePaise: input.standardPricePaise,
      minimumPricePaise: floors.ownerFloorPaise,
      ownerFloorPaise: floors.ownerFloorPaise,
      trustedOperatorFloorPaise: floors.trustedOperatorFloorPaise,
      storeOperatorFloorPaise: floors.storeOperatorFloorPaise,
      inventoryValuePaise: 0,
      latestLandedCostPaise: input.purchaseCostPaise,
      weightedAverageCostPaise: 0,
      replayed: false,
    };
  });
}
