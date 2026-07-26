import "server-only";

import type { CurrentUser } from "./auth/current-user";
import { getDatabase } from "./database";
import type { StockCondition } from "@/shared/stock-adjustment-policy";

export type InventoryMovementView = {
  id: string;
  movementType: string;
  stockCondition: string;
  quantityDelta: number;
  referenceType: string;
  referenceLabel: string;
  actorName: string;
  happenedAt: string;
  reason: string | null;
  note: string | null;
};

export type InventoryHistoryView = {
  product: {
    id: string;
    name: string;
    variantName: string | null;
    sku: string;
    rackLocation: string | null;
    reorderPolicyStatus?: "UNCONFIGURED" | "CONFIGURED" | "DISABLED";
    reorderPoint?: number | null;
    restockTarget?: number | null;
  };
  balances: Record<StockCondition, number>;
  ledgerBalances: Record<StockCondition, number>;
  reconciled: boolean;
  inventoryValuePaise?: number;
  weightedAverageCostPaise?: number;
  latestLandedCostPaise?: number;
  movementCount: number;
  movements: InventoryMovementView[];
};

export class InventoryHistoryUnavailableError extends Error {
  readonly status = 404;
  readonly code = "INVENTORY_HISTORY_UNAVAILABLE";

  constructor() {
    super("This product is no longer available.");
    this.name = "InventoryHistoryUnavailableError";
  }
}

export async function getInventoryHistory(
  user: CurrentUser,
  variantId: string,
): Promise<InventoryHistoryView> {
  const database = getDatabase();
  const product = await database.query<{
    id: string;
    name: string;
    variant_name: string | null;
    sku: string;
    rack_location: string | null;
    quantity_on_hand: number;
    inventory_value_paise: string;
    latest_landed_cost_paise: string;
    open_box_quantity: number;
    damaged_quantity: number;
    reorder_policy_status: "UNCONFIGURED" | "CONFIGURED" | "DISABLED";
    reorder_point: number | null;
    restock_target: number | null;
  }>(
    `SELECT
       v.id, p.name, v.variant_name, v.sku, v.rack_location,
       ib.quantity_on_hand, ib.inventory_value_paise,
       ib.latest_landed_cost_paise,
       CASE
         WHEN v.reorder_point IS NOT NULL THEN 'CONFIGURED'
         WHEN EXISTS (
           SELECT 1 FROM reorder_policy_changes rpc
           WHERE rpc.variant_id = v.id
         ) THEN 'DISABLED'
         ELSE 'UNCONFIGURED'
       END AS reorder_policy_status,
       v.reorder_point, v.restock_target,
       COALESCE(conditions.open_box_quantity, 0)::int AS open_box_quantity,
       COALESCE(conditions.damaged_quantity, 0)::int AS damaged_quantity
     FROM product_variants v
     JOIN products p ON p.id = v.product_id
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
       FROM inventory_condition_balances
       WHERE location_id = ib.location_id AND variant_id = v.id
     ) conditions ON true
     WHERE v.id = $1 AND p.business_id = $2
       AND p.status = 'ACTIVE' AND v.status = 'ACTIVE'
     ORDER BY l.created_at
     LIMIT 1`,
    [variantId, user.businessId],
  );
  const current = product.rows[0];
  if (!current) throw new InventoryHistoryUnavailableError();

  const [ledger, movements, count] = await Promise.all([
    database.query<{ stock_condition: string; quantity: number }>(
      `SELECT stock_condition, COALESCE(sum(quantity_delta), 0)::int AS quantity
         FROM inventory_movements
        WHERE business_id = $1 AND variant_id = $2
        GROUP BY stock_condition`,
      [user.businessId, variantId],
    ),
    database.query<{
      id: string;
      movement_type: string;
      stock_condition: string;
      quantity_delta: number;
      reference_type: string;
      reference_label: string | null;
      actor_name: string;
      created_at: Date;
      reason_code: string | null;
      note: string | null;
    }>(
      `SELECT
         m.id, m.movement_type, m.stock_condition, m.quantity_delta,
         m.reference_type,
         COALESCE(
           s.sale_number,
           r.receipt_number,
           CASE WHEN a.id IS NOT NULL
             THEN 'Count ' || upper(left(a.id::text, 8))
           END,
           initcap(replace(m.reference_type, '_', ' '))
         ) AS reference_label,
         u.display_name AS actor_name, m.created_at,
         a.reason_code, a.note
       FROM inventory_movements m
       JOIN app_users u ON u.id = m.created_by
       LEFT JOIN sales s
         ON m.reference_type = 'SALE' AND s.id = m.reference_id
       LEFT JOIN stock_receipts r
         ON m.reference_type = 'STOCK_RECEIPT' AND r.id = m.reference_id
       LEFT JOIN stock_adjustments a
         ON m.reference_type = 'STOCK_ADJUSTMENT' AND a.id = m.reference_id
       WHERE m.business_id = $1 AND m.variant_id = $2
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT 200`,
      [user.businessId, variantId],
    ),
    database.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM inventory_movements
        WHERE business_id = $1 AND variant_id = $2`,
      [user.businessId, variantId],
    ),
  ]);

  const ledgerBalances: Record<StockCondition, number> = {
    SELLABLE: 0,
    OPEN_BOX: 0,
    DAMAGED: 0,
  };
  for (const row of ledger.rows) {
    if (row.stock_condition in ledgerBalances) {
      ledgerBalances[row.stock_condition as StockCondition] = row.quantity;
    }
  }
  const balances: Record<StockCondition, number> = {
    SELLABLE: current.quantity_on_hand,
    OPEN_BOX: current.open_box_quantity,
    DAMAGED: current.damaged_quantity,
  };

  return {
    product: {
      id: current.id,
      name: current.name,
      variantName: current.variant_name,
      sku: current.sku,
      rackLocation: current.rack_location,
      ...(user.role === "BUSINESS_OWNER"
        ? {
            reorderPolicyStatus: current.reorder_policy_status,
            reorderPoint: current.reorder_point,
            restockTarget: current.restock_target,
          }
        : {}),
    },
    balances,
    ledgerBalances,
    reconciled:
      balances.SELLABLE === ledgerBalances.SELLABLE
      && balances.OPEN_BOX === ledgerBalances.OPEN_BOX
      && balances.DAMAGED === ledgerBalances.DAMAGED,
    ...(user.role === "BUSINESS_OWNER"
      ? {
          inventoryValuePaise: Number(current.inventory_value_paise),
          weightedAverageCostPaise:
            current.quantity_on_hand > 0
              ? Math.round(
                Number(current.inventory_value_paise)
                / current.quantity_on_hand,
              )
              : 0,
          latestLandedCostPaise: Number(current.latest_landed_cost_paise),
        }
      : {}),
    movementCount: count.rows[0].count,
    movements: movements.rows.map((row) => ({
      id: row.id,
      movementType: row.movement_type,
      stockCondition: row.stock_condition,
      quantityDelta: row.quantity_delta,
      referenceType: row.reference_type,
      referenceLabel: row.reference_label ?? "Operational record",
      actorName: row.actor_name,
      happenedAt: row.created_at.toISOString(),
      reason: row.reason_code,
      note: row.note,
    })),
  };
}
