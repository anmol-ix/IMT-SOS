import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { CurrentUser } from "./auth/current-user";
import { requireRole } from "./auth/roles";
import { getDatabase, inTransaction } from "./database";
import { IdempotencyConflictError } from "./proof-command";
import {
  calculateCountedInventoryValue,
  stockAdjustmentConflict,
  type StockAdjustmentReason,
  type StockCondition,
} from "@/shared/stock-adjustment-policy";

export type RequestStockAdjustmentInput = {
  variantId: string;
  stockCondition: StockCondition;
  countedQuantity: number;
  reason: StockAdjustmentReason;
  note: string;
};

export type StockAdjustmentView = {
  id: string;
  productName: string;
  sku: string;
  rackLocation: string | null;
  stockCondition: StockCondition;
  recordedQuantity: number;
  countedQuantity: number;
  quantityDelta: number;
  reason: StockAdjustmentReason;
  note: string;
  status: "REQUESTED" | "REJECTED" | "APPLIED";
  requesterName: string;
  approverName: string | null;
  decisionNote: string | null;
  expectedValueDeltaPaise?: number;
  appliedUnitCostPaise?: number;
  requestedAt: string;
  decidedAt: string | null;
  replayed: boolean;
};

type AdjustmentRow = {
  id: string;
  product_name: string;
  sku: string;
  rack_location: string | null;
  stock_condition: StockCondition;
  recorded_quantity: number;
  counted_quantity: number;
  quantity_delta: number;
  reason_code: StockAdjustmentReason;
  note: string;
  status: "REQUESTED" | "REJECTED" | "APPLIED";
  requester_name: string;
  approver_name: string | null;
  decision_note: string | null;
  expected_value_delta_paise: string;
  applied_unit_cost_paise: string;
  request_hash: string;
  decision_hash: string | null;
  requested_at: Date;
  decided_at: Date | null;
};

type LockedAdjustment = {
  id: string;
  location_id: string;
  variant_id: string;
  stock_condition: StockCondition;
  recorded_quantity: number;
  counted_quantity: number;
  recorded_balance_version: string;
  status: "REQUESTED" | "REJECTED" | "APPLIED";
};

export class InvalidStockAdjustmentError extends Error {
  readonly status = 400;
  readonly code = "INVALID_STOCK_ADJUSTMENT";

  constructor(message: string) {
    super(message);
    this.name = "InvalidStockAdjustmentError";
  }
}

export class StockAdjustmentUnavailableError extends Error {
  readonly status = 409;
  readonly code = "STOCK_ADJUSTMENT_UNAVAILABLE";

  constructor(message = "This stock-count request is no longer available.") {
    super(message);
    this.name = "StockAdjustmentUnavailableError";
  }
}

export class StaleStockAdjustmentError extends Error {
  readonly status = 409;
  readonly code = "STOCK_ADJUSTMENT_STALE";

  constructor() {
    super(
      "Stock changed after this count was submitted. Count this condition again before approval.",
    );
    this.name = "StaleStockAdjustmentError";
  }
}

const adjustmentSql = `SELECT
  a.id, p.name AS product_name, v.sku, v.rack_location,
  a.stock_condition, a.recorded_quantity, a.counted_quantity,
  a.quantity_delta, a.reason_code, a.note, a.status,
  requester.display_name AS requester_name,
  approver.display_name AS approver_name, a.decision_note,
  a.expected_value_delta_paise, a.applied_unit_cost_paise,
  a.request_hash, a.decision_hash, a.requested_at, a.decided_at
FROM stock_adjustments a
JOIN product_variants v ON v.id = a.variant_id
JOIN products p ON p.id = v.product_id
JOIN app_users requester ON requester.id = a.requested_by
LEFT JOIN app_users approver ON approver.id = a.decided_by`;

