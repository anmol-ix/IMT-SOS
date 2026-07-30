import "server-only";

import { randomUUID } from "node:crypto";
import type { CurrentUser } from "./auth/current-user";
import { getDatabase, inTransaction } from "./database";

export type Customer = {
  id: string;
  name: string;
  phone: string;
  locality: string | null;
  email: string | null;
  totalOrders: number;
  totalSpendPaise: number;
  lastPurchaseAt: string | null;
};

export type CustomerSegment = "RETAIL" | "WHOLESALE" | "MIXED" | "NEW";

export type CustomerDirectoryItem = Customer & {
  retailOrders: number;
  wholesaleOrders: number;
  segment: CustomerSegment;
};

export type CustomerDirectorySummary = {
  totalCustomers: number;
  recentCustomers: number;
  wholesaleCustomers: number;
  customersWithoutSales: number;
};

export type CustomerPurchase = {
  id: string;
  saleNumber: string;
  completedAt: string;
  saleType: "RETAIL" | "WHOLESALE";
  totalPaise: number;
  itemCount: number;
  unitCount: number;
  paymentModes: string[];
  soldBy: string;
  products: Array<{
    name: string;
    sku: string;
    quantity: number;
  }>;
};

export type CustomerProfile = CustomerDirectoryItem & {
  averageOrderPaise: number;
  totalUnits: number;
  retailSpendPaise: number;
  wholesaleSpendPaise: number;
  purchases: CustomerPurchase[];
};

export function customerSegment(
  retailOrders: number,
  wholesaleOrders: number,
): CustomerSegment {
  if (retailOrders && wholesaleOrders) return "MIXED";
  if (wholesaleOrders) return "WHOLESALE";
  if (retailOrders) return "RETAIL";
  return "NEW";
}

export class CustomerAlreadyExistsError extends Error {
  readonly status = 409;
  readonly code = "CUSTOMER_ALREADY_EXISTS";

  constructor() {
    super("A customer with this phone number already exists. Find and select that customer.");
    this.name = "CustomerAlreadyExistsError";
  }
}

export function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

const customerSelect = `SELECT
  c.id, c.name, c.phone_normalized, c.locality, c.email,
  count(s.id) FILTER (WHERE s.status = 'COMPLETED')::int AS total_orders,
  COALESCE(sum(s.total_paise) FILTER (WHERE s.status = 'COMPLETED'), 0) AS total_spend_paise,
  max(s.completed_at) FILTER (WHERE s.status = 'COMPLETED') AS last_purchase_at
FROM customers c
LEFT JOIN sales s ON s.customer_id = c.id`;

type CustomerRow = {
  id: string;
  name: string;
  phone_normalized: string;
  locality: string | null;
  email: string | null;
  total_orders: number;
  total_spend_paise: string;
  last_purchase_at: Date | null;
};

function mapCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone_normalized,
    locality: row.locality,
    email: row.email,
    totalOrders: row.total_orders,
    totalSpendPaise: Number(row.total_spend_paise),
    lastPurchaseAt: row.last_purchase_at?.toISOString() ?? null,
  };
}

type DirectoryRow = CustomerRow & {
  retail_orders: number;
  wholesale_orders: number;
};

function mapDirectoryCustomer(row: DirectoryRow): CustomerDirectoryItem {
  return {
    ...mapCustomer(row),
    retailOrders: row.retail_orders,
    wholesaleOrders: row.wholesale_orders,
    segment: customerSegment(row.retail_orders, row.wholesale_orders),
  };
}

export async function searchCustomers(user: CurrentUser, query: string): Promise<Customer[]> {
  const normalized = normalizePhone(query);
  const result = await getDatabase().query<CustomerRow>(
    `${customerSelect}
     WHERE c.business_id = $1 AND c.status = 'ACTIVE'
       AND ($2 = '' OR ($3 <> '' AND c.phone_normalized LIKE '%' || $3 || '%')
         OR c.name ILIKE '%' || $2 || '%')
     GROUP BY c.id
     ORDER BY
       CASE WHEN c.phone_normalized = $3 THEN 0 ELSE 1 END,
       max(s.completed_at) DESC NULLS LAST, c.name
     LIMIT 12`,
    [user.businessId, query.trim(), normalized],
  );
  return result.rows.map(mapCustomer);
}

