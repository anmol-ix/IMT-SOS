import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { CurrentUser } from "./auth/current-user";
import { requireRole } from "./auth/roles";
import { database, inTransaction } from "./database";
import { IdempotencyConflictError } from "./proof-command";
import {
  calculateDailyClosing,
  DIGITAL_PAYMENT_MODES,
  type DigitalPaymentMode,
} from "@/shared/daily-closing-policy";

export const DAILY_CLOSING_CORRECTION_REASONS = [
  "LATE_SALES",
  "COUNT_CORRECTION",
  "PAYMENT_CORRECTION",
  "OTHER",
] as const;

export type DailyClosingCorrectionReason =
  (typeof DAILY_CLOSING_CORRECTION_REASONS)[number];

type Location = {
  id: string;
  name: string;
  timezone: string;
  businessDate: string;
  cutoffAt: string;
};

export type DailyClosingSnapshot = {
  businessDate: string;
  salesCutoffAt: string;
  saleCount: number;
  unitCount: number;
  revenuePaise: number;
  payments: Array<{
    paymentMode: "CASH" | DigitalPaymentMode;
    expectedAmountPaise: number;
  }>;
};

export type DailyClosingRecord = {
  id: string;
  closingNumber: string;
  businessDate: string;
  revision: number;
  supersedesClosingId: string | null;
  correctionReason: DailyClosingCorrectionReason | null;
  saleCount: number;
  unitCount: number;
  revenuePaise: number;
  salesCutoffAt: string;
  openingCashPaise: number;
  cashSalesPaise: number;
  cashPaidInPaise: number;
  cashPaidOutPaise: number;
  expectedDrawerCashPaise: number;
  countedDrawerCashPaise: number;
  cashVariancePaise: number;
  digitalPayments: Array<{
    paymentMode: DigitalPaymentMode;
    expectedAmountPaise: number;
    verifiedAmountPaise: number;
    variancePaise: number;
  }>;
  hasVariance: boolean;
  closedBy: {
    id: string;
    name: string;
  };
  createdAt: string;
};

export type DailyClosingView = {
  location: {
    id: string;
    name: string;
    timezone: string;
  };
  current: DailyClosingSnapshot;
  latestClosing: DailyClosingRecord | null;
  status: "OPEN" | "CLOSED" | "NEEDS_RECONCILIATION";
  transactionsAfterClosing: number;
};

export type RecordDailyClosingInput = {
  openingCashPaise: number;
  cashPaidInPaise: number;
  cashPaidOutPaise: number;
  countedCashPaise: number;
  verifiedDigitalPayments: Record<DigitalPaymentMode, number>;
  cashMovementNote?: string;
  varianceNote?: string;
  closingNote?: string;
  replacesClosingId?: string;
  correctionReason?: DailyClosingCorrectionReason;
  correctionNote?: string;
};

export class DailyClosingUnavailableError extends Error {
  readonly status = 409;
  readonly code = "DAILY_CLOSING_UNAVAILABLE";

  constructor(message: string) {
    super(message);
    this.name = "DailyClosingUnavailableError";
  }
}

