import "server-only";

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { CurrentUser } from "./auth/current-user";
import { requireRole } from "./auth/roles";
import { getDatabase, inTransaction } from "./database";
import {
  CUSTOMER_PROMPT_THRESHOLD_PAISE,
  guestApprovalCartHash,
  type GuestApprovalCartLine,
  requiresCustomerPrompt,
} from "./guest-sale-policy";

type GuestApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CONSUMED";

export type GuestApprovalCartSummary = {
  variantId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
};

export type GuestSaleApproval = {
  id: string;
  saleCommandId: string;
  requesterName: string;
  status: GuestApprovalStatus;
  totalPaise: number;
  cartSummary: GuestApprovalCartSummary[];
  note: string | null;
  expiresAt: string;
  createdAt: string;
};

type GuestApprovalRow = {
  id: string;
  sale_command_id: string;
  requester_name: string;
  requester_user_id: string;
  status: GuestApprovalStatus;
  total_paise: string;
  cart_summary: GuestApprovalCartSummary[];
  note: string | null;
  expires_at: Date;
  created_at: Date;
};

const approvalSql = `SELECT
  r.id, r.sale_command_id, u.display_name AS requester_name,
  r.requester_user_id, r.status, r.total_paise, r.cart_summary,
  r.note, r.expires_at, r.created_at
FROM guest_sale_approval_requests r
JOIN app_users u ON u.id = r.requester_user_id`;