export async function listCustomers(
  user: CurrentUser,
  input: { query?: string; segment?: CustomerSegment } = {},
): Promise<{
  customers: CustomerDirectoryItem[];
  summary: CustomerDirectorySummary;
}> {
  const query = input.query?.trim() ?? "";
  const phone = normalizePhone(query);
  const segment = input.segment ?? "NEW";
  const requestedSegment = input.segment ? segment : "ALL";
  const database = getDatabase();

  const [directory, summary] = await Promise.all([
    database.query<DirectoryRow>(
      `WITH directory AS (
         SELECT
           c.id, c.name, c.phone_normalized, c.locality, c.email,
           count(s.id) FILTER (WHERE s.status = 'COMPLETED')::int AS total_orders,
           count(s.id) FILTER (
             WHERE s.status = 'COMPLETED' AND s.sale_type = 'RETAIL'
           )::int AS retail_orders,
           count(s.id) FILTER (
             WHERE s.status = 'COMPLETED' AND s.sale_type = 'WHOLESALE'
           )::int AS wholesale_orders,
           COALESCE(sum(s.total_paise) FILTER (
             WHERE s.status = 'COMPLETED'
           ), 0)::bigint AS total_spend_paise,
           max(s.completed_at) FILTER (
             WHERE s.status = 'COMPLETED'
           ) AS last_purchase_at
         FROM customers c
         LEFT JOIN sales s ON s.customer_id = c.id
         WHERE c.business_id = $1 AND c.status = 'ACTIVE'
           AND (
             $2 = ''
             OR ($3 <> '' AND c.phone_normalized LIKE '%' || $3 || '%')
             OR c.name ILIKE '%' || $2 || '%'
             OR COALESCE(c.locality, '') ILIKE '%' || $2 || '%'
           )
         GROUP BY c.id
       ),
       segmented AS (
         SELECT *,
           CASE
             WHEN retail_orders > 0 AND wholesale_orders > 0 THEN 'MIXED'
             WHEN wholesale_orders > 0 THEN 'WHOLESALE'
             WHEN retail_orders > 0 THEN 'RETAIL'
             ELSE 'NEW'
           END AS segment
         FROM directory
       )
       SELECT
         id, name, phone_normalized, locality, email, total_orders,
         retail_orders, wholesale_orders, total_spend_paise, last_purchase_at
       FROM segmented
       WHERE $4 = 'ALL' OR segment = $4
       ORDER BY last_purchase_at DESC NULLS LAST, name
       LIMIT 100`,
      [user.businessId, query, phone, requestedSegment],
    ),
    database.query<{
      total_customers: number;
      recent_customers: number;
      wholesale_customers: number;
      customers_without_sales: number;
    }>(
      `WITH customer_activity AS (
         SELECT
           c.id,
           max(s.completed_at) FILTER (WHERE s.status = 'COMPLETED') AS last_purchase_at,
           count(s.id) FILTER (WHERE s.status = 'COMPLETED')::int AS total_orders,
           count(s.id) FILTER (
             WHERE s.status = 'COMPLETED' AND s.sale_type = 'WHOLESALE'
           )::int AS wholesale_orders
         FROM customers c
         LEFT JOIN sales s ON s.customer_id = c.id
         WHERE c.business_id = $1 AND c.status = 'ACTIVE'
         GROUP BY c.id
       )
       SELECT
         count(*)::int AS total_customers,
         count(*) FILTER (
           WHERE last_purchase_at >= now() - interval '90 days'
         )::int AS recent_customers,
         count(*) FILTER (WHERE wholesale_orders > 0)::int AS wholesale_customers,
         count(*) FILTER (WHERE total_orders = 0)::int AS customers_without_sales
       FROM customer_activity`,
      [user.businessId],
    ),
  ]);

  const totals = summary.rows[0];
  return {
    customers: directory.rows.map(mapDirectoryCustomer),
    summary: {
      totalCustomers: totals.total_customers,
      recentCustomers: totals.recent_customers,
      wholesaleCustomers: totals.wholesale_customers,
      customersWithoutSales: totals.customers_without_sales,
    },
  };
}

