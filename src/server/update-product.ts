import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { CurrentUser } from "./auth/current-user";
import { requireRole } from "./auth/roles";
import { inTransaction } from "./database";
import { IdempotencyConflictError } from "./proof-command";
import {
  type ProductChangeReason,
  productChangeNoteConflict,
} from "@/shared/product-change-policy";
import {
  isRackCode,
  priceFloorConflict,
  productPricingConflict,
} from "@/shared/product-setup-policy";

export type UpdateProductInput = {
  rackLocation: string;
  mrpPaise: number;
  standardPricePaise: number;
  wholesalePricePaise: number;
  ownerFloorPaise: number;
  trustedOperatorFloorPaise: number;
  storeOperatorFloorPaise: number;
  reason: ProductChangeReason;
  note?: string;
};

export type UpdatedProduct = {
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
  wholesalePricePaise: number;
  ownerFloorPaise: number;
  trustedOperatorFloorPaise: number;
  storeOperatorFloorPaise: number;
  minimumPricePaise: number;
  inventoryValuePaise: number;
  latestLandedCostPaise: number;
  weightedAverageCostPaise: number;
};

export type UpdateProductResult = {
  changeId: string;
  product: UpdatedProduct;
  priceChanged: boolean;
  rackChanged: boolean;
  expiredPriceApprovals: number;
  previous: {
    rackLocation: string;
    mrpPaise: number;
    standardPricePaise: number;
    wholesalePricePaise: number;
    ownerFloorPaise: number;
    trustedOperatorFloorPaise: number;
    storeOperatorFloorPaise: number;
  };
  reason: ProductChangeReason;
  note: string | null;
  replayed: boolean;
};

type ProductRow = {
  id: string;
  name: string;
  variant_name: string | null;
  sku: string;
  barcode: string;
  rack_location: string;
  quantity_on_hand: number;
  inventory_value_paise: string;
  latest_landed_cost_paise: string;
  open_box_quantity: number;
  damaged_quantity: number;
  price_version_id: string;
  purchase_price_paise: string;
  mrp_paise: string;
  standard_price_paise: string;
  wholesale_price_paise: string;
  owner_floor_paise: string;
  trusted_operator_floor_paise: string;
  store_operator_floor_paise: string;
};

export class InvalidProductChangeError extends Error {
  readonly status = 400;
  readonly code = "INVALID_PRODUCT_CHANGE";

  constructor(message: string) {
    super(message);
    this.name = "InvalidProductChangeError";
  }
}

export class ProductChangeUnavailableError extends Error {
  readonly status = 409;
  readonly code = "PRODUCT_CHANGE_UNAVAILABLE";

  constructor(message = "This product is no longer available for changes.") {
    super(message);
    this.name = "ProductChangeUnavailableError";
  }
}

function normalizeInput(input: UpdateProductInput): UpdateProductInput {
  return {
    ...input,
    rackLocation: input.rackLocation.trim().toUpperCase(),
    ...(input.note?.trim() ? { note: input.note.trim() } : { note: undefined }),
  };
}

function inputHash(input: UpdateProductInput): string {
  return createHash("sha256")
    .update(JSON.stringify(normalizeInput(input)))
    .digest("hex");
}

function validateInput(input: UpdateProductInput, replacementCostPaise: number) {
  if (!isRackCode(input.rackLocation)) {
    throw new InvalidProductChangeError(
      "Choose a rack from the ItsMyToy rack list.",
    );
  }
  const pricingConflict = productPricingConflict(
    replacementCostPaise,
    input.standardPricePaise,
    input.mrpPaise,
    input.wholesalePricePaise,
  );
  if (pricingConflict) throw new InvalidProductChangeError(pricingConflict);
  const floorConflict = priceFloorConflict(
    replacementCostPaise,
    input.wholesalePricePaise,
    {
      ownerFloorPaise: input.ownerFloorPaise,
      trustedOperatorFloorPaise: input.trustedOperatorFloorPaise,
      storeOperatorFloorPaise: input.storeOperatorFloorPaise,
    },
  );
  if (floorConflict) throw new InvalidProductChangeError(floorConflict);
  const noteConflict = productChangeNoteConflict(input.reason, input.note);
  if (noteConflict) throw new InvalidProductChangeError(noteConflict);
}