function normalizeInput(
  input: RequestStockAdjustmentInput,
): RequestStockAdjustmentInput {
  return { ...input, note: input.note.trim() };
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function view(
  row: AdjustmentRow,
  includeCosts: boolean,
  replayed = false,
): StockAdjustmentView {
  return {
    id: row.id,
    productName: row.product_name,
    sku: row.sku,
    rackLocation: row.rack_location,
    stockCondition: row.stock_condition,
    recordedQuantity: row.recorded_quantity,
    countedQuantity: row.counted_quantity,
    quantityDelta: row.quantity_delta,
    reason: row.reason_code,
    note: row.note,
    status: row.status,
    requesterName: row.requester_name,
    approverName: row.approver_name,
    decisionNote: row.decision_note,
    ...(includeCosts
      ? {
          expectedValueDeltaPaise: Number(row.expected_value_delta_paise),
          appliedUnitCostPaise: Number(row.applied_unit_cost_paise),
        }
      : {}),
    requestedAt: row.requested_at.toISOString(),
    decidedAt: row.decided_at?.toISOString() ?? null,
    replayed,
  };
}

async function currentBalance(
  client: PoolClient,
  user: CurrentUser,
  variantId: string,
  condition: StockCondition,
  lock: boolean,
) {
  const product = await client.query<{
    location_id: string;
    quantity_on_hand: number;
    inventory_value_paise: string;
    latest_landed_cost_paise: string;
    version: string;
  }>(
    `SELECT
       ib.location_id, ib.quantity_on_hand, ib.inventory_value_paise,
       ib.latest_landed_cost_paise, ib.version
     FROM product_variants v
     JOIN products p ON p.id = v.product_id
     JOIN inventory_balances ib ON ib.variant_id = v.id
     JOIN locations l ON l.id = ib.location_id AND l.status = 'ACTIVE'
     WHERE v.id = $1 AND p.business_id = $2
       AND p.status = 'ACTIVE' AND v.status = 'ACTIVE'
     ORDER BY l.created_at
     LIMIT 1
     ${lock ? "FOR UPDATE OF ib" : ""}`,
    [variantId, user.businessId],
  );
  const anchor = product.rows[0];
  if (!anchor) throw new StockAdjustmentUnavailableError("This product is unavailable.");
  if (condition === "SELLABLE") {
    return {
      locationId: anchor.location_id,
      quantity: anchor.quantity_on_hand,
      valuePaise: BigInt(anchor.inventory_value_paise),
      latestLandedCostPaise: BigInt(anchor.latest_landed_cost_paise),
      version: BigInt(anchor.version),
      exists: true,
    };
  }

  const conditionBalance = await client.query<{
    quantity_on_hand: number;
    inventory_value_paise: string;
    version: string;
  }>(
    `SELECT quantity_on_hand, inventory_value_paise, version
       FROM inventory_condition_balances
      WHERE location_id = $1 AND variant_id = $2 AND stock_condition = $3
      ${lock ? "FOR UPDATE" : ""}`,
    [anchor.location_id, variantId, condition],
  );
  const row = conditionBalance.rows[0];
  return {
    locationId: anchor.location_id,
    quantity: row?.quantity_on_hand ?? 0,
    valuePaise: BigInt(row?.inventory_value_paise ?? 0),
    latestLandedCostPaise: BigInt(anchor.latest_landed_cost_paise),
    version: BigInt(row?.version ?? 0),
    exists: Boolean(row),
  };
}

export async function requestStockAdjustment(
  user: CurrentUser,
  commandId: string,
  rawInput: RequestStockAdjustmentInput,
): Promise<StockAdjustmentView> {
  requireRole(user.role, ["BUSINESS_OWNER", "TRUSTED_OPERATOR"]);
  const input = normalizeInput(rawInput);
  const requestHash = hash(input);

  return inTransaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [commandId],
    );
    const prior = await client.query<AdjustmentRow>(
      `${adjustmentSql}
       WHERE a.business_id = $1 AND a.request_command_id = $2`,
      [user.businessId, commandId],
    );
    if (prior.rows[0]) {
      if (prior.rows[0].request_hash !== requestHash) {
        throw new IdempotencyConflictError();
      }
      return view(prior.rows[0], user.role === "BUSINESS_OWNER", true);
    }

    const balance = await currentBalance(
      client,
      user,
      input.variantId,
      input.stockCondition,
      true,
    );
    const conflict = stockAdjustmentConflict({
      recordedQuantity: balance.quantity,
      countedQuantity: input.countedQuantity,
      note: input.note,
    });
    if (conflict) throw new InvalidStockAdjustmentError(conflict);

    let valuation;
    try {
      valuation = calculateCountedInventoryValue({
        currentQuantity: balance.quantity,
        currentValuePaise: balance.valuePaise,
        countedQuantity: input.countedQuantity,
        fallbackUnitCostPaise: balance.latestLandedCostPaise,
      });
    } catch (error) {
      throw new InvalidStockAdjustmentError(
        error instanceof Error ? error.message : "The count could not be valued.",
      );
    }

    const id = randomUUID();
    await client.query(
      `INSERT INTO stock_adjustments
        (id, business_id, location_id, variant_id, stock_condition,
         recorded_quantity, counted_quantity, quantity_delta,
         recorded_balance_version, recorded_inventory_value_paise,
         expected_value_delta_paise, applied_unit_cost_paise,
         reason_code, note, requested_by, request_command_id, request_hash)
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $7::integer - $6::integer,
         $8, $9, $10, $11, $12, $13, $14, $15, $16
       )`,
      [
        id,
        user.businessId,
        balance.locationId,
        input.variantId,
        input.stockCondition,
        balance.quantity,
        input.countedQuantity,
        balance.version.toString(),
        balance.valuePaise.toString(),
        valuation.valueDeltaPaise.toString(),
        valuation.appliedUnitCostPaise.toString(),
        input.reason,
        input.note,
        user.id,
        commandId,
        requestHash,
      ],
    );
    await client.query(
      `INSERT INTO audit_events
        (business_id, actor_user_id, event_type, entity_type, entity_id, details)
       VALUES ($1, $2, 'STOCK_ADJUSTMENT_REQUESTED', 'STOCK_ADJUSTMENT', $3, $4)`,
      [
        user.businessId,
        user.id,
        id,
        {
          variantId: input.variantId,
          stockCondition: input.stockCondition,
          recordedQuantity: balance.quantity,
          countedQuantity: input.countedQuantity,
          quantityDelta: input.countedQuantity - balance.quantity,
          reason: input.reason,
          note: input.note,
        },
      ],
    );
    const created = await client.query<AdjustmentRow>(
      `${adjustmentSql} WHERE a.id = $1`,
      [id],
    );
    return view(created.rows[0], user.role === "BUSINESS_OWNER");
  });
}