export async function getCustomerProfile(
  user: CurrentUser,
  customerId: string,
): Promise<CustomerProfile | null> {
  const database = getDatabase();
  const [profileResult, purchasesResult] = await Promise.all([
    database.query<DirectoryRow & {
      total_units: number;
      retail_spend_paise: string;
      wholesale_spend_paise: string;
    }>(
      `SELECT
         c.id, c.name, c.phone_normalized, c.locality, c.email,
         COALESCE(sales.total_orders, 0)::int AS total_orders,
         COALESCE(sales.retail_orders, 0)::int AS retail_orders,
         COALESCE(sales.wholesale_orders, 0)::int AS wholesale_orders,
         COALESCE(sales.total_spend_paise, 0)::bigint AS total_spend_paise,
         COALESCE(sales.retail_spend_paise, 0)::bigint AS retail_spend_paise,
         COALESCE(sales.wholesale_spend_paise, 0)::bigint AS wholesale_spend_paise,
         sales.last_purchase_at,
         COALESCE(units.total_units, 0)::int AS total_units
       FROM customers c
       LEFT JOIN LATERAL (
         SELECT
           count(*)::int AS total_orders,
           count(*) FILTER (WHERE sale_type = 'RETAIL')::int AS retail_orders,
           count(*) FILTER (WHERE sale_type = 'WHOLESALE')::int AS wholesale_orders,
           sum(total_paise)::bigint AS total_spend_paise,
           sum(total_paise) FILTER (
             WHERE sale_type = 'RETAIL'
           )::bigint AS retail_spend_paise,
           sum(total_paise) FILTER (
             WHERE sale_type = 'WHOLESALE'
           )::bigint AS wholesale_spend_paise,
           max(completed_at) AS last_purchase_at
         FROM sales
         WHERE customer_id = c.id AND status = 'COMPLETED'
       ) sales ON true
       LEFT JOIN LATERAL (
         SELECT sum(sl.quantity)::int AS total_units
         FROM sales s
         JOIN sale_lines sl ON sl.sale_id = s.id
         WHERE s.customer_id = c.id AND s.status = 'COMPLETED'
       ) units ON true
       WHERE c.id = $2 AND c.business_id = $1 AND c.status = 'ACTIVE'`,
      [user.businessId, customerId],
    ),
    database.query<{
      id: string;
      sale_number: string;
      completed_at: Date;
      sale_type: "RETAIL" | "WHOLESALE";
      total_paise: string;
      item_count: number;
      unit_count: number;
      payment_modes: string[];
      sold_by: string;
      products: Array<{ name: string; sku: string; quantity: number }>;
    }>(
      `SELECT
         s.id, s.sale_number, s.completed_at, s.sale_type, s.total_paise,
         actor.display_name AS sold_by,
         COALESCE(lines.item_count, 0)::int AS item_count,
         COALESCE(lines.unit_count, 0)::int AS unit_count,
         COALESCE(lines.products, '[]'::jsonb) AS products,
         COALESCE(payments.payment_modes, ARRAY[]::text[]) AS payment_modes
       FROM sales s
       JOIN app_users actor ON actor.id = s.created_by
       LEFT JOIN LATERAL (
         SELECT
           count(*)::int AS item_count,
           sum(sl.quantity)::int AS unit_count,
           jsonb_agg(
             jsonb_build_object(
               'name', p.name,
               'sku', v.sku,
               'quantity', sl.quantity
             )
             ORDER BY p.name, v.sku
           ) AS products
         FROM sale_lines sl
         JOIN product_variants v ON v.id = sl.variant_id
         JOIN products p ON p.id = v.product_id
         WHERE sl.sale_id = s.id
       ) lines ON true
       LEFT JOIN LATERAL (
         SELECT array_agg(payment_mode ORDER BY created_at) AS payment_modes
         FROM sale_payments
         WHERE sale_id = s.id
       ) payments ON true
       WHERE s.business_id = $1 AND s.customer_id = $2 AND s.status = 'COMPLETED'
       ORDER BY s.completed_at DESC
       LIMIT 30`,
      [user.businessId, customerId],
    ),
  ]);

  const row = profileResult.rows[0];
  if (!row) return null;

  const customer = mapDirectoryCustomer(row);
  return {
    ...customer,
    averageOrderPaise: customer.totalOrders
      ? Math.round(customer.totalSpendPaise / customer.totalOrders)
      : 0,
    totalUnits: row.total_units,
    retailSpendPaise: Number(row.retail_spend_paise),
    wholesaleSpendPaise: Number(row.wholesale_spend_paise),
    purchases: purchasesResult.rows.map((purchase) => ({
      id: purchase.id,
      saleNumber: purchase.sale_number,
      completedAt: purchase.completed_at.toISOString(),
      saleType: purchase.sale_type,
      totalPaise: Number(purchase.total_paise),
      itemCount: purchase.item_count,
      unitCount: purchase.unit_count,
      paymentModes: purchase.payment_modes,
      soldBy: purchase.sold_by,
      products: purchase.products,
    })),
  };
}

export async function createCustomer(
  user: CurrentUser,
  input: { name: string; phone: string; locality?: string; email?: string },
): Promise<Customer> {
  return inTransaction(async (client) => {
    const id = randomUUID();
    const inserted = await client.query(
      `INSERT INTO customers
         (id, business_id, name, phone_normalized, locality, email, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (business_id, phone_normalized) DO NOTHING
       RETURNING id`,
      [
        id,
        user.businessId,
        input.name.trim(),
        normalizePhone(input.phone),
        input.locality?.trim() || null,
        input.email?.trim().toLowerCase() || null,
        user.id,
      ],
    );
    if (!inserted.rows[0]) throw new CustomerAlreadyExistsError();
    await client.query(
      `INSERT INTO audit_events
         (business_id, actor_user_id, event_type, entity_type, entity_id, details)
       VALUES ($1, $2, 'CUSTOMER_CREATED', 'CUSTOMER', $3, $4)`,
      [user.businessId, user.id, id, {}],
    );
    const created = await client.query<CustomerRow>(
      `${customerSelect} WHERE c.id = $1 AND c.business_id = $2 GROUP BY c.id`,
      [id, user.businessId],
    );
    return mapCustomer(created.rows[0]);
  });
}