async function getLocation(
  connection: Pick<PoolClient, "query">,
  businessId: string,
): Promise<Location> {
  const result = await connection.query<{
    id: string;
    name: string;
    timezone: string;
    business_date: string;
    cutoff_at: string;
  }>(
    `SELECT
       id, name, timezone,
       to_char(transaction_timestamp() AT TIME ZONE timezone, 'YYYY-MM-DD')
         AS business_date,
       transaction_timestamp()::text AS cutoff_at
     FROM locations
     WHERE business_id = $1 AND status = 'ACTIVE'
     ORDER BY created_at
     LIMIT 1`,
    [businessId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new DailyClosingUnavailableError(
      "No active shop location is available for daily closing.",
    );
  }
  return {
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    businessDate: row.business_date,
    cutoffAt: row.cutoff_at,
  };
}

async function getSnapshot(
  connection: Pick<PoolClient, "query">,
  businessId: string,
  location: Location,
): Promise<DailyClosingSnapshot> {
  const result = await connection.query<{
    sale_count: number;
    unit_count: number;
    revenue_paise: string;
    payment_mode: "CASH" | DigitalPaymentMode;
    expected_amount_paise: string;
  }>(
    `WITH bounds AS (
       SELECT
         $3::date AT TIME ZONE $4 AS starts_at,
         ($3::date + 1) AT TIME ZONE $4 AS ends_at
     ),
     today_sales AS (
       SELECT s.id, s.total_paise
       FROM sales s
       JOIN bounds b ON true
       WHERE s.business_id = $1 AND s.location_id = $2
         AND s.status = 'COMPLETED'
         AND s.completed_at >= b.starts_at AND s.completed_at < b.ends_at
         AND s.completed_at <= $5::timestamptz
     ),
     summary AS (
       SELECT
         count(*)::int AS sale_count,
         COALESCE(sum(total_paise), 0)::bigint AS revenue_paise
       FROM today_sales
     ),
     units AS (
       SELECT COALESCE(sum(sl.quantity), 0)::int AS unit_count
       FROM sale_lines sl
       JOIN today_sales s ON s.id = sl.sale_id
     ),
     payment_totals AS (
       SELECT sp.payment_mode, sum(sp.amount_paise)::bigint AS amount_paise
       FROM sale_payments sp
       JOIN today_sales s ON s.id = sp.sale_id
       GROUP BY sp.payment_mode
     ),
     modes(payment_mode, sort_order) AS (
       VALUES
         ('CASH'::text, 1), ('UPI'::text, 2),
         ('CARD'::text, 3), ('BANK_TRANSFER'::text, 4)
     )
     SELECT
       summary.sale_count, units.unit_count, summary.revenue_paise,
       modes.payment_mode,
       COALESCE(payment_totals.amount_paise, 0)::bigint AS expected_amount_paise
     FROM summary
     CROSS JOIN units
     CROSS JOIN modes
     LEFT JOIN payment_totals USING (payment_mode)
     ORDER BY modes.sort_order`,
    [
      businessId,
      location.id,
      location.businessDate,
      location.timezone,
      location.cutoffAt,
    ],
  );
  const first = result.rows[0];
  return {
    businessDate: location.businessDate,
    salesCutoffAt: location.cutoffAt,
    saleCount: first.sale_count,
    unitCount: first.unit_count,
    revenuePaise: Number(first.revenue_paise),
    payments: result.rows.map((row) => ({
      paymentMode: row.payment_mode,
      expectedAmountPaise: Number(row.expected_amount_paise),
    })),
  };
}

function expectedPayment(
  snapshot: DailyClosingSnapshot,
  mode: "CASH" | DigitalPaymentMode,
): number {
  return snapshot.payments.find((payment) => payment.paymentMode === mode)
    ?.expectedAmountPaise ?? 0;
}

async function getLatestClosing(
  connection: Pick<PoolClient, "query">,
  businessId: string,
  locationId: string,
  businessDate: string,
): Promise<DailyClosingRecord | null> {
  const result = await connection.query<{
    result_json: DailyClosingRecord;
  }>(
    `SELECT result_json
     FROM daily_closings
     WHERE business_id = $1 AND location_id = $2 AND business_date = $3
     ORDER BY revision DESC
     LIMIT 1`,
    [businessId, locationId, businessDate],
  );
  return result.rows[0]?.result_json ?? null;
}

function closingMatchesSnapshot(
  closing: DailyClosingRecord,
  snapshot: DailyClosingSnapshot,
): boolean {
  if (
    closing.saleCount !== snapshot.saleCount
    || closing.unitCount !== snapshot.unitCount
    || closing.revenuePaise !== snapshot.revenuePaise
    || closing.cashSalesPaise !== expectedPayment(snapshot, "CASH")
  ) {
    return false;
  }
  return DIGITAL_PAYMENT_MODES.every((mode) => {
    const prior = closing.digitalPayments.find(
      (payment) => payment.paymentMode === mode,
    );
    return prior?.expectedAmountPaise === expectedPayment(snapshot, mode);
  });
}

export async function getDailyClosingView(
  user: CurrentUser,
): Promise<DailyClosingView> {
  requireRole(user.role, ["BUSINESS_OWNER"]);
  const location = await getLocation(database, user.businessId);
  const [current, latestClosing] = await Promise.all([
    getSnapshot(database, user.businessId, location),
    getLatestClosing(
      database,
      user.businessId,
      location.id,
      location.businessDate,
    ),
  ]);
  const matches = latestClosing
    ? closingMatchesSnapshot(latestClosing, current)
    : false;

  return {
    location: {
      id: location.id,
      name: location.name,
      timezone: location.timezone,
    },
    current,
    latestClosing,
    status: !latestClosing
      ? "OPEN"
      : matches
        ? "CLOSED"
        : "NEEDS_RECONCILIATION",
    transactionsAfterClosing: latestClosing
      ? Math.max(0, current.saleCount - latestClosing.saleCount)
      : 0,
  };
}

export async function recordDailyClosing(
  user: CurrentUser,
  commandId: string,
  input: RecordDailyClosingInput,
): Promise<DailyClosingRecord & { replayed: boolean }> {
  requireRole(user.role, ["BUSINESS_OWNER"]);
  const requestHash = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");

  return inTransaction(async (client) => {
    const priorCommand = await client.query<{
      request_hash: string;
      result_json: DailyClosingRecord;
    }>(
      `SELECT request_hash, result_json
       FROM daily_closings
       WHERE business_id = $1 AND command_id = $2`,
      [user.businessId, commandId],
    );
    if (priorCommand.rows[0]) {
      if (priorCommand.rows[0].request_hash !== requestHash) {
        throw new IdempotencyConflictError();
      }
      return { ...priorCommand.rows[0].result_json, replayed: true };
    }

    const location = await getLocation(client, user.businessId);
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`daily-closing:${user.businessId}:${location.id}:${location.businessDate}`],
    );
    const latest = await getLatestClosing(
      client,
      user.businessId,
      location.id,
      location.businessDate,
    );

    if (!latest && input.replacesClosingId) {
      throw new DailyClosingUnavailableError(
        "There is no earlier closing to correct for this shop day.",
      );
    }
    if (latest) {
      if (input.replacesClosingId !== latest.id) {
        throw new DailyClosingUnavailableError(
          "This closing has changed. Refresh and reconcile the latest revision.",
        );
      }
      if (!input.correctionReason || (input.correctionNote?.trim().length ?? 0) < 3) {
        throw new DailyClosingUnavailableError(
          "Choose a correction reason and explain why a new revision is needed.",
        );
      }
    } else if (
      input.correctionReason
      || input.correctionNote
    ) {
      throw new DailyClosingUnavailableError(
        "Correction details are only valid after an earlier closing.",
      );
    }

    const snapshot = await getSnapshot(client, user.businessId, location);
    const calculation = calculateDailyClosing({
      expectedCashSalesPaise: expectedPayment(snapshot, "CASH"),
      openingCashPaise: input.openingCashPaise,
      cashPaidInPaise: input.cashPaidInPaise,
      cashPaidOutPaise: input.cashPaidOutPaise,
      countedCashPaise: input.countedCashPaise,
      expectedDigitalPayments: Object.fromEntries(
        DIGITAL_PAYMENT_MODES.map((mode) => [
          mode,
          expectedPayment(snapshot, mode),
        ]),
      ) as Record<DigitalPaymentMode, number>,
      verifiedDigitalPayments: input.verifiedDigitalPayments,
      cashMovementNote: input.cashMovementNote,
      varianceNote: input.varianceNote,
    });

    const id = randomUUID();
    const closingNumber =
      `CLS-${id.replaceAll("-", "").slice(0, 12).toUpperCase()}`;
    const revision = (latest?.revision ?? 0) + 1;
    const createdAt = new Date().toISOString();
    const result: DailyClosingRecord = {
      id,
      closingNumber,
      businessDate: location.businessDate,
      revision,
      supersedesClosingId: latest?.id ?? null,
      correctionReason: input.correctionReason ?? null,
      saleCount: snapshot.saleCount,
      unitCount: snapshot.unitCount,
      revenuePaise: snapshot.revenuePaise,
      salesCutoffAt: snapshot.salesCutoffAt,
      openingCashPaise: input.openingCashPaise,
      cashSalesPaise: expectedPayment(snapshot, "CASH"),
      cashPaidInPaise: input.cashPaidInPaise,
      cashPaidOutPaise: input.cashPaidOutPaise,
      expectedDrawerCashPaise: calculation.expectedDrawerCashPaise,
      countedDrawerCashPaise: input.countedCashPaise,
      cashVariancePaise: calculation.cashVariancePaise,
      digitalPayments: calculation.digitalPayments,
      hasVariance: calculation.hasVariance,
      closedBy: {
        id: user.id,
        name: user.displayName,
      },
      createdAt,
    };

    await client.query(
      `INSERT INTO daily_closings (
        id, closing_number, business_id, location_id, business_date, revision,
        supersedes_closing_id, correction_reason, correction_note,
        command_id, request_hash, sales_cutoff_at, sale_count, unit_count,
        revenue_paise, cash_sales_paise, opening_cash_paise, cash_paid_in_paise,
        cash_paid_out_paise, expected_drawer_cash_paise,
        counted_drawer_cash_paise, cash_variance_paise, has_variance,
        cash_movement_note, variance_note, closing_note, created_by, created_at,
        result_json
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27,
        $28, $29
      )`,
      [
        id,
        closingNumber,
        user.businessId,
        location.id,
        location.businessDate,
        revision,
        latest?.id ?? null,
        input.correctionReason ?? null,
        input.correctionNote?.trim() || null,
        commandId,
        requestHash,
        snapshot.salesCutoffAt,
        snapshot.saleCount,
        snapshot.unitCount,
        snapshot.revenuePaise,
        expectedPayment(snapshot, "CASH"),
        input.openingCashPaise,
        input.cashPaidInPaise,
        input.cashPaidOutPaise,
        calculation.expectedDrawerCashPaise,
        input.countedCashPaise,
        calculation.cashVariancePaise,
        calculation.hasVariance,
        input.cashMovementNote?.trim() || null,
        input.varianceNote?.trim() || null,
        input.closingNote?.trim() || null,
        user.id,
        createdAt,
        result,
      ],
    );

    for (const payment of calculation.digitalPayments) {
      await client.query(
        `INSERT INTO daily_closing_payments
          (closing_id, payment_mode, expected_amount_paise,
           verified_amount_paise)
         VALUES ($1, $2, $3, $4)`,
        [
          id,
          payment.paymentMode,
          payment.expectedAmountPaise,
          payment.verifiedAmountPaise,
        ],
      );
    }

    await client.query(
      `INSERT INTO audit_events
        (business_id, actor_user_id, event_type, entity_type, entity_id, details)
       VALUES ($1, $2, $3, 'DAILY_CLOSING', $4, $5)`,
      [
        user.businessId,
        user.id,
        revision === 1 ? "DAILY_CLOSING_RECORDED" : "DAILY_CLOSING_REVISED",
        id,
        {
          closingNumber,
          businessDate: location.businessDate,
          revision,
          supersedesClosingId: latest?.id ?? null,
          correctionReason: input.correctionReason ?? null,
          saleCount: snapshot.saleCount,
          unitCount: snapshot.unitCount,
          revenuePaise: snapshot.revenuePaise,
          cashVariancePaise: calculation.cashVariancePaise,
          digitalPaymentVariances: calculation.digitalPayments.map(
            ({ paymentMode, variancePaise }) => ({
              paymentMode,
              variancePaise,
            }),
          ),
        },
      ],
    );

    return { ...result, replayed: false };
  });
}
