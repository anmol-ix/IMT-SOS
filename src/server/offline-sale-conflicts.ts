import "server-only";

import { createHash } from "node:crypto";
import type { CurrentUser } from "@/server/auth/current-user";
import { requireRole } from "@/server/auth/roles";
import { completeSale } from "@/server/complete-sale";
import { getDatabase, inTransaction } from "@/server/database";
import type { SaleRequest } from "@/server/sale-request";

export type OfflineSaleConflictDisplay = {
  totalPaise: number;
  units: number;
  paymentMode: "CASH" | "UPI";
  products: Array<{
    variantId: string;
    name: string;
    sku: string;
    quantity: number;
  }>;
};

export type OfflineSaleConflictStatus = "PENDING" | "COMPLETED" | "DISMISSED";

export type OfflineSaleConflict = {
  id: string;
  commandId: string;
  operatorName: string;
  deviceName: string;
  status: OfflineSaleConflictStatus;
  display: OfflineSaleConflictDisplay;
  errorCode: string;
  errorMessage: string;
  offlineCreatedAt: string;
  reportedAt: string;
  resolutionAction: "SYNCED_AFTER_RETRY" | "OWNER_CONFIRMED" | "NOT_SOLD" | null;
};

type ConflictRow = {
  id: string;
  command_id: string;
  operator_name: string;
  device_name: string;
  status: OfflineSaleConflictStatus;
  display: OfflineSaleConflictDisplay;
  error_code: string;
  error_message: string;
  offline_created_at: Date;
  reported_at: Date;
  resolution_action: OfflineSaleConflict["resolutionAction"];
};

function conflictFromRow(row: ConflictRow): OfflineSaleConflict {
  return {
    id: row.id,
    commandId: row.command_id,
    operatorName: row.operator_name,
    deviceName: row.device_name,
    status: row.status,
    display: row.display,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    offlineCreatedAt: row.offline_created_at.toISOString(),
    reportedAt: row.reported_at.toISOString(),
    resolutionAction: row.resolution_action,
  };
}

export class OfflineConflictMismatchError extends Error {
  readonly status = 409;
  readonly code = "OFFLINE_CONFLICT_MISMATCH";

  constructor() {
    super("This queued command does not match the conflict already reported.");
    this.name = "OfflineConflictMismatchError";
  }
}

export class OfflineConflictUnavailableError extends Error {
  readonly status = 404;
  readonly code = "OFFLINE_CONFLICT_UNAVAILABLE";

  constructor() {
    super("This offline-sale conflict is no longer awaiting a decision.");
    this.name = "OfflineConflictUnavailableError";
  }
}

export async function reportOfflineSaleConflict(
  actor: CurrentUser,
  input: {
    commandId: string;
    payload: SaleRequest;
    display: OfflineSaleConflictDisplay;
    errorCode: string;
    errorMessage: string;
  },
): Promise<OfflineSaleConflict> {
  const offline = input.payload.offline;
  if (!offline) throw new OfflineConflictMismatchError();
  const requestHash = createHash("sha256")
    .update(JSON.stringify(input.payload))
    .digest("hex");

  return inTransaction(async (client) => {
    const device = await client.query<{ id: string; display_name: string }>(
      "SELECT id, display_name FROM identify_offline_conflict_device($1, $2, $3)",
      [
        actor.id,
        offline.deviceId,
        offline.devicePublicId,
      ],
    );
    if (!device.rows[0]) throw new OfflineConflictMismatchError();

    const existing = await client.query<{
      business_id: string;
      operator_user_id: string;
      device_id: string;
      request_hash: string;
    }>(
      `SELECT business_id, operator_user_id, device_id, request_hash
         FROM offline_sale_conflicts
        WHERE command_id = $1
        FOR UPDATE`,
      [input.commandId],
    );
    if (
      existing.rows[0]
      && (
        existing.rows[0].business_id !== actor.businessId
        || existing.rows[0].operator_user_id !== actor.id
        || existing.rows[0].device_id !== offline.deviceId
        || existing.rows[0].request_hash !== requestHash
      )
    ) {
      throw new OfflineConflictMismatchError();
    }

    await client.query(
      `INSERT INTO offline_sale_conflicts (
         business_id, command_id, operator_user_id, device_id, device_name,
         request_hash, payload, display, error_code, error_message
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (command_id) DO UPDATE
         SET error_code = EXCLUDED.error_code,
             error_message = EXCLUDED.error_message,
             last_reported_at = now()
         WHERE offline_sale_conflicts.status = 'PENDING'`,
      [
        actor.businessId,
        input.commandId,
        actor.id,
        offline.deviceId,
        device.rows[0].display_name,
        requestHash,
        input.payload,
        input.display,
        input.errorCode,
        input.errorMessage,
      ],
    );

    const reported = await listConflictRows(
      client,
      actor.businessId,
      "conflict.command_id = $2",
      [input.commandId],
    );
    if (!reported[0]) throw new OfflineConflictUnavailableError();
    return conflictFromRow(reported[0]);
  });
}

async function listConflictRows(
  database: Pick<ReturnType<typeof getDatabase>, "query">,
  businessId: string,
  extraWhere = "true",
  extraParameters: unknown[] = [],
): Promise<ConflictRow[]> {
  const result = await database.query<ConflictRow>(
    `SELECT
       conflict.id, conflict.command_id, operator.display_name AS operator_name,
       conflict.device_name, conflict.status, conflict.display,
       conflict.error_code, conflict.error_message,
       (conflict.payload->'offline'->>'createdAt')::timestamptz AS offline_created_at,
       conflict.reported_at, conflict.resolution_action
     FROM offline_sale_conflicts conflict
     JOIN app_users operator ON operator.id = conflict.operator_user_id
     WHERE conflict.business_id = $1 AND ${extraWhere}
     ORDER BY conflict.reported_at`,
    [businessId, ...extraParameters],
  );
  return result.rows;
}

