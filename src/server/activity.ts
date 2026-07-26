import "server-only";

import type { CurrentUser } from "./auth/current-user";
import { getDatabase } from "./database";

export type ActivityFilter = "ALL" | "SALES" | "APPROVALS";

type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CONSUMED";

export type ActivityItem =
  | {
      kind: "SALE";
      id: string;
      happenedAt: string;
      actorName: string;
      saleNumber: string;
      totalPaise: number;
      itemCount: number;
      unitCount: number;
      paymentModes: string[];
      customerName: string;
    }
  | {
      kind: "PRICE_APPROVAL";
      id: string;
      happenedAt: string;
      requestedAt: string;
      actorName: string;
      approverName: string | null;
      status: ApprovalStatus;
      productName: string;
      sku: string;
      quantity: number;
      requestedUnitPricePaise: number;
      standardPricePaise: number;
      reason: string | null;
      note: string | null;
    }
  | {
      kind: "GUEST_APPROVAL";
      id: string;
      happenedAt: string;
      requestedAt: string;
      actorName: string;
      approverName: string | null;
      status: ApprovalStatus;
      totalPaise: number;
      productCount: number;
      note: string | null;
    };

async function sales(user: CurrentUser): Promise<ActivityItem[]> {
  const result = await getDatabase().query<{
    id: string;
    sale_number: string;
    total_paise: string;
    completed_at: Date;
    actor_name: string;
    customer_name: string | null;
    customer_declined: boolean;
    item_count: number;
    unit_count: number;
    payment_modes: string[];
  }>(
    `WITH recent_sales AS (
       SELECT
         id, sale_number, total_paise, completed_at, created_by, customer_id,
         customer_name, guest_approval_id, guest_override_reason
       FROM sales
       WHERE business_id = $1 AND status = 'COMPLETED'
         AND ($2::boolean OR created_by = $3)
       ORDER BY completed_at DESC
       LIMIT 50
     )
     SELECT
       s.id, s.sale_number, s.total_paise, s.completed_at,
       actor.display_name AS actor_name,
       COALESCE(c.name, s.customer_name) AS customer_name,
       (s.guest_approval_id IS NOT NULL OR s.guest_override_reason IS NOT NULL)
         AS customer_declined,
       COALESCE(lines.item_count, 0)::int AS item_count,
       COALESCE(lines.unit_count, 0)::int AS unit_count,
       COALESCE(payments.payment_modes, ARRAY[]::text[]) AS payment_modes
     FROM recent_sales s
     JOIN app_users actor ON actor.id = s.created_by
     LEFT JOIN customers c ON c.id = s.customer_id
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS item_count, COALESCE(sum(quantity), 0)::int AS unit_count
       FROM sale_lines
       WHERE sale_id = s.id
     ) lines ON true
     LEFT JOIN LATERAL (
       SELECT array_agg(payment_mode ORDER BY created_at) AS payment_modes
       FROM sale_payments
       WHERE sale_id = s.id
     ) payments ON true
     ORDER BY s.completed_at DESC
    `,
    [user.businessId, user.role === "BUSINESS_OWNER", user.id],
  );

  return result.rows.map((row) => ({
    kind: "SALE",
    id: row.id,
    happenedAt: row.completed_at.toISOString(),
    actorName: row.actor_name,
    saleNumber: row.sale_number,
    totalPaise: Number(row.total_paise),
    itemCount: row.item_count,
    unitCount: row.unit_count,
    paymentModes: row.payment_modes,
    customerName:
      row.customer_name
      ?? (row.customer_declined ? "Guest — customer declined details" : "Guest"),
  }));
}

