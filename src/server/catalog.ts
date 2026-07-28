import "server-only";

import { getDatabase } from "./database";
import type { CurrentUser } from "./auth/current-user";
import type {
  OfflineCatalogSnapshot,
} from "@/shared/offline-catalog";
import { toOfflineCatalogProduct } from "@/shared/offline-catalog";

export type SellableProduct = {
  id: string;
  priceVersionId: string;
  name: string;
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
  minimumPricePaise: number;
  ownerFloorPaise?: number;
  trustedOperatorFloorPaise?: number;
  storeOperatorFloorPaise?: number;
  inventoryValuePaise?: number;
  latestLandedCostPaise?: number;
  weightedAverageCostPaise?: number;
};

export const SELLABLE_PRODUCTS_SQL = `
  SELECT
    v.id, pv.id AS price_version_id, p.name, v.variant_name, v.sku, b.barcodes[1] AS barcode,
    b.barcodes,
    v.rack_location, ib.quantity_on_hand, pv.mrp_paise, pv.standard_price_paise,
    GREATEST(
      CASE $2
        WHEN 'BUSINESS_OWNER' THEN pv.owner_floor_paise
        WHEN 'TRUSTED_OPERATOR' THEN pv.trusted_operator_floor_paise
        ELSE pv.store_operator_floor_paise
      END,
      ib.latest_landed_cost_paise
    ) AS minimum_price_paise,
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
      $3 = '' OR v.sku = $3 OR
      EXISTS (SELECT 1 FROM barcodes bx WHERE bx.variant_id = v.id AND bx.barcode_value = $3) OR
      p.name ILIKE '%' || $3 || '%' OR v.variant_name ILIKE '%' || $3 || '%'
    )
  ORDER BY
    CASE WHEN v.sku = $3 OR $3 = ANY(b.barcodes) THEN 0 ELSE 1 END,
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
    variant_name: string | null;
    sku: string;
    barcode: string;
    barcodes: string[];
    rack_location: string | null;
    quantity_on_hand: number;
    mrp_paise: string;
    standard_price_paise: string;
    minimum_price_paise: string;
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
    variantName: row.variant_name,
    sku: row.sku,
    barcode: row.barcode,
    barcodes: row.barcodes,
    rackLocation: row.rack_location,
    stock: row.quantity_on_hand,
    ...(row.open_box_quantity === null || row.damaged_quantity === null
      ? {}
      : {
          openBoxStock: row.open_box_quantity,
          damagedStock: row.damaged_quantity,
        }),
    mrpPaise: Number(row.mrp_paise),
    standardPricePaise: Number(row.standard_price_paise),
    minimumPricePaise: Number(row.minimum_price_paise),
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

export async function getOfflineCatalogSnapshot(
  user: CurrentUser,
): Promise<OfflineCatalogSnapshot> {
  const products = await loadSellableProducts(user, "", 5_000);
  return {
    asOf: new Date().toISOString(),
    products: products.map(toOfflineCatalogProduct),
  };
}
