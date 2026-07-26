import "server-only";

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { CurrentUser } from "./auth/current-user";
import { requireRole } from "./auth/roles";
import { getDatabase, inTransaction } from "./database";
import { allocateWeightedAverageCost } from "./inventory-costing";
import {
  minimumPriceForRole,
  priceNeedsApproval,
  PriceApprovalRequiredError,
  type PriceExceptionReason,
  requireExceptionReason,
} from "./sale-policy";

export type PriceApprovalStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "CONSUMED";

export type PriceApprovalView = {
  id: string;
  productName: string;
  sku: string;
  requesterName: string;
  status: PriceApprovalStatus;
  quantity: number;
  requestedUnitPricePaise: number;
  standardPricePaise: number;
  requesterFloorPaise: number;
  expectedGrossResultPaise?: number;
  expectedReplacementMarginPaise?: number;
  reason: PriceExceptionReason | null;
  note: string | null;
  expiresAt: string;
  createdAt: string;
};

type ApprovalRow = {
  id: string;
  product_name: string;
  sku: string;
  requester_name: string;
  requester_user_id: string;
  status: PriceApprovalStatus;
  quantity: number;
  requested_unit_price_paise: string;
  standard_price_paise: string;
  requester_floor_paise: string;
  expected_accounting_cogs_paise: string;
  expected_replacement_cost_paise: string;
  reason: PriceExceptionReason | null;
  note: string | null;
  expires_at: Date;
  created_at: Date;
};

type ProductContext = {
  variant_id: string;
  product_name: string;
  sku: string;
  location_id: string;
  quantity_on_hand: number;
  inventory_value_paise: string;
  latest_landed_cost_paise: string;
  price_version_id: string;
  standard_price_paise: string;
  owner_floor_paise: string;
  trusted_operator_floor_paise: string;
  store_operator_floor_paise: string;
};

export class PriceApprovalUnavailableError extends Error {
  readonly status = 409;
  readonly code = "PRICE_APPROVAL_UNAVAILABLE";

  constructor(message = "This price approval is no longer available. Request a new approval.") {
    super(message);
    this.name = "PriceApprovalUnavailableError";
  }
}

export class PriceApprovalNotRequiredError extends Error {
  readonly status = 409;
  readonly code = "PRICE_APPROVAL_NOT_REQUIRED";

  constructor() {
    super("This price is already within your permitted range.");
    this.name = "PriceApprovalNotRequiredError";
  }
}

const productSql = `SELECT
  v.id AS variant_id, p.name AS product_name, v.sku, l.id AS location_id,
  ib.quantity_on_hand, ib.inventory_value_paise, ib.latest_landed_cost_paise,
  pv.id AS price_version_id, pv.standard_price_paise, pv.owner_floor_paise,
  pv.trusted_operator_floor_paise, pv.store_operator_floor_paise
FROM product_variants v
JOIN products p ON p.id = v.product_id
JOIN price_versions pv ON pv.variant_id = v.id AND pv.effective_to IS NULL
JOIN inventory_balances ib ON ib.variant_id = v.id
JOIN locations l ON l.id = ib.location_id AND l.status = 'ACTIVE'
WHERE v.id = $1 AND p.business_id = $2
  AND p.status = 'ACTIVE' AND v.status = 'ACTIVE'
ORDER BY l.created_at
LIMIT 1`;

const approvalSql = `SELECT
  r.id, p.name AS product_name, v.sku, u.display_name AS requester_name,
  r.requester_user_id, r.status, r.quantity, r.requested_unit_price_paise,
  r.standard_price_paise, r.requester_floor_paise,
  r.expected_accounting_cogs_paise, r.expected_replacement_cost_paise,
  r.reason, r.note, r.expires_at, r.created_at
FROM price_approval_requests r
JOIN product_variants v ON v.id = r.variant_id
JOIN products p ON p.id = v.product_id
JOIN app_users u ON u.id = r.requester_user_id`;

