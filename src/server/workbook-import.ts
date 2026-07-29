import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { CurrentUser } from "@/server/auth/current-user";
import { requireRole } from "@/server/auth/roles";
import { getDatabase, inTransaction } from "@/server/database";
import {
  type ImportIssue,
  type StagedImportRow,
  type WorkbookReconciliation,
  type WorkbookSheet,
  validateWorkbookExports,
} from "@/shared/workbook-import";

export type WorkbookFile = {
  sheet: WorkbookSheet;
  name: string;
  content: string;
};

export type WorkbookBatch = {
  id: string;
  snapshotHash: string;
  status: "VALIDATED";
  reconciliation: WorkbookReconciliation;
  createdBy: string;
  createdAt: string;
};

export type WorkbookReportRow = {
  sheet: WorkbookSheet;
  row: number;
  entityType: StagedImportRow["entityType"];
  sourceIdentifier: string | null;
  status: StagedImportRow["status"];
  issues: ImportIssue[];
};

export type WorkbookReport = {
  batch: WorkbookBatch;
  rows: WorkbookReportRow[];
};

export function workbookValidationEnabled(): boolean {
  return process.env.NODE_ENV !== "production"
    || process.env.WORKBOOK_VALIDATION_ENABLED === "1";
}

export class WorkbookValidationDisabledError extends Error {
  readonly status = 503;
  readonly code = "WORKBOOK_VALIDATION_DISABLED";

  constructor() {
    super(
      "Workbook uploads remain locked until the production backup and restore gate is approved.",
    );
    this.name = "WorkbookValidationDisabledError";
  }
}

type BatchRow = {
  id: string;
  snapshot_hash: string;
  status: "VALIDATED";
  reconciliation: WorkbookReconciliation;
  created_by_name: string;
  created_at: Date;
};

function batchFromRow(row: BatchRow): WorkbookBatch {
  return {
    id: row.id,
    snapshotHash: row.snapshot_hash,
    status: row.status,
    reconciliation: row.reconciliation,
    createdBy: row.created_by_name,
    createdAt: row.created_at.toISOString(),
  };
}

function fileHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function snapshotHash(files: WorkbookFile[]): string {
  return createHash("sha256")
    .update(
      files
        .map((file) => `${file.sheet}\0${fileHash(file.content)}`)
        .join("\n"),
    )
    .digest("hex");
}

async function reportFromDatabase(
  database: Pick<PoolClient, "query">,
  businessId: string,
  batchId: string,
): Promise<WorkbookReport | null> {
  const batchResult = await database.query<BatchRow>(
    `SELECT batch.id, batch.snapshot_hash, batch.status, batch.reconciliation,
            actor.display_name AS created_by_name, batch.created_at
       FROM import_batches batch
       JOIN app_users actor ON actor.id = batch.created_by
      WHERE batch.id = $1 AND batch.business_id = $2`,
    [batchId, businessId],
  );
  const batch = batchResult.rows[0];
  if (!batch) return null;

  const rows = await database.query<{
    source_sheet: WorkbookSheet;
    source_row: number;
    entity_type: StagedImportRow["entityType"];
    source_identifier: string | null;
    status: StagedImportRow["status"];
    issues: ImportIssue[];
  }>(
    `SELECT row.source_sheet, row.source_row, row.entity_type,
            row.source_identifier, row.status,
            COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'field', error.field_name,
                  'code', error.code,
                  'severity', error.severity,
                  'message', error.message,
                  'originalValue', error.original_value
                )
                ORDER BY
                  CASE error.severity WHEN 'ERROR' THEN 0 ELSE 1 END,
                  error.code
              ) FILTER (WHERE error.id IS NOT NULL),
              '[]'::jsonb
            ) AS issues
       FROM import_rows row
       LEFT JOIN import_errors error ON error.import_row_id = row.id
      WHERE row.batch_id = $1
      GROUP BY row.id
      ORDER BY
        CASE row.source_sheet
          WHEN 'Inventory Master' THEN 0
          WHEN 'Sales Log' THEN 1
          ELSE 2
        END,
        row.source_row`,
    [batchId],
  );

  return {
    batch: batchFromRow(batch),
    rows: rows.rows.map((row) => ({
      sheet: row.source_sheet,
      row: row.source_row,
      entityType: row.entity_type,
      sourceIdentifier: row.source_identifier,
      status: row.status,
      issues: row.issues,
    })),
  };
}

