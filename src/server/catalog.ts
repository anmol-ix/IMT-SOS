import "server-only";

import { getDatabase } from "./database";
import type { CurrentUser } from "./auth/current-user";
import type {
  OfflineCatalogSnapshot,
} from "@/shared/offline-catalog";
import { toOfflineCatalogProduct } from "@/shared/offline-catalog";
import { minimumGrowthPrice } from "@/shared/product-setup-policy";
import { applyMarkup } from "@/shared/fifo-inventory";

export type WholesaleFifoLot = {
  quantity: number;
  unitCostPaise: number;
  suggestedUnitPricePaise: number;
};

export type SellableProduct = {
  id: string;
  priceVersionId: string;
  name: string;
  category: string | null;
  variantName: string | null;
  sku: string;
  barcode: string;
  barcodes: string[];
  rackLocation: string | null;
  stock: number;
  openBoxStock?: number;
  damagedStock?: number;
  mrpPaise: number;
  standardPricePaise: number;
  wholesalePricePaise: number;
  wholesaleFifoLots: WholesaleFifoLot[];
  minimumPricePaise: number;
  suggestedMinimumPricePaise: number;
  ownerFloorPaise?: number;
  trustedOperatorFloorPaise?: number;
  storeOperatorFloorPaise?: number;
  inventoryValuePaise?: number;
  latestLandedCostPaise?: number;
  weightedAverageCostPaise?: number;
  reorderPoint?: number | null;
  restockTarget?: number | null;
};

export const SELLABLE_PRODUCTS_SQL = `
  SELECT
    v.id, pv.id AS price_version_id, p.name, p.category, v.variant_name, v.sku,
    b.barcodes[1] AS barcode,
    b.barcodes,
    v.rack_location, v.reorder_point, v.restock_target,
    ib.quantity_on_hand, pv.mrp_paise, pv.standard_price_paise,
    pv.wholesale_price_paise,
    COALESCE(fifo.wholesale_fifo_lots, '[]'::jsonb) AS wholesale_fifo_lots,
    GREATEST(
      CASE $2
        WHEN 'BUSINESS_OWNER' THEN pv.owner_floor_paise
        WHEN 'TRUSTED_OPERATOR' THEN pv.trusted_operator_floor_paise
        ELSE pv.store_operator_floor_paise
      END,
      ib.latest_landed_cost_paise
    ) AS suggested_minimum_price_paise,
    ib.latest_landed_cost_paise AS pricing_cost_paise,
    CASE WHEN $2 = 'BUSINESS_OWNER' THEN pv.owner_floor_paise END
      AS owner_floor_paise,
    CASE WHEN $2 = 'BUSINESS_OWNER' THEN pv.trusted_operator_floor_paise END
      AS trusted_operator_floor_paise,
    CASE WHEN $2 = 'BUSINESS_OWNER' THEN pv.store_operator_floor_paise END
      AS store_operator_floor_paise,
    CASE WHEN $2 = 'BUSINESS_OWNER' THEN ib.inventory_value_paise END AS inventory_value_paise,
    CASE WHEN $2 = 'BUSINESS_OWNER' THEN ib.latest_landed_cost_paise END AS latest_landed_cost_paise,
    CASE WHEN $2 IN ('BUSINESS_OWNER', 'TRUSTED_OPERATOR')
      THEN conditions.open_box_quantity END AS open_box_quantity,
    CASE WHEN $2 IN ('BUSINESS_OWNER', 'TRUSTED_OPERATOR')
      THEN conditions.damaged_quantity END AS damaged_quantity
  FROM product_variants v
  JOIN products p ON p.id = v.product_id
  JOIN price_versions pv ON pv.variant_id = v.id AND pv.effective_to IS NULL
  JOIN inventory_balances ib ON ib.variant_id = v.id
  JOIN locations l ON l.id = ib.location_id AND l.status = 'ACTIVE'
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
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'quantity', lot.remaining_quantity,
        'unitCostPaise', lot.unit_cost_paise,
        'suggestedUnitPricePaise',
          (lot.unit_cost_paise * 110 + 99) / 100
      ) ORDER BY lot.received_at, lot.id
    ) AS wholesale_fifo_lots
    FROM inventory_lots lot
    WHERE lot.business_id = p.business_id
      AND lot.location_id = ib.location_id
      AND lot.variant_id = v.id
      AND lot.remaining_quantity > 0
  ) fifo ON true
  JOIN LATERAL (
    SELECT array_agg(
      barcode_value ORDER BY is_primary DESC, created_at
    ) AS barcodes
    FROM barcodes
    WHERE variant_id = v.id
  ) b ON true
  WHERE p.business_id = $1
    AND p.status = 'ACTIVE'
    AND v.status = 'ACTIVE'
    AND b.barcodes IS NOT NULL
    AND (
      $3 = '' OR v.sku ILIKE '%' || $3 || '%' OR
      EXISTS (
        SELECT 1 FROM barcodes bx
        WHERE bx.variant_id = v.id
          AND bx.barcode_value ILIKE '%' || $3 || '%'
      ) OR
      p.name ILIKE '%' || $3 || '%' OR v.variant_name ILIKE '%' || $3 || '%'
    )
  ORDER BY
    CASE
      WHEN v.sku ILIKE $3 OR EXISTS (
        SELECT 1 FROM barcodes bx
        WHERE bx.variant_id = v.id AND bx.barcode_value ILIKE $3
      ) THEN 0
      WHEN v.sku ILIKE $3 || '%' OR EXISTS (
        SELECT 1 FROM barcodes bx
        WHERE bx.variant_id = v.id AND bx.barcode_value ILIKE $3 || '%'
      ) THEN 1
      ELSE 2
    END,
    p.name, v.variant_name
  LIMIT $4
`;

