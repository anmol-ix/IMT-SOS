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

export type InventoryPurchaseView = {
  id: string;
  receiptNumber: string;
  supplierName: string;
  supplierInvoiceReference: string | null;
  sellableQuantity: number;
  openBoxQuantity: number;
  damagedQuantity: number;
  invoiceUnitCostPaise?: number;
  happenedAt: string;
};

export type InventorySaleView = {
  id: string;
  saleNumber: string;
  customerName: string;
  salesChannel: string;
  quantity: number;
  unitPricePaise: number;
  mrpPaise: number;
  standardPricePaise: number;
  accountingCogsPaise?: number;
  grossProductProfitPaise?: number;
  happenedAt: string;
};

export type InventoryHistoryView = {
  product: {
    id: string;
    name: string;
    category: string | null;
    variantName: string | null;
    sku: string;
    barcode: string;
    rackLocation: string | null;
    mrpPaise: number;
    standardPricePaise: number;
    minimumPricePaise: number;
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
  purchases: InventoryPurchaseView[];
  sales: InventorySaleView[];
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
    category: string | null;
    variant_name: string | null;
    sku: string;
    barcode: string;
    rack_location: string | null;
    mrp_paise: string;
    standard_price_paise: string;
    minimum_price_paise: string;
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
       v.id, p.name, p.category, v.variant_name, v.sku,
       barcode.barcode_value AS barcode, v.rack_location,
       pv.mrp_paise, pv.standard_price_paise,
       GREATEST(
         CASE $3
           WHEN 'BUSINESS_OWNER' THEN pv.owner_floor_paise
           WHEN 'TRUSTED_OPERATOR' THEN pv.trusted_operator_floor_paise
           ELSE pv.store_operator_floor_paise
         END,
         ib.latest_landed_cost_paise
       ) AS minimum_price_paise,
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
     JOIN price_versions pv ON pv.variant_id = v.id AND pv.effective_to IS NULL
     JOIN inventory_balances ib ON ib.variant_id = v.id
     JOIN locations l ON l.id = ib.location_id AND l.status = 'ACTIVE'
     JOIN LATERAL (
       SELECT barcode_value
         FROM barcodes
        WHERE variant_id = v.id
        ORDER BY is_primary DESC, created_at
        LIMIT 1
     ) barcode ON true
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
    [variantId, user.businessId, user.role],
  );
  const current = product.rows[0];
  if (!current) throw new InventoryHistoryUnavailableError();

  const [ledger, movements, count, purchases, sales] = await Promise.all([
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
    database.query<{
      id: string;
      receipt_number: string;
      supplier_name: string;
      supplier_invoice_reference: string | null;
      sellable_quantity: number;
      open_box_quantity: number;
      damaged_quantity: number;
      invoice_unit_cost_paise: string;
      completed_at: Date;
    }>(
      `SELECT
         rl.id, r.receipt_number, COALESCE(s.name, r.supplier_name) AS supplier_name,
         r.supplier_invoice_reference, rl.sellable_quantity,
         rl.open_box_quantity, rl.damaged_quantity,
         rl.invoice_unit_cost_paise, r.completed_at
       FROM stock_receipt_lines rl
       JOIN stock_receipts r ON r.id = rl.receipt_id
       LEFT JOIN suppliers s ON s.id = r.supplier_id
       WHERE r.business_id = $1 AND rl.variant_id = $2
         AND r.status = 'COMPLETED'
       ORDER BY r.completed_at DESC, rl.id DESC
       LIMIT 100`,
      [user.businessId, variantId],
    ),
    database.query<{
      id: string;
      sale_number: string;
      customer_name: string | null;
      sales_channel: string;
      quantity: number;
      unit_price_paise: string;
      mrp_paise: string;
      standard_price_paise: string;
      accounting_cogs_paise: string;
      completed_at: Date;
    }>(
      `SELECT
         sl.id, s.sale_number, COALESCE(c.name, s.customer_name, 'Walk-in customer')
           AS customer_name,
         s.sales_channel, sl.quantity, sl.unit_price_paise,
         sl.mrp_paise, sl.standard_price_paise,
         sl.accounting_cogs_paise, s.completed_at
       FROM sale_lines sl
       JOIN sales s ON s.id = sl.sale_id
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.business_id = $1 AND sl.variant_id = $2
         AND s.status = 'COMPLETED'
       ORDER BY s.completed_at DESC, sl.id DESC
       LIMIT 100`,
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
      category: current.category,
      variantName: current.variant_name,
      sku: current.sku,
      barcode: current.barcode,
      rackLocation: current.rack_location,
      mrpPaise: Number(current.mrp_paise),
      standardPricePaise: Number(current.standard_price_paise),
      minimumPricePaise: Number(current.minimum_price_paise),
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
    purchases: purchases.rows.map((row) => ({
      id: row.id,
      receiptNumber: row.receipt_number,
      supplierName: row.supplier_name,
      supplierInvoiceReference: row.supplier_invoice_reference,
      sellableQuantity: row.sellable_quantity,
      openBoxQuantity: row.open_box_quantity,
      damagedQuantity: row.damaged_quantity,
      ...(user.role === "BUSINESS_OWNER"
        ? { invoiceUnitCostPaise: Number(row.invoice_unit_cost_paise) }
        : {}),
      happenedAt: row.completed_at.toISOString(),
    })),
    sales: sales.rows.map((row) => {
      const total = Number(row.unit_price_paise) * row.quantity;
      const accountingCogs = Number(row.accounting_cogs_paise);
      return {
        id: row.id,
        saleNumber: row.sale_number,
        customerName: row.customer_name ?? "Walk-in customer",
        salesChannel: row.sales_channel,
        quantity: row.quantity,
        unitPricePaise: Number(row.unit_price_paise),
        mrpPaise: Number(row.mrp_paise),
        standardPricePaise: Number(row.standard_price_paise),
        ...(user.role === "BUSINESS_OWNER"
          ? {
              accountingCogsPaise: accountingCogs,
              grossProductProfitPaise: total - accountingCogs,
            }
          : {}),
        happenedAt: row.completed_at.toISOString(),
      };
    }),
  };
}