function view(row: GuestApprovalRow): GuestSaleApproval {
  const status =
    (row.status === "PENDING" || row.status === "APPROVED")
    && row.expires_at <= new Date()
      ? "EXPIRED"
      : row.status;
  return {
    id: row.id,
    saleCommandId: row.sale_command_id,
    requesterName: row.requester_name,
    status,
    totalPaise: Number(row.total_paise),
    cartSummary: row.cart_summary,
    note: row.note,
    expiresAt: row.expires_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

export class GuestApprovalUnavailableError extends Error {
  readonly status = 409;
  readonly code = "GUEST_APPROVAL_UNAVAILABLE";

  constructor(message = "This Guest sale approval is unavailable. Request a new approval.") {
    super(message);
    this.name = "GuestApprovalUnavailableError";
  }
}

export class GuestApprovalNotRequiredError extends Error {
  readonly status = 409;
  readonly code = "GUEST_APPROVAL_NOT_REQUIRED";

  constructor() {
    super(`Customer details are optional below ₹${CUSTOMER_PROMPT_THRESHOLD_PAISE / 100}.`);
    this.name = "GuestApprovalNotRequiredError";
  }
}

export class CustomerOrGuestApprovalRequiredError extends Error {
  readonly status = 409;
  readonly code = "CUSTOMER_OR_GUEST_APPROVAL_REQUIRED";

  constructor() {
    super("Ask for customer name and phone, or record an owner-approved Guest sale.");
    this.name = "CustomerOrGuestApprovalRequiredError";
  }
}

export async function requestGuestSaleApproval(
  user: CurrentUser,
  input: { saleCommandId: string; lines: GuestApprovalCartLine[] },
): Promise<GuestSaleApproval> {
  if (user.role === "BUSINESS_OWNER") throw new GuestApprovalNotRequiredError();
  const totalPaise = input.lines.reduce(
    (total, line) => total + line.quantity * line.unitPricePaise,
    0,
  );
  if (!requiresCustomerPrompt(totalPaise)) throw new GuestApprovalNotRequiredError();

  return inTransaction(async (client) => {
    const cartHash = guestApprovalCartHash(input.lines);
    const existing = await client.query<GuestApprovalRow>(
      `${approvalSql}
       WHERE r.business_id = $1 AND r.sale_command_id = $2`,
      [user.businessId, input.saleCommandId],
    );
    if (existing.rows[0]) {
      const stored = await client.query<{ cart_hash: string }>(
        `SELECT cart_hash FROM guest_sale_approval_requests WHERE id = $1`,
        [existing.rows[0].id],
      );
      if (stored.rows[0].cart_hash !== cartHash) {
        throw new GuestApprovalUnavailableError(
          "This cart changed after the Guest request. Request approval for the updated cart.",
        );
      }
      return view(existing.rows[0]);
    }

    const variantIds = input.lines.map((line) => line.variantId);
    const products = await client.query<{
      variant_id: string;
      product_name: string;
      sku: string;
    }>(
      `SELECT v.id AS variant_id, p.name AS product_name, v.sku
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
        WHERE p.business_id = $1 AND p.status = 'ACTIVE' AND v.status = 'ACTIVE'
          AND v.id = ANY($2::uuid[])`,
      [user.businessId, variantIds],
    );
    if (products.rows.length !== input.lines.length) {
      throw new GuestApprovalUnavailableError("A product in this cart is no longer available.");
    }
    const productById = new Map(products.rows.map((product) => [product.variant_id, product]));
    const cartSummary = input.lines.map((line) => {
      const product = productById.get(line.variantId);
      if (!product) throw new GuestApprovalUnavailableError();
      return {
        variantId: line.variantId,
        productName: product.product_name,
        sku: product.sku,
        quantity: line.quantity,
        unitPricePaise: line.unitPricePaise,
        lineTotalPaise: line.quantity * line.unitPricePaise,
      };
    });
    const id = randomUUID();
    await client.query(
      `INSERT INTO guest_sale_approval_requests
         (id, business_id, requester_user_id, sale_command_id, cart_hash,
          total_paise, cart_summary, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '24 hours')`,
      [
        id,
        user.businessId,
        user.id,
        input.saleCommandId,
        cartHash,
        totalPaise,
        JSON.stringify(cartSummary),
      ],
    );
    await client.query(
      `INSERT INTO audit_events
         (business_id, actor_user_id, event_type, entity_type, entity_id, details)
       VALUES ($1, $2, 'GUEST_SALE_APPROVAL_REQUESTED', 'GUEST_SALE_APPROVAL', $3, $4)`,
      [user.businessId, user.id, id, { totalPaise, cartHash }],
    );
    const created = await client.query<GuestApprovalRow>(`${approvalSql} WHERE r.id = $1`, [id]);
    return view(created.rows[0]);
  });
}

export async function listGuestSaleApprovals(user: CurrentUser): Promise<GuestSaleApproval[]> {
  requireRole(user.role, ["BUSINESS_OWNER"]);
  const result = await getDatabase().query<GuestApprovalRow>(
    `${approvalSql}
     WHERE r.business_id = $1 AND r.status = 'PENDING' AND r.expires_at > now()
     ORDER BY r.created_at`,
    [user.businessId],
  );
  return result.rows.map(view);
}

export async function getGuestSaleApproval(
  user: CurrentUser,
  id: string,
): Promise<GuestSaleApproval> {
  const result = await getDatabase().query<GuestApprovalRow>(
    `${approvalSql}
     WHERE r.id = $1 AND r.business_id = $2
       AND ($3 = 'BUSINESS_OWNER' OR r.requester_user_id = $4)`,
    [id, user.businessId, user.role, user.id],
  );
  if (!result.rows[0]) throw new GuestApprovalUnavailableError();
  return view(result.rows[0]);
}

export async function decideGuestSaleApproval(
  user: CurrentUser,
  id: string,
  input: { decision: "APPROVE" | "REJECT"; note?: string },
): Promise<GuestSaleApproval> {
  requireRole(user.role, ["BUSINESS_OWNER"]);
  return inTransaction(async (client) => {
    const request = await client.query<{ status: GuestApprovalStatus; expires_at: Date }>(
      `SELECT status, expires_at
         FROM guest_sale_approval_requests
        WHERE id = $1 AND business_id = $2
        FOR UPDATE`,
      [id, user.businessId],
    );
    const approval = request.rows[0];
    if (!approval || approval.status !== "PENDING" || approval.expires_at <= new Date()) {
      throw new GuestApprovalUnavailableError();
    }
    const approved = input.decision === "APPROVE";
    await client.query(
      `UPDATE guest_sale_approval_requests
          SET status = $1, approver_user_id = $2, reason = $3, note = $4,
              expires_at = CASE WHEN $1 = 'APPROVED' THEN now() + interval '30 minutes'
                                ELSE expires_at END,
              decision_at = now(), updated_at = now()
        WHERE id = $5`,
      [
        approved ? "APPROVED" : "REJECTED",
        user.id,
        approved ? "CUSTOMER_DECLINED" : null,
        input.note?.trim() || null,
        id,
      ],
    );
    await client.query(
      `INSERT INTO audit_events
         (business_id, actor_user_id, event_type, entity_type, entity_id, details)
       VALUES ($1, $2, $3, 'GUEST_SALE_APPROVAL', $4, $5)`,
      [
        user.businessId,
        user.id,
        approved ? "GUEST_SALE_APPROVAL_APPROVED" : "GUEST_SALE_APPROVAL_REJECTED",
        id,
        { note: input.note?.trim() || null },
      ],
    );
    const decided = await client.query<GuestApprovalRow>(`${approvalSql} WHERE r.id = $1`, [id]);
    return view(decided.rows[0]);
  });
}

export async function requireApprovedGuestSale(
  client: PoolClient,
  user: CurrentUser,
  approvalId: string | undefined,
  saleCommandId: string,
  lines: GuestApprovalCartLine[],
  totalPaise: number,
): Promise<{ id: string; reason: "CUSTOMER_DECLINED" }> {
  if (!approvalId) throw new CustomerOrGuestApprovalRequiredError();
  const result = await client.query<{ id: string; reason: "CUSTOMER_DECLINED" }>(
    `SELECT id, reason
       FROM guest_sale_approval_requests
      WHERE id = $1 AND business_id = $2 AND requester_user_id = $3
        AND sale_command_id = $4 AND cart_hash = $5 AND total_paise = $6
        AND status = 'APPROVED' AND expires_at > now()
      FOR UPDATE`,
    [
      approvalId,
      user.businessId,
      user.id,
      saleCommandId,
      guestApprovalCartHash(lines),
      totalPaise,
    ],
  );
  if (!result.rows[0]) throw new GuestApprovalUnavailableError();
  return result.rows[0];
}

export async function consumeGuestSaleApproval(client: PoolClient, id: string): Promise<void> {
  const consumed = await client.query(
    `UPDATE guest_sale_approval_requests
        SET status = 'CONSUMED', consumed_at = now(), updated_at = now()
      WHERE id = $1 AND status = 'APPROVED'
      RETURNING id`,
    [id],
  );
  if (!consumed.rows[0]) throw new GuestApprovalUnavailableError();
}