async function loadSellableProducts(
  user: CurrentUser,
  query: string,
  limit: number,
): Promise<SellableProduct[]> {
  const result = await getDatabase().query<{
    id: string;
    price_version_id: string;
    name: string;
    category: string | null;
    variant_name: string | null;
    sku: string;
    barcode: string;
    barcodes: string[];
    rack_location: string | null;
    reorder_point: number | null;
    restock_target: number | null;
    quantity_on_hand: number;
    mrp_paise: string;
    standard_price_paise: string;
    wholesale_price_paise: string;
    wholesale_fifo_lots: WholesaleFifoLot[];
    suggested_minimum_price_paise: string;
    pricing_cost_paise: string;
    owner_floor_paise: string | null;
    trusted_operator_floor_paise: string | null;
    store_operator_floor_paise: string | null;
    inventory_value_paise: string | null;
    latest_landed_cost_paise: string | null;
    open_box_quantity: number | null;
    damaged_quantity: number | null;
  }>(
    SELLABLE_PRODUCTS_SQL,
    [user.businessId, user.role, query, limit],
  );

  return result.rows.map((row) => ({
    id: row.id,
    priceVersionId: row.price_version_id,
    name: row.name,
    category: row.category,
    variantName: row.variant_name,
    sku: row.sku,
    barcode: row.barcode,
    barcodes: row.barcodes,
    rackLocation: row.rack_location,
    reorderPoint: row.reorder_point,
    restockTarget: row.restock_target,
    stock: row.quantity_on_hand,
    ...(row.open_box_quantity === null || row.damaged_quantity === null
      ? {}
      : {
          openBoxStock: row.open_box_quantity,
          damagedStock: row.damaged_quantity,
        }),
    mrpPaise: Number(row.mrp_paise),
    standardPricePaise: Number(row.standard_price_paise),
    wholesalePricePaise: row.wholesale_fifo_lots[0]?.suggestedUnitPricePaise
      ?? applyMarkup(Number(row.pricing_cost_paise)),
    wholesaleFifoLots: row.wholesale_fifo_lots,
    minimumPricePaise: minimumGrowthPrice(Number(row.pricing_cost_paise)),
    suggestedMinimumPricePaise: Math.max(
      Number(row.suggested_minimum_price_paise),
      minimumGrowthPrice(Number(row.pricing_cost_paise)),
    ),
    ...(row.owner_floor_paise === null
      ? {}
      : {
          ownerFloorPaise: Number(row.owner_floor_paise),
          trustedOperatorFloorPaise: Number(row.trusted_operator_floor_paise),
          storeOperatorFloorPaise: Number(row.store_operator_floor_paise),
        }),
    ...(row.inventory_value_paise === null || row.latest_landed_cost_paise === null
      ? {}
      : {
          inventoryValuePaise: Number(row.inventory_value_paise),
          latestLandedCostPaise: Number(row.latest_landed_cost_paise),
          weightedAverageCostPaise:
            row.quantity_on_hand > 0
              ? Math.round(Number(row.inventory_value_paise) / row.quantity_on_hand)
              : 0,
        }),
  }));
}

export function searchSellableProducts(
  user: CurrentUser,
  query: string,
): Promise<SellableProduct[]> {
  return loadSellableProducts(user, query, 12);
}

export function listInventoryProducts(
  user: CurrentUser,
): Promise<SellableProduct[]> {
  return loadSellableProducts(user, "", 5_000);
}

export async function getOfflineCatalogSnapshot(
  user: CurrentUser,
): Promise<OfflineCatalogSnapshot> {
  const products = await loadSellableProducts(user, "", 5_000);
  return {
    asOf: new Date().toISOString(),
    products: products.map(toOfflineCatalogProduct),
  };
}