function productView(row: ProductRow, input: UpdateProductInput): UpdatedProduct {
  const replacementCostPaise = Number(row.latest_landed_cost_paise);
  return {
    id: row.id,
    name: row.name,
    variantName: row.variant_name,
    sku: row.sku,
    barcode: row.barcode,
    rackLocation: input.rackLocation,
    stock: row.quantity_on_hand,
    openBoxStock: row.open_box_quantity,
    damagedStock: row.damaged_quantity,
    mrpPaise: input.mrpPaise,
    standardPricePaise: input.standardPricePaise,
    wholesalePricePaise: input.wholesalePricePaise,
    ownerFloorPaise: input.ownerFloorPaise,
    trustedOperatorFloorPaise: input.trustedOperatorFloorPaise,
    storeOperatorFloorPaise: input.storeOperatorFloorPaise,
    minimumPricePaise: Math.max(input.ownerFloorPaise, replacementCostPaise),
    inventoryValuePaise: Number(row.inventory_value_paise),
    latestLandedCostPaise: replacementCostPaise,
    weightedAverageCostPaise:
      row.quantity_on_hand > 0
        ? Math.round(Number(row.inventory_value_paise) / row.quantity_on_hand)
        : 0,
  };
}

export async function updateProduct(
  user: CurrentUser,
  variantId: string,
  commandId: string,
  suppliedInput: UpdateProductInput,
): Promise<UpdateProductResult> {
  requireRole(user.role, ["BUSINESS_OWNER"]);
  const input = normalizeInput(suppliedInput);
  const requestHash = inputHash(input);

  return inTransaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`${user.businessId}:product-change:${commandId}`],
    );
    const prior = await client.query<{
      variant_id: string;
      request_hash: string;
      result_json: Omit<UpdateProductResult, "replayed">;
    }>(
      `SELECT variant_id, request_hash, result_json
         FROM product_change_events
        WHERE business_id = $1 AND command_id = $2`,
      [user.businessId, commandId],
    );
    if (prior.rows[0]) {
      if (
        prior.rows[0].variant_id !== variantId ||
        prior.rows[0].request_hash !== requestHash
      ) {
        throw new IdempotencyConflictError();
      }
      return { ...prior.rows[0].result_json, replayed: true };
    }

    const product = await client.query<ProductRow>(
      `SELECT
         v.id, p.name, v.variant_name, v.sku, v.rack_location,
         primary_barcode.barcode_value AS barcode,
         ib.quantity_on_hand, ib.inventory_value_paise,
         ib.latest_landed_cost_paise,
         COALESCE(conditions.open_box_quantity, 0)::int AS open_box_quantity,
         COALESCE(conditions.damaged_quantity, 0)::int AS damaged_quantity,
         pv.id AS price_version_id, pv.purchase_price_paise, pv.mrp_paise,
         pv.standard_price_paise, pv.wholesale_price_paise,
         pv.owner_floor_paise,
         pv.trusted_operator_floor_paise, pv.store_operator_floor_paise
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       JOIN price_versions pv
         ON pv.variant_id = v.id AND pv.effective_to IS NULL
       JOIN inventory_balances ib ON ib.variant_id = v.id
       JOIN locations l ON l.id = ib.location_id AND l.status = 'ACTIVE'
       JOIN LATERAL (
         SELECT barcode_value
           FROM barcodes
          WHERE variant_id = v.id
          ORDER BY is_primary DESC, created_at
          LIMIT 1
       ) primary_barcode ON true
       LEFT JOIN LATERAL (
         SELECT
           COALESCE(sum(quantity_on_hand) FILTER (
             WHERE stock_condition = 'OPEN_BOX'
           ), 0)::int AS open_box_quantity,
           COALESCE(sum(quantity_on_hand) FILTER (
             WHERE stock_condition = 'DAMAGED'
           ), 0)::int AS damaged_quantity
         FROM inventory_condition_balances cb
         WHERE cb.location_id = ib.location_id AND cb.variant_id = v.id
       ) conditions ON true
       WHERE v.id = $1 AND p.business_id = $2
         AND p.status = 'ACTIVE' AND v.status = 'ACTIVE'
       ORDER BY l.created_at
       LIMIT 1
       FOR UPDATE OF v, pv, ib`,
      [variantId, user.businessId],
    );
    const row = product.rows[0];
    if (!row) throw new ProductChangeUnavailableError();
    validateInput(input, Number(row.latest_landed_cost_paise));

    const priceChanged =
      Number(row.mrp_paise) !== input.mrpPaise ||
      Number(row.standard_price_paise) !== input.standardPricePaise ||
      Number(row.wholesale_price_paise) !== input.wholesalePricePaise ||
      Number(row.owner_floor_paise) !== input.ownerFloorPaise ||
      Number(row.trusted_operator_floor_paise) !==
        input.trustedOperatorFloorPaise ||
      Number(row.store_operator_floor_paise) !== input.storeOperatorFloorPaise;
    const rackChanged = row.rack_location !== input.rackLocation;
    if (!priceChanged && !rackChanged) {
      throw new InvalidProductChangeError(
        "Change at least one price or the primary rack before saving.",
      );
    }

    let newPriceVersionId: string | null = null;
    let expiredPriceApprovals = 0;
    if (priceChanged) {
      const closed = await client.query<{ effective_to: Date }>(
        `UPDATE price_versions
            SET effective_to = clock_timestamp()
          WHERE id = $1 AND effective_to IS NULL
          RETURNING effective_to`,
        [row.price_version_id],
      );
      if (!closed.rows[0]) throw new ProductChangeUnavailableError();
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO price_versions
           (variant_id, purchase_price_paise, mrp_paise, standard_price_paise,
            wholesale_price_paise,
            owner_floor_paise, trusted_operator_floor_paise,
            store_operator_floor_paise, effective_from, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          variantId,
          row.latest_landed_cost_paise,
          input.mrpPaise,
          input.standardPricePaise,
          input.wholesalePricePaise,
          input.ownerFloorPaise,
          input.trustedOperatorFloorPaise,
          input.storeOperatorFloorPaise,
          closed.rows[0].effective_to,
          user.id,
        ],
      );
      newPriceVersionId = inserted.rows[0].id;
      const expired = await client.query(
        `UPDATE price_approval_requests
            SET status = 'EXPIRED', updated_at = now()
          WHERE business_id = $1 AND variant_id = $2
            AND price_version_id = $3
            AND status IN ('PENDING', 'APPROVED')
          RETURNING id`,
        [user.businessId, variantId, row.price_version_id],
      );
      expiredPriceApprovals = expired.rowCount ?? 0;
    }
    if (rackChanged) {
      await client.query(
        `UPDATE product_variants
            SET rack_location = $1, updated_at = now()
          WHERE id = $2`,
        [input.rackLocation, variantId],
      );
    }

    const changeId = randomUUID();
    const previous = {
      rackLocation: row.rack_location,
      mrpPaise: Number(row.mrp_paise),
      standardPricePaise: Number(row.standard_price_paise),
      wholesalePricePaise: Number(row.wholesale_price_paise),
      ownerFloorPaise: Number(row.owner_floor_paise),
      trustedOperatorFloorPaise: Number(row.trusted_operator_floor_paise),
      storeOperatorFloorPaise: Number(row.store_operator_floor_paise),
    };
    const result = {
      changeId,
      product: productView(row, input),
      priceChanged,
      rackChanged,
      expiredPriceApprovals,
      previous,
      reason: input.reason,
      note: input.note ?? null,
    };
    await client.query(
      `INSERT INTO product_change_events
         (id, business_id, variant_id, command_id, request_hash,
          actor_user_id, reason_code, note, old_rack_location,
          new_rack_location, old_price_version_id, new_price_version_id,
          price_changed, rack_changed, result_json)
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15
       )`,
      [
        changeId,
        user.businessId,
        variantId,
        commandId,
        requestHash,
        user.id,
        input.reason,
        input.note ?? null,
        row.rack_location,
        input.rackLocation,
        row.price_version_id,
        newPriceVersionId,
        priceChanged,
        rackChanged,
        result,
      ],
    );
    await client.query(
      `INSERT INTO audit_events
         (business_id, actor_user_id, event_type, entity_type, entity_id, details)
       VALUES ($1, $2, 'PRODUCT_CHANGED', 'PRODUCT_VARIANT', $3, $4)`,
      [
        user.businessId,
        user.id,
        variantId,
        {
          changeId,
          reason: input.reason,
          note: input.note ?? null,
          priceChanged,
          rackChanged,
          expiredPriceApprovals,
          previous,
          current: {
            rackLocation: input.rackLocation,
            mrpPaise: input.mrpPaise,
            standardPricePaise: input.standardPricePaise,
            wholesalePricePaise: input.wholesalePricePaise,
            ownerFloorPaise: input.ownerFloorPaise,
            trustedOperatorFloorPaise: input.trustedOperatorFloorPaise,
            storeOperatorFloorPaise: input.storeOperatorFloorPaise,
          },
        },
      ],
    );
    return { ...result, replayed: false };
  });
}
