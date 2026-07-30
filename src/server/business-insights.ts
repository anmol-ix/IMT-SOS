import "server-only";

import type { CurrentUser } from "./auth/current-user";
import { requireRole } from "./auth/roles";
import { getDatabase } from "./database";

type ScorecardRow = {
  today_revenue_paise: string;
  today_order_count: number;
  today_unit_count: number;
  month_revenue_paise: string;
  month_order_count: number;
  month_unit_count: number;
  month_cogs_paise: string;
  month_replacement_cost_paise: string;
  previous_revenue_paise: string;
  previous_order_count: number;
  previous_gross_profit_paise: string;
  year_revenue_paise: string;
  previous_year_revenue_paise: string;
  previous_year_order_count: number;
  last_sale_at: Date | null;
};

export type BusinessInsights = {
  asOf: string;
  today: {
    revenuePaise: number;
    orderCount: number;
    unitCount: number;
  };
  month: {
    revenuePaise: number;
    orderCount: number;
    unitCount: number;
    accountingGrossProductProfitPaise: number;
    replacementMarginPaise: number;
    averageOrderPaise: number;
  };
  previousComparableMonth: {
    revenuePaise: number;
    orderCount: number;
    accountingGrossProductProfitPaise: number;
  };
  year: {
    revenuePaise: number;
    previousComparableRevenuePaise: number;
    comparisonAvailable: boolean;
  };
  lastSaleAt: string | null;
  monthlyTrend: Array<{
    monthKey: string;
    monthLabel: string;
    revenuePaise: number;
    orderCount: number;
    unitCount: number;
    accountingGrossProductProfitPaise: number;
  }>;
  channels: Array<{
    saleType: "RETAIL" | "WHOLESALE";
    revenuePaise: number;
    orderCount: number;
    unitCount: number;
  }>;
  topProducts: Array<{
    variantId: string;
    productName: string;
    sku: string;
    revenuePaise: number;
    unitCount: number;
    accountingGrossProductProfitPaise: number;
  }>;
  stock: {
    activeSkuCount: number;
    sellableUnitCount: number;
    stockValuePaise: number;
    reviewSkuCount: number;
    reviewValuePaise: number;
  };
  stockToReview: Array<{
    variantId: string;
    productName: string;
    sku: string;
    quantity: number;
    stockValuePaise: number;
    lastSoldAt: string | null;
  }>;
};