export async function listPendingStockAdjustments(
  user: CurrentUser,
): Promise<StockAdjustmentView[]> {
  requireRole(user.role, ["BUSINESS_OWNER"]);
  const result = await getDatabase().query<AdjustmentRow>(
    `${adjustmentSql}
     WHERE a.business_id = $1 AND a.status = 'REQUESTED'
     ORDER BY a.requested_at`,
    [user.businessId],
  );
  return result.rows.map((row) => view(row, true));
}

export async function decideStockAdjustment(
  user: CurrentUser,
  adjustmentId: string,
  commandId: string,
  input: { decision: "APPROVE" | "REJECT"; note?: string },
): Promise<StockAdjustmentView> {
  requireRole(user.role, ["BUSINESS_OWNER"]);
  const normalized = {
    decision: input.decision,
    note: input.note?.trim() || null,
  };
  const decisionHash = hash({ adjustmentId, ...normalized });

  return inTransaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [commandId],
    );
    const replay = await client.query<AdjustmentRow>(
      `${adjustmentSql}
       WHERE a.business_id = $1 AND a.decision_command_id = $2`,
      [user.businessId, commandId],
    );
    if (replay.rows[0]) {
      if (
        replay.rows[0].id !== adjustmentId
        || replay.rows[0].decision_hash !== decisionHash
      ) {
        throw new IdempotencyConflictError();
      }
      return view(replay.rows[0], true, true);
    }

    const locked = await client.query<LockedAdjustment>(
      `SELECT
         id, location_id, variant_id, stock_condition,
         recorded_quantity, counted_quantity, recorded_balance_version, status
       FROM stock_adjustments
       WHERE id = $1 AND business_id = $2
       FOR UPDATE`,
      [adjustmentId, user.businessId],
    );
    const adjustment = locked.rows[0];
    if (!adjustment || adjustment.status !== "REQUESTED") {
      throw new StockAdjustmentUnavailableError();
    }

    if (input.decision === "REJECT") {
      const result = { status: "REJECTED" };
      await client.query(
        `UPDATE stock_adjustments
            SET status = 'REJECTED', decided_by = $1,
                decision_command_id = $2, decision_hash = $3,
                decision_note = $4, result_json = $5,
                decided_at = now(), updated_at = now()
          WHERE id = $6`,
        [
          user.id,
          commandId,
          decisionHash,
          normalized.note,
          result,
          adjustment.id,
        ],
      );
      await client.query(
        `INSERT INTO audit_events
          (business_id, actor_user_id, event_type, entity_type, entity_id, details)
         VALUES ($1, $2, 'STOCK_ADJUSTMENT_REJECTED', 'STOCK_ADJUSTMENT', $3, $4)`,
        [user.businessId, user.id, adjustment.id, { note: normalized.note }],
      );
    } else {
      const balance = await currentBalance(
        client,
        user,
        adjustment.variant_id,
        adjustment.stock_condition,
        true,
      );
      if (
        balance.locationId !== adjustment.location_id
        || balance.quantity !== adjustment.recorded_quantity
        || balance.version !== BigInt(adjustment.recorded_balance_version)
      ) {
        throw new StaleStockAdjustmentError();
      }

      let valuation;
      try {
        valuation = calculateCountedInventoryValue({
          currentQuantity: balance.quantity,
          currentValuePaise: balance.valuePaise,
          countedQuantity: adjustment.counted_quantity,
          fallbackUnitCostPaise: balance.latestLandedCostPaise,
        });
      } catch (error) {
        throw new StockAdjustmentUnavailableError(
          error instanceof Error ? error.message : undefined,
        );
      }

      if (adjustment.stock_condition === "SELLABLE") {
        await client.query(
          `UPDATE inventory_balances
              SET quantity_on_hand = $1, inventory_value_paise = $2,
                  version = version + 1, updated_at = now()
            WHERE location_id = $3 AND variant_id = $4`,
          [
            adjustment.counted_quantity,
            valuation.nextValuePaise.toString(),
            balance.locationId,
            adjustment.variant_id,
          ],
        );
      } else if (balance.exists) {
        await client.query(
          `UPDATE inventory_condition_balances
              SET quantity_on_hand = $1, inventory_value_paise = $2,
                  version = version + 1, updated_at = now()
            WHERE location_id = $3 AND variant_id = $4
              AND stock_condition = $5`,
          [
            adjustment.counted_quantity,
            valuation.nextValuePaise.toString(),
            balance.locationId,
            adjustment.variant_id,
            adjustment.stock_condition,
          ],
        );
      } else {
        await client.query(
          `INSERT INTO inventory_condition_balances
            (location_id, variant_id, stock_condition, quantity_on_hand,
             inventory_value_paise)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            balance.locationId,
            adjustment.variant_id,
            adjustment.stock_condition,
            adjustment.counted_quantity,
            valuation.nextValuePaise.toString(),
          ],
        );
      }

      const quantityDelta =
        adjustment.counted_quantity - adjustment.recorded_quantity;
      await client.query(
        `INSERT INTO inventory_movements
          (business_id, location_id, variant_id, movement_type,
           stock_condition, quantity_delta, reference_type, reference_id,
           created_by)
         VALUES ($1, $2, $3, 'ADJUSTMENT', $4, $5,
                 'STOCK_ADJUSTMENT', $6, $7)`,
        [
          user.businessId,
          balance.locationId,
          adjustment.variant_id,
          adjustment.stock_condition,
          quantityDelta,
          adjustment.id,
          user.id,
        ],
      );
      const result = {
        status: "APPLIED",
        previousQuantity: adjustment.recorded_quantity,
        currentQuantity: adjustment.counted_quantity,
        quantityDelta,
        previousInventoryValuePaise: Number(balance.valuePaise),
        currentInventoryValuePaise: Number(valuation.nextValuePaise),
        inventoryValueDeltaPaise: Number(valuation.valueDeltaPaise),
        appliedUnitCostPaise: Number(valuation.appliedUnitCostPaise),
      };
      await client.query(
        `UPDATE stock_adjustments
            SET status = 'APPLIED', decided_by = $1, applied_by = $1,
                decision_command_id = $2, decision_hash = $3,
                decision_note = $4, result_json = $5,
                decided_at = now(), applied_at = now(), updated_at = now()
          WHERE id = $6`,
        [
          user.id,
          commandId,
          decisionHash,
          normalized.note,
          result,
          adjustment.id,
        ],
      );
      await client.query(
        `INSERT INTO audit_events
          (business_id, actor_user_id, event_type, entity_type, entity_id, details)
         VALUES ($1, $2, 'STOCK_ADJUSTMENT_APPLIED', 'STOCK_ADJUSTMENT', $3, $4)`,
        [
          user.businessId,
          user.id,
          adjustment.id,
          {
            requesterRecordedQuantity: adjustment.recorded_quantity,
            approvedCountedQuantity: adjustment.counted_quantity,
            quantityDelta,
            stockCondition: adjustment.stock_condition,
            inventoryValueDeltaPaise: Number(valuation.valueDeltaPaise),
            note: normalized.note,
          },
        ],
      );
    }

    const decided = await client.query<AdjustmentRow>(
      `${adjustmentSql} WHERE a.id = $1`,
      [adjustment.id],
    );
    return view(decided.rows[0], true);
  });
}
