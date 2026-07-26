import "server-only";

import { getDatabase } from "./database";
import type { CurrentUser } from "./auth/current-user";

export type SellableProduct = {
  id: string;
  name: string;
  variantName: string | null;
  sku: string;
  barcode: string;
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

export async function searchSellableProducts(
  user: CurrentUser,
  query: string,
): Promise<SellableProduct[]> {
  const result = await getDatabase().query<{
    id: string;
    name: string;
    variant_name: string | null;
    sku: string;
    barcode: string;
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
    `SELECT
       v.id, p.name, v.variant_name, v.sku, b.barcode_value AS barcode,
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
       SELECT barcode_value
       FROM barcodes
       WHERE variant_id = v.id
       ORDER BY is_primary DESC, created_at
       LIMIT 1
     ) b ON true
     WHERE p.business_id = $1
       AND p.status = 'ACTIVE'
       AND v.status = 'ACTIVE'
       AND (
         $3 = '' OR v.sku = $3 OR
         EXISTS (SELECT 1 FROM barcodes bx WHERE bx.variant_id = v.id AND bx.barcode_value = $3) OR
         p.name ILIKE '%' || $3 || '%' OR v.variant_name ILIKE '%' || $3 || '%'
       )
     ORDER BY
       CASE WHEN v.sku = $3 OR b.barcode_value = $3 THEN 0 ELSE 1 END,
       p.name, v.variant_name
     LIMIT 12`,
    [user.businessId, user.role, query],
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    variantName: row.variant_name,
    sku: row.sku,
    barcode: row.barcode,
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