export async function createWorkbookValidation(
  owner: CurrentUser,
  files: WorkbookFile[],
): Promise<WorkbookReport> {
  requireRole(owner.role, ["BUSINESS_OWNER"]);
  if (!workbookValidationEnabled()) {
    throw new WorkbookValidationDisabledError();
  }
  const bySheet = new Map(files.map((file) => [file.sheet, file]));
  const validation = validateWorkbookExports({
    inventoryCsv: bySheet.get("Inventory Master")!.content,
    salesCsv: bySheet.get("Sales Log")!.content,
    customersCsv: bySheet.get("Customers")!.content,
  });
  const hash = snapshotHash(files);

  return inTransaction(async (client) => {
    const batchId = randomUUID();
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO import_batches (
         id, business_id, snapshot_hash, file_manifest,
         reconciliation, created_by
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (business_id, snapshot_hash) DO NOTHING
       RETURNING id`,
      [
        batchId,
        owner.businessId,
        hash,
        JSON.stringify(files.map((file) => ({
          sheet: file.sheet,
          name: file.name.slice(0, 120),
          bytes: Buffer.byteLength(file.content),
          sha256: fileHash(file.content),
        }))),
        JSON.stringify(validation.reconciliation),
        owner.id,
      ],
    );

    if (!inserted.rows[0]) {
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM import_batches
          WHERE business_id = $1 AND snapshot_hash = $2`,
        [owner.businessId, hash],
      );
      const report = await reportFromDatabase(
        client,
        owner.businessId,
        existing.rows[0].id,
      );
      if (!report) throw new Error("The existing validation report could not be read.");
      return report;
    }

    const stagedRows = validation.rows.map((row) => ({
      id: randomUUID(),
      sourceSheet: row.sheet,
      sourceRow: row.row,
      entityType: row.entityType,
      sourceIdentifier: row.sourceIdentifier,
      status: row.status,
      rawData: row.raw,
      normalizedData: row.normalized,
      issues: row.issues,
    }));
    await client.query(
      `INSERT INTO import_rows (
         id, batch_id, source_sheet, source_row, entity_type,
         source_identifier, status, raw_data, normalized_data
       )
       SELECT record.id, $1, record.source_sheet, record.source_row,
              record.entity_type, record.source_identifier, record.status,
              record.raw_data, record.normalized_data
         FROM jsonb_to_recordset($2::jsonb) AS record(
           id uuid,
           source_sheet text,
           source_row integer,
           entity_type text,
           source_identifier text,
           status text,
           raw_data jsonb,
           normalized_data jsonb
         )`,
      [
        batchId,
        JSON.stringify(stagedRows.map((row) => ({
          id: row.id,
          source_sheet: row.sourceSheet,
          source_row: row.sourceRow,
          entity_type: row.entityType,
          source_identifier: row.sourceIdentifier,
          status: row.status,
          raw_data: row.rawData,
          normalized_data: row.normalizedData,
        }))),
      ],
    );

    const errors = stagedRows.flatMap((row) =>
      row.issues.map((current) => ({
        id: randomUUID(),
        import_row_id: row.id,
        field_name: current.field,
        code: current.code,
        severity: current.severity,
        original_value: current.originalValue ?? null,
        message: current.message,
      }))
    );
    if (errors.length) {
      await client.query(
        `INSERT INTO import_errors (
           id, import_row_id, field_name, code, severity, original_value, message
         )
         SELECT record.id, record.import_row_id, record.field_name,
                record.code, record.severity, record.original_value, record.message
           FROM jsonb_to_recordset($1::jsonb) AS record(
             id uuid,
             import_row_id uuid,
             field_name text,
             code text,
             severity text,
             original_value text,
             message text
           )`,
        [JSON.stringify(errors)],
      );
    }

    await client.query(
      `INSERT INTO audit_events (
         business_id, actor_user_id, event_type, entity_type, entity_id, details
       )
       VALUES ($1, $2, 'WORKBOOK_SNAPSHOT_VALIDATED', 'IMPORT_BATCH', $3, $4)`,
      [
        owner.businessId,
        owner.id,
        batchId,
        JSON.stringify({
          snapshotHash: hash,
          reconciliation: validation.reconciliation,
        }),
      ],
    );

    const report = await reportFromDatabase(client, owner.businessId, batchId);
    if (!report) throw new Error("The validation report could not be read.");
    return report;
  });
}

export async function listWorkbookBatches(
  owner: CurrentUser,
): Promise<WorkbookBatch[]> {
  requireRole(owner.role, ["BUSINESS_OWNER"]);
  const result = await getDatabase().query<BatchRow>(
    `SELECT batch.id, batch.snapshot_hash, batch.status, batch.reconciliation,
            actor.display_name AS created_by_name, batch.created_at
       FROM import_batches batch
       JOIN app_users actor ON actor.id = batch.created_by
      WHERE batch.business_id = $1
      ORDER BY batch.created_at DESC
      LIMIT 12`,
    [owner.businessId],
  );
  return result.rows.map(batchFromRow);
}

export async function getWorkbookReport(
  owner: CurrentUser,
  batchId: string,
): Promise<WorkbookReport | null> {
  requireRole(owner.role, ["BUSINESS_OWNER"]);
  return reportFromDatabase(getDatabase(), owner.businessId, batchId);
}
