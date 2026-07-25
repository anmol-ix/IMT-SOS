import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { CurrentUser } from "./auth/current-user";
import { requireRole } from "./auth/roles";
import { inTransaction } from "./database";
import { IdempotencyConflictError } from "./proof-command";
import {
  InvalidReorderPolicyError,
  requireValidReorderPolicy,
  suggestedReorderQuantity,
  type ReorderPolicyReason,
  type ReorderPolicyValues,
} from "@/shared/reorder-policy";

export type SetReorderPolicyInput = ReorderPolicyValues & {
  reason: ReorderPolicyReason;
  note: string;
};

export type SetReorderPolicyResult = {
  changeId: string;
  product: {
    id: string;
    name: string;
    sku: string;
    sellableQuantity: number;
  };
  previous: ReorderPolicyValues;
  policy: ReorderPolicyValues & {
    status: "CONFIGURED" | "DISABLED";
    suggestedReorderQuantity: number | null;
  };
  reason: ReorderPolicyReason;
  note: string;
  replayed: boolean;
};

export class ReorderPolicyUnavailableError extends Error {
  readonly status = 409;
  readonly code = "REORDER_POLICY_UNAVAILABLE";

  constructor() {
    super("This product is no longer available for replenishment settings.");
    this.name = "ReorderPolicyUnavailableError";
  }
}

function normalized(input: SetReorderPolicyInput): SetReorderPolicyInput {
  return {
    ...input,
    note: input.note.trim(),
  };
}

export async function setReorderPolicy(
  user: CurrentUser,
  variantId: string,
  commandId: string,
  suppliedInput: SetReorderPolicyInput,
): Promise<SetReorderPolicyResult> {
  requireRole(user.role, ["BUSINESS_OWNER"]);
  const input = normalized(suppliedInput);
  requireValidReorderPolicy(input, input.note);
  const requestHash = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");

  return inTransaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`${user.businessId}:reorder-policy:${variantId}`],
    );
    const prior = await client.query<{
      variant_id: string;
      request_hash: string;
      result_json: Omit<SetReorderPolicyResult, "replayed">;
    }>(
      `SELECT variant_id, request_hash, result_json
       FROM reorder_policy_changes
       WHERE business_id = $1 AND command_id = $2`,
      [user.businessId, commandId],
    );
    if (prior.rows[0]) {
      if (
        prior.rows[0].variant_id !== variantId
        || prior.rows[0].request_hash !== requestHash
      ) {
        throw new IdempotencyConflictError();
      }
      return { ...prior.rows[0].result_json, replayed: true };
    }

    const product = await client.query<{
      id: string;
      name: string;
      sku: string;
      quantity_on_hand: number;
      reorder_point: number | null;
      restock_target: number | null;
    }>(
      `SELECT
         v.id, p.name, v.sku, ib.quantity_on_hand,
         v.reorder_point, v.restock_target
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       JOIN inventory_balances ib ON ib.variant_id = v.id
       JOIN locations l ON l.id = ib.location_id AND l.status = 'ACTIVE'
       WHERE v.id = $1 AND p.business_id = $2
         AND p.status = 'ACTIVE' AND v.status = 'ACTIVE'
       ORDER BY l.created_at
       LIMIT 1
       FOR UPDATE OF v`,
      [variantId, user.businessId],
    );
    const row = product.rows[0];
    if (!row) throw new ReorderPolicyUnavailableError();
    const previous: ReorderPolicyValues = {
      reorderPoint: row.reorder_point,
      restockTarget: row.restock_target,
    };
    if (
      previous.reorderPoint === input.reorderPoint
      && previous.restockTarget === input.restockTarget
    ) {
      throw new InvalidReorderPolicyError(
        "Change the reorder point, restock target or disable the policy before saving.",
      );
    }

    await client.query(
      `UPDATE product_variants
       SET reorder_point = $1, restock_target = $2, updated_at = now()
       WHERE id = $3`,
      [input.reorderPoint, input.restockTarget, variantId],
    );

    const changeId = randomUUID();
    const result = {
      changeId,
      product: {
        id: row.id,
        name: row.name,
        sku: row.sku,
        sellableQuantity: row.quantity_on_hand,
      },
      previous,
      policy: {
        reorderPoint: input.reorderPoint,
        restockTarget: input.restockTarget,
        status: input.reorderPoint === null
          ? "DISABLED" as const
          : "CONFIGURED" as const,
        suggestedReorderQuantity: suggestedReorderQuantity(
          row.quantity_on_hand,
          input.restockTarget,
        ),
      },
      reason: input.reason,
      note: input.note,
    };

    await client.query(
      `INSERT INTO reorder_policy_changes
        (id, business_id, variant_id, command_id, request_hash, actor_user_id,
         reason_code, note, old_reorder_point, old_restock_target,
         new_reorder_point, new_restock_target, result_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        changeId,
        user.businessId,
        variantId,
        commandId,
        requestHash,
        user.id,
        input.reason,
        input.note,
        previous.reorderPoint,
        previous.restockTarget,
        input.reorderPoint,
        input.restockTarget,
        result,
      ],
    );
    await client.query(
      `INSERT INTO audit_events
        (business_id, actor_user_id, event_type, entity_type, entity_id, details)
       VALUES ($1, $2, 'REORDER_POLICY_CHANGED', 'PRODUCT_VARIANT', $3, $4)`,
      [
        user.businessId,
        user.id,
        variantId,
        {
          changeId,
          reason: input.reason,
          previous,
          current: {
            reorderPoint: input.reorderPoint,
            restockTarget: input.restockTarget,
          },
        },
      ],
    );
    return { ...result, replayed: false };
  });
}
