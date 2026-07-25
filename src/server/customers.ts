import "server-only";

import { randomUUID } from "node:crypto";
import type { CurrentUser } from "./auth/current-user";
import { database, inTransaction } from "./database";

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

export async function searchCustomers(user: CurrentUser, query: string): Promise<Customer[]> {
  const normalized = normalizePhone(query);
  const result = await database.query<CustomerRow>(
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
