import "server-only";

import type { CurrentUser } from "./auth/current-user";
import { requireRole } from "./auth/roles";
import { database } from "./database";

export type OwnerDashboard = {
  asOf: string;
  businessDate: string;
  today: {
    revenuePaise: number;
    orderCount: number;
    unitCount: number;
    accountingGrossProductProfitPaise: number;
    replacementMarginPaise: number;
  };
  payments: Array<{
    paymentMode: string;
    amountPaise: number;
  }>;
  sellers: Array<{
    userId: string;
    name: string;
    orderCount: number;
    unitCount: number;
    revenuePaise: number;
  }>;
  stock: {
    activeSkuCount: number;
    sellableUnitCount: number;
    outOfStockCount: number;
    lowStockCount: number;
    configuredReorderPolicyCount: number;
    unconfiguredReorderPolicyCount: number;
    disabledReorderPolicyCount: number;
  };
  lowStockProducts: Array<{
    variantId: string;
    productName: string;
    sku: string;
    rackLocation: string | null;
    quantity: number;
    reorderPolicyStatus: "UNCONFIGURED" | "CONFIGURED";
    reorderPoint: number | null;
    restockTarget: number | null;
    suggestedReorderQuantity: number | null;
  }>;
  unconfiguredReorderProducts: Array<{
    variantId: string;
    productName: string;
    sku: string;
    rackLocation: string | null;
    quantity: number;
  }>;
  actions: {
    priceApprovals: number;
    guestApprovals: number;
    stockAdjustments: number;
    receiptDrafts: number;
  };
  dataQuality: {
    ledgerMismatchCount: number;
    missingRackCount: number;
    missingBalanceCount: number;
    missingActivePriceCount: number;
  };
};