function view(row: ApprovalRow, includeCosts: boolean): PriceApprovalView {
  const requestedTotal = Number(row.requested_unit_price_paise) * row.quantity;
  return {
    id: row.id,
    productName: row.product_name,
    sku: row.sku,
    requesterName: row.requester_name,
    status: row.status,
    quantity: row.quantity,
    requestedUnitPricePaise: Number(row.requested_unit_price_paise),
    standardPricePaise: Number(row.standard_price_paise),
    requesterFloorPaise: Number(row.requester_floor_paise),
    ...(includeCosts
      ? {
          expectedGrossResultPaise:
            requestedTotal - Number(row.expected_accounting_cogs_paise),
          expectedReplacementMarginPaise:
            requestedTotal - Number(row.expected_replacement_cost_paise),
        }
      : {}),
    reason: row.reason,
    note: row.note,
    expiresAt: row.expires_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

function currentPrice(row: ProductContext) {
  const latestCost = Number(row.latest_landed_cost_paise);
  return {
    standardPricePaise: Number(row.standard_price_paise),
    ownerFloorPaise: Math.max(Number(row.owner_floor_paise), latestCost),
    trustedOperatorFloorPaise: Math.max(Number(row.trusted_operator_floor_paise), latestCost),
    storeOperatorFloorPaise: Math.max(Number(row.store_operator_floor_paise), latestCost),
  };
}

export async function requestPriceApproval(
  user: CurrentUser,
  input: { variantId: string; quantity: number; requestedUnitPricePaise: number },
): Promise<PriceApprovalView> {
  if (user.role === "BUSINESS_OWNER") throw new PriceApprovalNotRequiredError();

  return inTransaction(async (client) => {
    await client.query(
      `UPDATE price_approval_requests
          SET status = 'EXPIRED', updated_at = now()
        WHERE requester_user_id = $1 AND status = 'PENDING' AND expires_at <= now()`,
      [user.id],
    );

    const product = await client.query<ProductContext>(`${productSql} FOR SHARE OF ib`, [
      input.variantId,
      user.businessId,
    ]);
    const row = product.rows[0];
    if (!row || row.quantity_on_hand < input.quantity) {
      throw new PriceApprovalUnavailableError("The requested product or quantity is unavailable.");
    }

    const price = currentPrice(row);
    if (!priceNeedsApproval(input.requestedUnitPricePaise, price, user.role)) {
      throw new PriceApprovalNotRequiredError();
    }

    const existing = await client.query<ApprovalRow>(
      `${approvalSql}
       WHERE r.business_id = $1 AND r.requester_user_id = $2 AND r.variant_id = $3
         AND r.quantity = $4 AND r.requested_unit_price_paise = $5
         AND r.status = 'PENDING' AND r.expires_at > now()
       ORDER BY r.created_at DESC LIMIT 1`,
      [
        user.businessId,
        user.id,
        input.variantId,
        input.quantity,
        input.requestedUnitPricePaise,
      ],
    );
    if (existing.rows[0]) return view(existing.rows[0], false);

    const expectedAccountingCogsPaise = Number(
      allocateWeightedAverageCost(
        BigInt(row.inventory_value_paise),
        row.quantity_on_hand,
        input.quantity,
      ),
    );
    const expectedReplacementCostPaise =
      Number(row.latest_landed_cost_paise) * input.quantity;
    const id = randomUUID();
    await client.query(
      `INSERT INTO price_approval_requests
        (id, business_id, location_id, variant_id, requester_user_id,
         price_version_id, quantity, requested_unit_price_paise,
         standard_price_paise, requester_floor_paise, replacement_unit_cost_paise,
         expected_accounting_cogs_paise, expected_replacement_cost_paise, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               now() + interval '24 hours')`,
      [
        id,
        user.businessId,
        row.location_id,
        row.variant_id,
        user.id,
        row.price_version_id,
        input.quantity,
        input.requestedUnitPricePaise,
        row.standard_price_paise,
        minimumPriceForRole(price, user.role),
        row.latest_landed_cost_paise,
        expectedAccountingCogsPaise,
        expectedReplacementCostPaise,
      ],
    );
    await client.query(
      `INSERT INTO audit_events
        (business_id, actor_user_id, event_type, entity_type, entity_id, details)
       VALUES ($1, $2, 'PRICE_APPROVAL_REQUESTED', 'PRICE_APPROVAL', $3, $4)`,
      [
        user.businessId,
        user.id,
        id,
        {
          sku: row.sku,
          quantity: input.quantity,
          requestedUnitPricePaise: input.requestedUnitPricePaise,
        },
      ],
    );

    const created = await client.query<ApprovalRow>(`${approvalSql} WHERE r.id = $1`, [id]);
    return view(created.rows[0], false);
  });
}

export async function listPriceApprovals(user: CurrentUser): Promise<PriceApprovalView[]> {
  requireRole(user.role, ["BUSINESS_OWNER"]);
  const result = await getDatabase().query<ApprovalRow>(
    `${approvalSql}
     WHERE r.business_id = $1 AND r.status = 'PENDING' AND r.expires_at > now()
     ORDER BY r.created_at`,
    [user.businessId],
  );
  return result.rows.map((row) => view(row, true));
}

export async function getPriceApproval(
  user: CurrentUser,
  id: string,
): Promise<PriceApprovalView> {
  const result = await getDatabase().query<ApprovalRow>(
    `${approvalSql}
     WHERE r.id = $1 AND r.business_id = $2
       AND ($3 = 'BUSINESS_OWNER' OR r.requester_user_id = $4)`,
    [id, user.businessId, user.role, user.id],
  );
  if (!result.rows[0]) throw new PriceApprovalUnavailableError();
  return view(result.rows[0], user.role === "BUSINESS_OWNER");
}

export async function decidePriceApproval(
  user: CurrentUser,
  id: string,
  input:
    | { decision: "REJECT"; note?: string }
    | { decision: "APPROVE"; reason: PriceExceptionReason; note?: string },
): Promise<PriceApprovalView> {
  requireRole(user.role, ["BUSINESS_OWNER"]);

  return inTransaction(async (client) => {
    const request = await client.query<{
      variant_id: string;
      status: PriceApprovalStatus;
      expires_at: Date;
      quantity: number;
      requested_unit_price_paise: string;
      price_version_id: string;
      standard_price_paise: string;
      replacement_unit_cost_paise: string;
      expected_accounting_cogs_paise: string;
    }>(
      `SELECT variant_id, status, expires_at, quantity, requested_unit_price_paise,
              price_version_id, standard_price_paise, replacement_unit_cost_paise,
              expected_accounting_cogs_paise
         FROM price_approval_requests
        WHERE id = $1 AND business_id = $2
        FOR UPDATE`,
      [id, user.businessId],
    );
    const approval = request.rows[0];
    if (!approval || approval.status !== "PENDING" || approval.expires_at <= new Date()) {
      throw new PriceApprovalUnavailableError();
    }

    if (input.decision === "REJECT") {
      await client.query(
        `UPDATE price_approval_requests
            SET status = 'REJECTED', approver_user_id = $1, note = $2,
                decision_at = now(), updated_at = now()
          WHERE id = $3`,
        [user.id, input.note?.trim() || null, id],
      );
      await client.query(
        `INSERT INTO audit_events
          (business_id, actor_user_id, event_type, entity_type, entity_id, details)
         VALUES ($1, $2, 'PRICE_APPROVAL_REJECTED', 'PRICE_APPROVAL', $3, $4)`,
        [user.businessId, user.id, id, { note: input.note?.trim() || null }],
      );
    } else {
      requireExceptionReason(input.reason, input.note);
      const product = await client.query<ProductContext>(`${productSql} FOR UPDATE OF ib`, [
        approval.variant_id,
        user.businessId,
      ]);
      const row = product.rows[0];
      if (
        !row ||
        row.quantity_on_hand < approval.quantity ||
        Number(approval.requested_unit_price_paise) > Number(row.standard_price_paise)
      ) {
        throw new PriceApprovalUnavailableError(
          "Stock or pricing changed. Ask the operator to request approval again.",
        );
      }
      const expectedAccountingCogsPaise = Number(
        allocateWeightedAverageCost(
          BigInt(row.inventory_value_paise),
          row.quantity_on_hand,
          approval.quantity,
        ),
      );
      if (
        row.price_version_id !== approval.price_version_id ||
        row.standard_price_paise !== approval.standard_price_paise ||
        row.latest_landed_cost_paise !== approval.replacement_unit_cost_paise ||
        expectedAccountingCogsPaise !== Number(approval.expected_accounting_cogs_paise)
      ) {
        throw new PriceApprovalUnavailableError(
          "Stock cost or pricing changed. Ask the operator to request approval again.",
        );
      }
      await client.query(
        `UPDATE price_approval_requests
            SET status = 'APPROVED', approver_user_id = $1,
                reason = $2, note = $3, expires_at = now() + interval '30 minutes',
                decision_at = now(), updated_at = now()
          WHERE id = $4`,
        [
          user.id,
          input.reason,
          input.note?.trim() || null,
          id,
        ],
      );
      await client.query(
        `INSERT INTO audit_events
          (business_id, actor_user_id, event_type, entity_type, entity_id, details)
         VALUES ($1, $2, 'PRICE_APPROVAL_APPROVED', 'PRICE_APPROVAL', $3, $4)`,
        [user.businessId, user.id, id, { reason: input.reason, note: input.note?.trim() || null }],
      );
    }

    const decided = await client.query<ApprovalRow>(`${approvalSql} WHERE r.id = $1`, [id]);
    return view(decided.rows[0], true);
  });
}

export async function requireApprovedPrice(
  client: PoolClient,
  user: CurrentUser,
  approvalId: string | undefined,
  sale: {
    variantId: string;
    quantity: number;
    unitPricePaise: number;
    priceVersionId: string;
    replacementUnitCostPaise: number;
    accountingCogsPaise: number;
  },
): Promise<{ id: string; reason: PriceExceptionReason; note: string | null }> {
  if (!approvalId) throw new PriceApprovalRequiredError();
  const result = await client.query<{
    id: string;
    reason: PriceExceptionReason;
    note: string | null;
  }>(
    `SELECT id, reason, note
       FROM price_approval_requests
      WHERE id = $1 AND business_id = $2 AND requester_user_id = $3
        AND variant_id = $4 AND quantity = $5 AND requested_unit_price_paise = $6
        AND price_version_id = $7 AND replacement_unit_cost_paise = $8
        AND expected_accounting_cogs_paise = $9
        AND status = 'APPROVED' AND expires_at > now()
      FOR UPDATE`,
    [
      approvalId,
      user.businessId,
      user.id,
      sale.variantId,
      sale.quantity,
      sale.unitPricePaise,
      sale.priceVersionId,
      sale.replacementUnitCostPaise,
      sale.accountingCogsPaise,
    ],
  );
  if (!result.rows[0]) throw new PriceApprovalUnavailableError();
  return result.rows[0];
}

export async function consumePriceApproval(client: PoolClient, id: string): Promise<void> {
  const consumed = await client.query(
    `UPDATE price_approval_requests
        SET status = 'CONSUMED', consumed_at = now(), updated_at = now()
      WHERE id = $1 AND status = 'APPROVED'
      RETURNING id`,
    [id],
  );
  if (!consumed.rows[0]) throw new PriceApprovalUnavailableError();
}