export async function getBusinessInsights(
  user: CurrentUser,
): Promise<BusinessInsights> {
  requireRole(user.role, ["BUSINESS_OWNER"]);
  const database = getDatabase();

  const [scorecard, trend, channels, topProducts, stock] = await Promise.all([
    database.query<ScorecardRow>(
      `WITH clock AS (
         SELECT now() AT TIME ZONE 'Asia/Kolkata' AS local_now
       ),
       bounds AS (
         SELECT
           date_trunc('day', local_now) AS today_start,
           date_trunc('month', local_now) AS month_start,
           local_now AS period_end,
           date_trunc('month', local_now) - interval '1 month' AS previous_start,
           LEAST(
             date_trunc('month', local_now),
             date_trunc('month', local_now) - interval '1 month'
               + (local_now - date_trunc('month', local_now))
           ) AS previous_end,
           date_trunc('year', local_now) AS year_start,
           date_trunc('year', local_now) - interval '1 year'
             AS previous_year_start,
           date_trunc('year', local_now) - interval '1 year'
             + (local_now - date_trunc('year', local_now))
             AS previous_year_end
         FROM clock
       ),
       sale_rollup AS (
         SELECT
           s.id, s.completed_at, s.total_paise,
           COALESCE(sum(sl.quantity), 0)::int AS unit_count,
           COALESCE(sum(sl.accounting_cogs_paise), 0)::bigint
             AS accounting_cogs_paise,
           COALESCE(sum(sl.quantity::bigint * sl.replacement_unit_cost_paise), 0)::bigint
             AS replacement_cost_paise
         FROM sales s
         LEFT JOIN sale_lines sl ON sl.sale_id = s.id
         WHERE s.business_id = $1 AND s.status = 'COMPLETED'
         GROUP BY s.id
       )
       SELECT
         COALESCE(sum(total_paise) FILTER (
           WHERE completed_at >= today_start AT TIME ZONE 'Asia/Kolkata'
             AND completed_at < period_end AT TIME ZONE 'Asia/Kolkata'
         ), 0)::bigint AS today_revenue_paise,
         count(*) FILTER (
           WHERE completed_at >= today_start AT TIME ZONE 'Asia/Kolkata'
             AND completed_at < period_end AT TIME ZONE 'Asia/Kolkata'
         )::int AS today_order_count,
         COALESCE(sum(unit_count) FILTER (
           WHERE completed_at >= today_start AT TIME ZONE 'Asia/Kolkata'
             AND completed_at < period_end AT TIME ZONE 'Asia/Kolkata'
         ), 0)::int AS today_unit_count,
         COALESCE(sum(total_paise) FILTER (
           WHERE completed_at >= month_start AT TIME ZONE 'Asia/Kolkata'
             AND completed_at < period_end AT TIME ZONE 'Asia/Kolkata'
         ), 0)::bigint AS month_revenue_paise,
         count(*) FILTER (
           WHERE completed_at >= month_start AT TIME ZONE 'Asia/Kolkata'
             AND completed_at < period_end AT TIME ZONE 'Asia/Kolkata'
         )::int AS month_order_count,
         COALESCE(sum(unit_count) FILTER (
           WHERE completed_at >= month_start AT TIME ZONE 'Asia/Kolkata'
             AND completed_at < period_end AT TIME ZONE 'Asia/Kolkata'
         ), 0)::int AS month_unit_count,
         COALESCE(sum(accounting_cogs_paise) FILTER (
           WHERE completed_at >= month_start AT TIME ZONE 'Asia/Kolkata'
             AND completed_at < period_end AT TIME ZONE 'Asia/Kolkata'
         ), 0)::bigint AS month_cogs_paise,
         COALESCE(sum(replacement_cost_paise) FILTER (
           WHERE completed_at >= month_start AT TIME ZONE 'Asia/Kolkata'
             AND completed_at < period_end AT TIME ZONE 'Asia/Kolkata'
         ), 0)::bigint AS month_replacement_cost_paise,
         COALESCE(sum(total_paise) FILTER (
           WHERE completed_at >= previous_start AT TIME ZONE 'Asia/Kolkata'
             AND completed_at < previous_end AT TIME ZONE 'Asia/Kolkata'
         ), 0)::bigint AS previous_revenue_paise,
         count(*) FILTER (
           WHERE completed_at >= previous_start AT TIME ZONE 'Asia/Kolkata'
             AND completed_at < previous_end AT TIME ZONE 'Asia/Kolkata'
         )::int AS previous_order_count,
         COALESCE(sum(total_paise - accounting_cogs_paise) FILTER (
           WHERE completed_at >= previous_start AT TIME ZONE 'Asia/Kolkata'
             AND completed_at < previous_end AT TIME ZONE 'Asia/Kolkata'
         ), 0)::bigint AS previous_gross_profit_paise,
         COALESCE(sum(total_paise) FILTER (
           WHERE completed_at >= year_start AT TIME ZONE 'Asia/Kolkata'
             AND completed_at < period_end AT TIME ZONE 'Asia/Kolkata'
         ), 0)::bigint AS year_revenue_paise,
         COALESCE(sum(total_paise) FILTER (
           WHERE completed_at >= previous_year_start AT TIME ZONE 'Asia/Kolkata'
             AND completed_at < previous_year_end AT TIME ZONE 'Asia/Kolkata'
         ), 0)::bigint AS previous_year_revenue_paise,
         count(*) FILTER (
           WHERE completed_at >= previous_year_start AT TIME ZONE 'Asia/Kolkata'
             AND completed_at < previous_year_end AT TIME ZONE 'Asia/Kolkata'
         )::int AS previous_year_order_count,
         max(completed_at) AS last_sale_at
       FROM sale_rollup, bounds`,
      [user.businessId],
    ),
    database.query<{
      month_key: string;
      month_label: string;
      revenue_paise: string;
      order_count: number;
      unit_count: number;
      accounting_gross_product_profit_paise: string;
    }>(
      `WITH months AS (
         SELECT generate_series(
           date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') - interval '5 months',
           date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata'),
           interval '1 month'
         ) AS month_start
       ),
       sale_rollup AS (
         SELECT
           s.id,
           date_trunc('month', s.completed_at AT TIME ZONE 'Asia/Kolkata')
             AS month_start,
           s.total_paise,
           COALESCE(sum(sl.quantity), 0)::int AS unit_count,
           COALESCE(sum(sl.accounting_cogs_paise), 0)::bigint
             AS accounting_cogs_paise
         FROM sales s
         LEFT JOIN sale_lines sl ON sl.sale_id = s.id
         WHERE s.business_id = $1 AND s.status = 'COMPLETED'
         GROUP BY s.id
       ),
       monthly AS (
         SELECT
           month_start,
           sum(total_paise)::bigint AS revenue_paise,
           count(*)::int AS order_count,
           sum(unit_count)::int AS unit_count,
           sum(total_paise - accounting_cogs_paise)::bigint
             AS accounting_gross_product_profit_paise
         FROM sale_rollup
         GROUP BY month_start
       )
       SELECT
         to_char(m.month_start, 'YYYY-MM') AS month_key,
         to_char(m.month_start, 'Mon') AS month_label,
         COALESCE(s.revenue_paise, 0)::bigint AS revenue_paise,
         COALESCE(s.order_count, 0)::int AS order_count,
         COALESCE(s.unit_count, 0)::int AS unit_count,
         COALESCE(s.accounting_gross_product_profit_paise, 0)::bigint
           AS accounting_gross_product_profit_paise
       FROM months m
       LEFT JOIN monthly s ON s.month_start = m.month_start
       ORDER BY m.month_start`,
      [user.businessId],
    ),
    database.query<{
      sale_type: "RETAIL" | "WHOLESALE";
      revenue_paise: string;
      order_count: number;
      unit_count: number;
    }>(
      `WITH month_sales AS (
         SELECT s.id, s.sale_type, s.total_paise
         FROM sales s
         WHERE s.business_id = $1 AND s.status = 'COMPLETED'
           AND s.completed_at >= (
             date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata')
               AT TIME ZONE 'Asia/Kolkata'
           )
       ),
       units AS (
         SELECT sale_id, sum(quantity)::int AS unit_count
         FROM sale_lines
         WHERE sale_id IN (SELECT id FROM month_sales)
         GROUP BY sale_id
       )
       SELECT
         s.sale_type,
         sum(s.total_paise)::bigint AS revenue_paise,
         count(*)::int AS order_count,
         COALESCE(sum(u.unit_count), 0)::int AS unit_count
       FROM month_sales s
       LEFT JOIN units u ON u.sale_id = s.id
       GROUP BY s.sale_type
       ORDER BY s.sale_type`,
      [user.businessId],
    ),
    database.query<{
      variant_id: string;
      product_name: string;
      sku: string;
      revenue_paise: string;
      unit_count: number;
      accounting_gross_product_profit_paise: string;
    }>(
      `SELECT
         v.id AS variant_id, p.name AS product_name, v.sku,
         sum(sl.line_total_paise)::bigint AS revenue_paise,
         sum(sl.quantity)::int AS unit_count,
         sum(sl.line_total_paise - sl.accounting_cogs_paise)::bigint
           AS accounting_gross_product_profit_paise
       FROM sales s
       JOIN sale_lines sl ON sl.sale_id = s.id
       JOIN product_variants v ON v.id = sl.variant_id
       JOIN products p ON p.id = v.product_id
       WHERE s.business_id = $1 AND s.status = 'COMPLETED'
         AND s.completed_at >= (
           date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata')
             AT TIME ZONE 'Asia/Kolkata'
         )
       GROUP BY v.id, p.name, v.sku
       ORDER BY revenue_paise DESC, unit_count DESC, p.name
       LIMIT 3`,
      [user.businessId],
    ),
    database.query<{
      active_sku_count: number;
      sellable_unit_count: number;
      stock_value_paise: string;
      review_sku_count: number;
      review_value_paise: string;
      review_products: Array<{
        variantId: string;
        productName: string;
        sku: string;
        quantity: number;
        stockValuePaise: number;
        lastSoldAt: string | null;
      }>;
    }>(
      `WITH last_sales AS (
         SELECT sl.variant_id, max(s.completed_at) AS last_sold_at
         FROM sale_lines sl
         JOIN sales s ON s.id = sl.sale_id
         WHERE s.business_id = $1 AND s.status = 'COMPLETED'
         GROUP BY sl.variant_id
       ),
       active_stock AS (
         SELECT
           v.id AS variant_id, p.name AS product_name, v.sku,
           ib.quantity_on_hand, ib.inventory_value_paise,
           ls.last_sold_at
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
         JOIN inventory_balances ib ON ib.variant_id = v.id
         LEFT JOIN last_sales ls ON ls.variant_id = v.id
         WHERE p.business_id = $1
           AND p.status = 'ACTIVE' AND v.status = 'ACTIVE'
       ),
       review AS (
         SELECT *
         FROM active_stock
         WHERE quantity_on_hand > 0
           AND (
             last_sold_at IS NULL
             OR last_sold_at < now() - interval '60 days'
           )
       ),
       review_products AS (
         SELECT jsonb_agg(
           jsonb_build_object(
             'variantId', variant_id,
             'productName', product_name,
             'sku', sku,
             'quantity', quantity_on_hand,
             'stockValuePaise', inventory_value_paise,
             'lastSoldAt', last_sold_at
           )
           ORDER BY inventory_value_paise DESC, product_name
         ) FILTER (WHERE rank <= 3) AS products
         FROM (
           SELECT review.*, row_number() OVER (
             ORDER BY inventory_value_paise DESC, product_name
           ) AS rank
           FROM review
         ) ranked
       )
       SELECT
         count(*)::int AS active_sku_count,
         COALESCE(sum(quantity_on_hand), 0)::int AS sellable_unit_count,
         COALESCE(sum(inventory_value_paise), 0)::bigint AS stock_value_paise,
         (SELECT count(*)::int FROM review) AS review_sku_count,
         (SELECT COALESCE(sum(inventory_value_paise), 0)::bigint FROM review)
           AS review_value_paise,
         COALESCE(
           (SELECT products FROM review_products),
           '[]'::jsonb
         ) AS review_products
       FROM active_stock`,
      [user.businessId],
    ),
  ]);

  const score = scorecard.rows[0];
  const stockRow = stock.rows[0];
  const monthRevenuePaise = Number(score.month_revenue_paise);
  const monthCogsPaise = Number(score.month_cogs_paise);
  const monthReplacementCostPaise = Number(
    score.month_replacement_cost_paise,
  );

  return {
    asOf: new Date().toISOString(),
    today: {
      revenuePaise: Number(score.today_revenue_paise),
      orderCount: score.today_order_count,
      unitCount: score.today_unit_count,
    },
    month: {
      revenuePaise: monthRevenuePaise,
      orderCount: score.month_order_count,
      unitCount: score.month_unit_count,
      accountingGrossProductProfitPaise: monthRevenuePaise - monthCogsPaise,
      replacementMarginPaise:
        monthRevenuePaise - monthReplacementCostPaise,
      averageOrderPaise: score.month_order_count
        ? Math.round(monthRevenuePaise / score.month_order_count)
        : 0,
    },
    previousComparableMonth: {
      revenuePaise: Number(score.previous_revenue_paise),
      orderCount: score.previous_order_count,
      accountingGrossProductProfitPaise: Number(
        score.previous_gross_profit_paise,
      ),
    },
    year: {
      revenuePaise: Number(score.year_revenue_paise),
      previousComparableRevenuePaise: Number(
        score.previous_year_revenue_paise,
      ),
      comparisonAvailable: score.previous_year_order_count > 0,
    },
    lastSaleAt: score.last_sale_at?.toISOString() ?? null,
    monthlyTrend: trend.rows.map((row) => ({
      monthKey: row.month_key,
      monthLabel: row.month_label,
      revenuePaise: Number(row.revenue_paise),
      orderCount: row.order_count,
      unitCount: row.unit_count,
      accountingGrossProductProfitPaise: Number(
        row.accounting_gross_product_profit_paise,
      ),
    })),
    channels: channels.rows.map((row) => ({
      saleType: row.sale_type,
      revenuePaise: Number(row.revenue_paise),
      orderCount: row.order_count,
      unitCount: row.unit_count,
    })),
    topProducts: topProducts.rows.map((row) => ({
      variantId: row.variant_id,
      productName: row.product_name,
      sku: row.sku,
      revenuePaise: Number(row.revenue_paise),
      unitCount: row.unit_count,
      accountingGrossProductProfitPaise: Number(
        row.accounting_gross_product_profit_paise,
      ),
    })),
    stock: {
      activeSkuCount: stockRow.active_sku_count,
      sellableUnitCount: stockRow.sellable_unit_count,
      stockValuePaise: Number(stockRow.stock_value_paise),
      reviewSkuCount: stockRow.review_sku_count,
      reviewValuePaise: Number(stockRow.review_value_paise),
    },
    stockToReview: stockRow.review_products.map((product) => ({
      ...product,
      lastSoldAt: product.lastSoldAt
        ? new Date(product.lastSoldAt).toISOString()
        : null,
    })),
  };
}