export async function getOwnerDashboard(
  user: CurrentUser,
): Promise<OwnerDashboard> {
  requireRole(user.role, ["BUSINESS_OWNER"]);

  const [
    businessDate,
    today,
    payments,
    sellers,
    stock,
    lowStockProducts,
    unconfiguredReorderProducts,
    actions,
    dataQuality,
  ] = await Promise.all([
    database.query<{ business_date: string }>(
      "SELECT to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS business_date",
    ),
    database.query<{
      revenue_paise: string;
      order_count: number;
      unit_count: number;
      accounting_gross_product_profit_paise: string;
      replacement_margin_paise: string;
    }>(
      `WITH bounds AS (
         SELECT
           date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata')
             AT TIME ZONE 'Asia/Kolkata' AS starts_at,
           (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata')
             + interval '1 day') AT TIME ZONE 'Asia/Kolkata' AS ends_at
       ),
       today_sales AS (
         SELECT s.id, s.total_paise
           FROM sales s, bounds b
          WHERE s.business_id = $1 AND s.status = 'COMPLETED'
            AND s.completed_at >= b.starts_at AND s.completed_at < b.ends_at
       ),
       line_totals AS (
         SELECT
           sl.sale_id, sum(sl.quantity)::int AS unit_count,
           sum(sl.accounting_cogs_paise)::bigint AS accounting_cogs_paise,
           sum(sl.quantity::bigint * sl.replacement_unit_cost_paise)::bigint
             AS replacement_cost_paise
         FROM sale_lines sl
         JOIN today_sales s ON s.id = sl.sale_id
         GROUP BY sl.sale_id
       )
       SELECT
         COALESCE(sum(s.total_paise), 0)::bigint AS revenue_paise,
         count(s.id)::int AS order_count,
         COALESCE(sum(l.unit_count), 0)::int AS unit_count,
         COALESCE(sum(s.total_paise - l.accounting_cogs_paise), 0)::bigint
           AS accounting_gross_product_profit_paise,
         COALESCE(sum(s.total_paise - l.replacement_cost_paise), 0)::bigint
           AS replacement_margin_paise
       FROM today_sales s
       LEFT JOIN line_totals l ON l.sale_id = s.id`,
      [user.businessId],
    ),
    database.query<{ payment_mode: string; amount_paise: string }>(
      `WITH bounds AS (
         SELECT
           date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata')
             AT TIME ZONE 'Asia/Kolkata' AS starts_at,
           (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata')
             + interval '1 day') AT TIME ZONE 'Asia/Kolkata' AS ends_at
       )
       SELECT p.payment_mode, sum(p.amount_paise)::bigint AS amount_paise
         FROM sale_payments p
         JOIN sales s ON s.id = p.sale_id
         JOIN bounds b ON true
        WHERE s.business_id = $1 AND s.status = 'COMPLETED'
          AND s.completed_at >= b.starts_at AND s.completed_at < b.ends_at
        GROUP BY p.payment_mode
        ORDER BY p.payment_mode`,
      [user.businessId],
    ),
    database.query<{
      user_id: string;
      name: string;
      order_count: number;
      unit_count: number;
      revenue_paise: string;
    }>(
      `WITH bounds AS (
         SELECT
           date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata')
             AT TIME ZONE 'Asia/Kolkata' AS starts_at,
           (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata')
             + interval '1 day') AT TIME ZONE 'Asia/Kolkata' AS ends_at
       ),
       today_sales AS (
         SELECT s.id, s.created_by, s.total_paise
           FROM sales s
           JOIN bounds b ON true
          WHERE s.business_id = $1 AND s.status = 'COMPLETED'
            AND s.completed_at >= b.starts_at AND s.completed_at < b.ends_at
       ),
       sale_units AS (
         SELECT sl.sale_id, sum(sl.quantity)::int AS unit_count
           FROM sale_lines sl
           JOIN today_sales s ON s.id = sl.sale_id
          GROUP BY sl.sale_id
       )
       SELECT
         u.id AS user_id, u.display_name AS name,
         count(s.id)::int AS order_count,
         COALESCE(sum(units.unit_count), 0)::int AS unit_count,
         COALESCE(sum(s.total_paise), 0)::bigint AS revenue_paise
       FROM today_sales s
       JOIN app_users u ON u.id = s.created_by
       LEFT JOIN sale_units units ON units.sale_id = s.id
       GROUP BY u.id, u.display_name
       ORDER BY revenue_paise DESC, name`,
      [user.businessId],
    ),
    database.query<{
      active_sku_count: number;
      sellable_unit_count: number;
      out_of_stock_count: number;
      low_stock_count: number;
      configured_reorder_policy_count: number;
      unconfigured_reorder_policy_count: number;
      disabled_reorder_policy_count: number;
    }>(
      `SELECT
         count(v.id)::int AS active_sku_count,
         COALESCE(sum(ib.quantity_on_hand), 0)::int AS sellable_unit_count,
         count(v.id) FILTER (WHERE ib.quantity_on_hand = 0)::int
           AS out_of_stock_count,
         count(v.id) FILTER (
           WHERE v.reorder_point IS NOT NULL
             AND ib.quantity_on_hand <= v.reorder_point
         )::int AS low_stock_count
         ,
         count(v.id) FILTER (
           WHERE v.reorder_point IS NOT NULL
         )::int AS configured_reorder_policy_count,
         count(v.id) FILTER (
           WHERE v.reorder_point IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM reorder_policy_changes rpc
               WHERE rpc.variant_id = v.id
             )
         )::int AS unconfigured_reorder_policy_count,
         count(v.id) FILTER (
           WHERE v.reorder_point IS NULL
             AND EXISTS (
               SELECT 1 FROM reorder_policy_changes rpc
               WHERE rpc.variant_id = v.id
             )
         )::int AS disabled_reorder_policy_count
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       JOIN inventory_balances ib ON ib.variant_id = v.id
       WHERE p.business_id = $1
         AND p.status = 'ACTIVE' AND v.status = 'ACTIVE'`,
      [user.businessId],
    ),
    database.query<{
      variant_id: string;
      product_name: string;
      sku: string;
      rack_location: string | null;
      quantity: number;
      reorder_policy_status: "UNCONFIGURED" | "CONFIGURED";
      reorder_point: number | null;
      restock_target: number | null;
      suggested_reorder_quantity: number | null;
    }>(
      `SELECT
         v.id AS variant_id, p.name AS product_name, v.sku,
         v.rack_location, ib.quantity_on_hand AS quantity,
         CASE WHEN v.reorder_point IS NULL
           THEN 'UNCONFIGURED' ELSE 'CONFIGURED'
         END AS reorder_policy_status,
         v.reorder_point, v.restock_target,
         CASE WHEN v.restock_target IS NULL THEN NULL
           ELSE GREATEST(v.restock_target - ib.quantity_on_hand, 0)
         END::int AS suggested_reorder_quantity
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       JOIN inventory_balances ib ON ib.variant_id = v.id
       WHERE p.business_id = $1
         AND p.status = 'ACTIVE' AND v.status = 'ACTIVE'
         AND (
           ib.quantity_on_hand = 0
           OR (
             v.reorder_point IS NOT NULL
             AND ib.quantity_on_hand <= v.reorder_point
           )
         )
       ORDER BY
         ib.quantity_on_hand,
         v.reorder_point NULLS LAST,
         p.name, v.variant_name
       LIMIT 20`,
      [user.businessId],
    ),
    database.query<{
      variant_id: string;
      product_name: string;
      sku: string;
      rack_location: string | null;
      quantity: number;
    }>(
      `SELECT
         v.id AS variant_id, p.name AS product_name, v.sku,
         v.rack_location, ib.quantity_on_hand AS quantity
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       JOIN inventory_balances ib ON ib.variant_id = v.id
       WHERE p.business_id = $1
         AND p.status = 'ACTIVE' AND v.status = 'ACTIVE'
         AND v.reorder_point IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM reorder_policy_changes rpc
           WHERE rpc.variant_id = v.id
         )
       ORDER BY p.name, v.variant_name
       LIMIT 20`,
      [user.businessId],
    ),
    database.query<{
      price_approvals: number;
      guest_approvals: number;
      stock_adjustments: number;
      receipt_drafts: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM price_approval_requests
           WHERE business_id = $1 AND status = 'PENDING' AND expires_at > now())
           AS price_approvals,
         (SELECT count(*)::int FROM guest_sale_approval_requests
           WHERE business_id = $1 AND status = 'PENDING' AND expires_at > now())
           AS guest_approvals,
         (SELECT count(*)::int FROM stock_adjustments
           WHERE business_id = $1 AND status = 'REQUESTED')
           AS stock_adjustments,
         (SELECT count(*)::int FROM stock_receipts
           WHERE business_id = $1 AND status = 'DRAFT')
           AS receipt_drafts`,
      [user.businessId],
    ),
    database.query<{
      ledger_mismatch_count: number;
      missing_rack_count: number;
      missing_balance_count: number;
      missing_active_price_count: number;
    }>(
      `WITH active_variants AS (
         SELECT v.id, v.rack_location
           FROM product_variants v
           JOIN products p ON p.id = v.product_id
          WHERE p.business_id = $1
            AND p.status = 'ACTIVE' AND v.status = 'ACTIVE'
       ),
       projected AS (
         SELECT
           av.id,
           ib.quantity_on_hand,
           COALESCE(sum(m.quantity_delta) FILTER (
             WHERE m.stock_condition = 'SELLABLE'
           ), 0)::int AS ledger_quantity
         FROM active_variants av
         LEFT JOIN inventory_balances ib ON ib.variant_id = av.id
         LEFT JOIN inventory_movements m
           ON m.variant_id = av.id AND m.business_id = $1
         GROUP BY av.id, ib.quantity_on_hand
       )
       SELECT
         count(*) FILTER (
           WHERE quantity_on_hand IS NOT NULL
             AND quantity_on_hand <> ledger_quantity
         )::int AS ledger_mismatch_count,
         (SELECT count(*)::int FROM active_variants WHERE rack_location IS NULL)
           AS missing_rack_count,
         count(*) FILTER (WHERE quantity_on_hand IS NULL)::int
           AS missing_balance_count,
         (SELECT count(*)::int
            FROM active_variants av
            LEFT JOIN price_versions pv
              ON pv.variant_id = av.id AND pv.effective_to IS NULL
           WHERE pv.id IS NULL) AS missing_active_price_count
       FROM projected`,
      [user.businessId],
    ),
  ]);

  const todayRow = today.rows[0];
  const stockRow = stock.rows[0];
  const actionRow = actions.rows[0];
  const qualityRow = dataQuality.rows[0];

  return {
    asOf: new Date().toISOString(),
    businessDate: businessDate.rows[0].business_date,
    today: {
      revenuePaise: Number(todayRow.revenue_paise),
      orderCount: todayRow.order_count,
      unitCount: todayRow.unit_count,
      accountingGrossProductProfitPaise: Number(
        todayRow.accounting_gross_product_profit_paise,
      ),
      replacementMarginPaise: Number(todayRow.replacement_margin_paise),
    },
    payments: payments.rows.map((row) => ({
      paymentMode: row.payment_mode,
      amountPaise: Number(row.amount_paise),
    })),
    sellers: sellers.rows.map((row) => ({
      userId: row.user_id,
      name: row.name,
      orderCount: row.order_count,
      unitCount: row.unit_count,
      revenuePaise: Number(row.revenue_paise),
    })),
    stock: {
      activeSkuCount: stockRow.active_sku_count,
      sellableUnitCount: stockRow.sellable_unit_count,
      outOfStockCount: stockRow.out_of_stock_count,
      lowStockCount: stockRow.low_stock_count,
      configuredReorderPolicyCount: stockRow.configured_reorder_policy_count,
      unconfiguredReorderPolicyCount:
        stockRow.unconfigured_reorder_policy_count,
      disabledReorderPolicyCount: stockRow.disabled_reorder_policy_count,
    },
    lowStockProducts: lowStockProducts.rows.map((row) => ({
      variantId: row.variant_id,
      productName: row.product_name,
      sku: row.sku,
      rackLocation: row.rack_location,
      quantity: row.quantity,
      reorderPolicyStatus: row.reorder_policy_status,
      reorderPoint: row.reorder_point,
      restockTarget: row.restock_target,
      suggestedReorderQuantity: row.suggested_reorder_quantity,
    })),
    unconfiguredReorderProducts: unconfiguredReorderProducts.rows.map((row) => ({
      variantId: row.variant_id,
      productName: row.product_name,
      sku: row.sku,
      rackLocation: row.rack_location,
      quantity: row.quantity,
    })),
    actions: {
      priceApprovals: actionRow.price_approvals,
      guestApprovals: actionRow.guest_approvals,
      stockAdjustments: actionRow.stock_adjustments,
      receiptDrafts: actionRow.receipt_drafts,
    },
    dataQuality: {
      ledgerMismatchCount: qualityRow.ledger_mismatch_count,
      missingRackCount: qualityRow.missing_rack_count,
      missingBalanceCount: qualityRow.missing_balance_count,
      missingActivePriceCount: qualityRow.missing_active_price_count,
    },
  };
}