export async function listOfflineSaleConflicts(
  actor: CurrentUser,
): Promise<OfflineSaleConflict[]> {
  const rows = actor.role === "BUSINESS_OWNER"
    ? await listConflictRows(
        getDatabase(),
        actor.businessId,
        "conflict.status = 'PENDING'",
      )
    : await listConflictRows(
        getDatabase(),
        actor.businessId,
        "conflict.operator_user_id = $2",
        [actor.id],
      );
  return rows.map(conflictFromRow);
}

export async function resolveOfflineSaleConflict(
  owner: CurrentUser,
  conflictId: string,
  input: {
    action: "CONFIRM_SALE" | "NOT_SOLD";
    note: string;
  },
): Promise<{ conflict: OfflineSaleConflict; saleNumber?: string }> {
  requireRole(owner.role, ["BUSINESS_OWNER"]);
  const pending = await getDatabase().query<{
    id: string;
    command_id: string;
    operator_user_id: string;
    request_hash: string;
    payload: SaleRequest;
  }>(
    `SELECT id, command_id, operator_user_id, request_hash, payload
       FROM offline_sale_conflicts
      WHERE id = $1 AND business_id = $2 AND status = 'PENDING'`,
    [conflictId, owner.businessId],
  );
  const row = pending.rows[0];
  if (!row) throw new OfflineConflictUnavailableError();

  if (input.action === "NOT_SOLD") {
    await inTransaction(async (client) => {
      const dismissed = await client.query<{ id: string }>(
        `UPDATE offline_sale_conflicts
            SET status = 'DISMISSED',
                resolved_by = $1,
                resolved_at = now(),
                resolution_action = 'NOT_SOLD',
                resolution_note = $2
          WHERE id = $3 AND business_id = $4 AND status = 'PENDING'
        RETURNING id`,
        [owner.id, input.note.trim(), conflictId, owner.businessId],
      );
      if (!dismissed.rows[0]) throw new OfflineConflictUnavailableError();
      await client.query(
        `INSERT INTO audit_events
           (business_id, actor_user_id, event_type, entity_type, entity_id, details)
         VALUES ($1, $2, 'OFFLINE_SALE_MARKED_NOT_SOLD',
                 'OFFLINE_SALE_CONFLICT', $3, $4)`,
        [
          owner.businessId,
          owner.id,
          conflictId,
          { commandId: row.command_id, operatorUserId: row.operator_user_id, note: input.note.trim() },
        ],
      );
    });
    const [conflict] = await listConflictRows(
      getDatabase(),
      owner.businessId,
      "conflict.id = $2",
      [conflictId],
    );
    return { conflict: conflictFromRow(conflict) };
  }

  const operator = await getDatabase().query<{
    id: string;
    business_id: string;
    workos_user_id: string;
    email: string | null;
    display_name: string;
    role: CurrentUser["role"];
  }>(
    `SELECT id, business_id, workos_user_id, email, display_name, role
       FROM app_users
      WHERE id = $1 AND business_id = $2 AND status IN ('ACTIVE', 'DISABLED')`,
    [row.operator_user_id, owner.businessId],
  );
  if (!operator.rows[0]) throw new OfflineConflictUnavailableError();
  const originalActor: CurrentUser = {
    id: operator.rows[0].id,
    businessId: operator.rows[0].business_id,
    workosUserId: operator.rows[0].workos_user_id,
    email: operator.rows[0].email,
    displayName: operator.rows[0].display_name,
    role: operator.rows[0].role,
  };
  const sale = await completeSale(originalActor, row.command_id, row.payload, {
    ownerResolution: {
      conflictId,
      owner,
      note: input.note.trim(),
      requestHash: row.request_hash,
    },
  });
  if (sale.replayed) {
    await inTransaction(async (client) => {
      const completed = await client.query<{ id: string }>(
        `UPDATE offline_sale_conflicts
            SET status = 'COMPLETED',
                resolved_by = $1,
                resolved_at = now(),
                resolution_action = 'OWNER_CONFIRMED',
                resolution_note = $2,
                sale_id = $3
          WHERE id = $4 AND business_id = $5 AND status = 'PENDING'
        RETURNING id`,
        [owner.id, input.note.trim(), sale.saleId, conflictId, owner.businessId],
      );
      if (completed.rows[0]) {
        await client.query(
          `INSERT INTO audit_events
             (business_id, actor_user_id, event_type, entity_type, entity_id, details)
           VALUES ($1, $2, 'OFFLINE_SALE_OWNER_CONFIRMED',
                   'OFFLINE_SALE_CONFLICT', $3, $4)`,
          [
            owner.businessId,
            owner.id,
            conflictId,
            {
              commandId: row.command_id,
              saleId: sale.saleId,
              operatorUserId: row.operator_user_id,
              note: input.note.trim(),
            },
          ],
        );
      }
    });
  }
  const [conflict] = await listConflictRows(
    getDatabase(),
    owner.businessId,
    "conflict.id = $2",
    [conflictId],
  );
  return { conflict: conflictFromRow(conflict), saleNumber: sale.saleNumber };
}