async function priceApprovals(user: CurrentUser): Promise<ActivityItem[]> {
  const result = await getDatabase().query<{
    id: string;
    happened_at: Date;
    requested_at: Date;
    actor_name: string;
    approver_name: string | null;
    status: ApprovalStatus;
    product_name: string;
    sku: string;
    quantity: number;
    requested_unit_price_paise: string;
    standard_price_paise: string;
    reason: string | null;
    note: string | null;
  }>(
    `SELECT
       r.id, r.updated_at AS happened_at,
       r.created_at AS requested_at, requester.display_name AS actor_name,
       approver.display_name AS approver_name,
       CASE
         WHEN r.status IN ('PENDING', 'APPROVED') AND r.expires_at <= now()
           THEN 'EXPIRED'
         ELSE r.status
       END AS status,
       p.name AS product_name, v.sku, r.quantity,
       r.requested_unit_price_paise, r.standard_price_paise, r.reason, r.note
     FROM price_approval_requests r
     JOIN app_users requester ON requester.id = r.requester_user_id
     LEFT JOIN app_users approver ON approver.id = r.approver_user_id
     JOIN product_variants v ON v.id = r.variant_id
     JOIN products p ON p.id = v.product_id
     WHERE r.business_id = $1
       AND ($2::boolean OR r.requester_user_id = $3)
     ORDER BY r.updated_at DESC
     LIMIT 50`,
    [user.businessId, user.role === "BUSINESS_OWNER", user.id],
  );

  return result.rows.map((row) => ({
    kind: "PRICE_APPROVAL",
    id: row.id,
    happenedAt: row.happened_at.toISOString(),
    requestedAt: row.requested_at.toISOString(),
    actorName: row.actor_name,
    approverName: row.approver_name,
    status: row.status,
    productName: row.product_name,
    sku: row.sku,
    quantity: row.quantity,
    requestedUnitPricePaise: Number(row.requested_unit_price_paise),
    standardPricePaise: Number(row.standard_price_paise),
    reason: row.reason,
    note: row.note,
  }));
}

async function guestApprovals(user: CurrentUser): Promise<ActivityItem[]> {
  const result = await getDatabase().query<{
    id: string;
    happened_at: Date;
    requested_at: Date;
    actor_name: string;
    approver_name: string | null;
    status: ApprovalStatus;
    total_paise: string;
    product_count: number;
    note: string | null;
  }>(
    `SELECT
       r.id, r.updated_at AS happened_at,
       r.created_at AS requested_at, requester.display_name AS actor_name,
       approver.display_name AS approver_name,
       CASE
         WHEN r.status IN ('PENDING', 'APPROVED') AND r.expires_at <= now()
           THEN 'EXPIRED'
         ELSE r.status
       END AS status,
       r.total_paise, jsonb_array_length(r.cart_summary)::int AS product_count, r.note
     FROM guest_sale_approval_requests r
     JOIN app_users requester ON requester.id = r.requester_user_id
     LEFT JOIN app_users approver ON approver.id = r.approver_user_id
     WHERE r.business_id = $1
       AND ($2::boolean OR r.requester_user_id = $3)
     ORDER BY r.updated_at DESC
     LIMIT 50`,
    [user.businessId, user.role === "BUSINESS_OWNER", user.id],
  );

  return result.rows.map((row) => ({
    kind: "GUEST_APPROVAL",
    id: row.id,
    happenedAt: row.happened_at.toISOString(),
    requestedAt: row.requested_at.toISOString(),
    actorName: row.actor_name,
    approverName: row.approver_name,
    status: row.status,
    totalPaise: Number(row.total_paise),
    productCount: row.product_count,
    note: row.note,
  }));
}

export async function listActivity(
  user: CurrentUser,
  filter: ActivityFilter,
): Promise<ActivityItem[]> {
  const groups = await Promise.all([
    filter === "APPROVALS" ? [] : sales(user),
    filter === "SALES" ? [] : priceApprovals(user),
    filter === "SALES" ? [] : guestApprovals(user),
  ]);
  return groups
    .flat()
    .sort((left, right) => right.happenedAt.localeCompare(left.happenedAt))
    .slice(0, 50);
}
