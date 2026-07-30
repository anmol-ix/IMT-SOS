"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/ui/PageHeader";

type PaymentMode = "CASH" | "UPI" | "CARD" | "BANK_TRANSFER";
type DigitalPaymentMode = Exclude<PaymentMode, "CASH">;
type CorrectionReason =
  | "LATE_SALES"
  | "COUNT_CORRECTION"
  | "PAYMENT_CORRECTION"
  | "OTHER";

type ClosingRecord = {
  id: string;
  closingNumber: string;
  businessDate: string;
  revision: number;
  supersedesClosingId: string | null;
  correctionReason: CorrectionReason | null;
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
  closedBy: { id: string; name: string };
  createdAt: string;
};

type ClosingView = {
  location: { id: string; name: string; timezone: string };
  current: {
    businessDate: string;
    salesCutoffAt: string;
    saleCount: number;
    unitCount: number;
    revenuePaise: number;
    payments: Array<{
      paymentMode: PaymentMode;
      expectedAmountPaise: number;
    }>;
  };
  latestClosing: ClosingRecord | null;
  status: "OPEN" | "CLOSED" | "NEEDS_RECONCILIATION";
  transactionsAfterClosing: number;
};

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});
const timestamp = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

function formatMoney(paise: number) {
  return money.format(paise / 100);
}

function inputMoney(paise: number) {
  return (paise / 100).toFixed(paise % 100 === 0 ? 0 : 2);
}

function parseRupees(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [rupees, decimals = ""] = normalized.split(".");
  const paise = Number(rupees) * 100 + Number(decimals.padEnd(2, "0"));
  return Number.isSafeInteger(paise) ? paise : null;
}

function paymentLabel(mode: PaymentMode) {
  return mode === "BANK_TRANSFER"
    ? "Bank transfer"
    : mode === "UPI"
      ? "UPI"
      : mode.charAt(0) + mode.slice(1).toLowerCase();
}

function expectedPayment(view: ClosingView, mode: PaymentMode) {
  return view.current.payments.find((payment) => payment.paymentMode === mode)
    ?.expectedAmountPaise ?? 0;
}

function varianceClass(value: number | null) {
  if (value === null || value === 0) return "closing-variance";
  return value > 0 ? "closing-variance over" : "closing-variance short";
}

export default function DailyClosingWorkspace({
  displayName,
  initialClosing,
}: {
  displayName: string;
  initialClosing: ClosingView;
}) {
  const previous = initialClosing.latestClosing;
  const [showForm, setShowForm] = useState(initialClosing.status !== "CLOSED");
  const [openingCash, setOpeningCash] = useState(
    previous ? inputMoney(previous.openingCashPaise) : "",
  );
  const [cashPaidIn, setCashPaidIn] = useState(
    previous ? inputMoney(previous.cashPaidInPaise) : "0",
  );
  const [cashPaidOut, setCashPaidOut] = useState(
    previous ? inputMoney(previous.cashPaidOutPaise) : "0",
  );
  const [countedCash, setCountedCash] = useState("");
  const [verifiedPayments, setVerifiedPayments] = useState<
    Record<DigitalPaymentMode, string>
  >({ UPI: "", CARD: "", BANK_TRANSFER: "" });
  const [cashMovementNote, setCashMovementNote] = useState("");
  const [varianceNote, setVarianceNote] = useState("");
  const [closingNote, setClosingNote] = useState("");
  const [correctionReason, setCorrectionReason] = useState<CorrectionReason>(
    initialClosing.status === "NEEDS_RECONCILIATION"
      ? "LATE_SALES"
      : "COUNT_CORRECTION",
  );
  const [correctionNote, setCorrectionNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<ClosingRecord | null>(null);

  const parsed = useMemo(() => ({
    opening: parseRupees(openingCash),
    paidIn: parseRupees(cashPaidIn),
    paidOut: parseRupees(cashPaidOut),
    counted: parseRupees(countedCash),
    UPI: parseRupees(verifiedPayments.UPI),
    CARD: parseRupees(verifiedPayments.CARD),
    BANK_TRANSFER: parseRupees(verifiedPayments.BANK_TRANSFER),
  }), [
    openingCash,
    cashPaidIn,
    cashPaidOut,
    countedCash,
    verifiedPayments,
  ]);
  const expectedCashSales = expectedPayment(initialClosing, "CASH");
  const expectedDrawer =
    parsed.opening !== null
    && parsed.paidIn !== null
    && parsed.paidOut !== null
      ? parsed.opening + expectedCashSales + parsed.paidIn - parsed.paidOut
      : null;
  const cashVariance =
    expectedDrawer !== null && parsed.counted !== null
      ? parsed.counted - expectedDrawer
      : null;
  const digitalVariances = {
    UPI: parsed.UPI === null
      ? null
      : parsed.UPI - expectedPayment(initialClosing, "UPI"),
    CARD: parsed.CARD === null
      ? null
      : parsed.CARD - expectedPayment(initialClosing, "CARD"),
    BANK_TRANSFER: parsed.BANK_TRANSFER === null
      ? null
      : parsed.BANK_TRANSFER - expectedPayment(initialClosing, "BANK_TRANSFER"),
  };
  const hasVariance =
    cashVariance !== null
    && (
      cashVariance !== 0
      || Object.values(digitalVariances).some(
        (variance) => variance !== null && variance !== 0,
      )
    );
  const hasCashMovement =
    (parsed.paidIn ?? 0) > 0 || (parsed.paidOut ?? 0) > 0;
  const formComplete = Object.values(parsed).every((value) => value !== null)
    && (expectedDrawer ?? -1) >= 0
    && (!hasCashMovement || cashMovementNote.trim().length >= 3)
    && (!hasVariance || varianceNote.trim().length >= 3)
    && (!previous || correctionNote.trim().length >= 3);

  async function submitClosing() {
    if (!formComplete || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/v1/daily-closing", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          openingCashPaise: parsed.opening,
          cashPaidInPaise: parsed.paidIn,
          cashPaidOutPaise: parsed.paidOut,
          countedCashPaise: parsed.counted,
          verifiedDigitalPayments: {
            UPI: parsed.UPI,
            CARD: parsed.CARD,
            BANK_TRANSFER: parsed.BANK_TRANSFER,
          },
          cashMovementNote: cashMovementNote.trim() || undefined,
          varianceNote: varianceNote.trim() || undefined,
          closingNote: closingNote.trim() || undefined,
          replacesClosingId: previous?.id,
          correctionReason: previous ? correctionReason : undefined,
          correctionNote: previous ? correctionNote.trim() : undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error?.message ?? "The closing could not be recorded.");
      }
      setReceipt(body.closing);
      setShowForm(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The closing could not be recorded.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const shownClosing = receipt ?? previous;

  return (
    <AppShell displayName={displayName} role="BUSINESS_OWNER">
      <section className="sell-page closing-page" aria-labelledby="closing-heading">
        <PageHeader
          eyebrow={`Daily closing · ${initialClosing.current.businessDate}`}
          headingId="closing-heading"
          title="Close the day"
          description="Verify cash and digital payments against recorded sales before closing."
        />

        {initialClosing.status === "NEEDS_RECONCILIATION" && !receipt && (
          <div className="closing-alert danger" role="alert">
            <strong>Closing revision required</strong>
            <span>
              {initialClosing.transactionsAfterClosing} completed{" "}
              {initialClosing.transactionsAfterClosing === 1 ? "sale is" : "sales are"}{" "}
              not included in revision {previous?.revision}. Recount and verify
              the current totals below.
            </span>
          </div>
        )}

        <section className="closing-snapshot" aria-labelledby="snapshot-heading">
          <div className="section-title">
            <h2 id="snapshot-heading">System position</h2>
            <span>{initialClosing.location.name} · India shop day</span>
          </div>
          <div className="closing-snapshot-grid">
            <article>
              <small>Revenue recorded</small>
              <strong>{formatMoney(initialClosing.current.revenuePaise)}</strong>
            </article>
            <article>
              <small>Completed sales</small>
              <strong>{initialClosing.current.saleCount}</strong>
            </article>
            <article>
              <small>Units sold</small>
              <strong>{initialClosing.current.unitCount}</strong>
            </article>
            <article>
              <small>Closing state</small>
              <strong className={`closing-state ${initialClosing.status.toLowerCase()}`}>
                {receipt
                  ? "Recorded"
                  : initialClosing.status === "NEEDS_RECONCILIATION"
                    ? "Reconcile"
                    : initialClosing.status === "CLOSED"
                      ? "Closed"
                      : "Open"}
              </strong>
            </article>
          </div>
        </section>

        {shownClosing && !showForm && (
          <section className="closing-receipt" aria-labelledby="record-heading">
            <div className="section-title">
              <div>
                <p className="eyebrow">Immutable closing record</p>
                <h2 id="record-heading">{shownClosing.closingNumber}</h2>
              </div>
              <span>Revision {shownClosing.revision}</span>
            </div>
            <div className="closing-record-meta">
              <span>
                Recorded by <strong>{shownClosing.closedBy.name}</strong>
              </span>
              <span>{timestamp.format(new Date(shownClosing.createdAt))}</span>
            </div>
            <div className="closing-result-grid">
              <article>
                <small>Expected drawer cash</small>
                <strong>{formatMoney(shownClosing.expectedDrawerCashPaise)}</strong>
              </article>
              <article>
                <small>Counted drawer cash</small>
                <strong>{formatMoney(shownClosing.countedDrawerCashPaise)}</strong>
              </article>
              <article className={shownClosing.cashVariancePaise ? "variance" : "matched"}>
                <small>Cash variance</small>
                <strong>{formatMoney(shownClosing.cashVariancePaise)}</strong>
              </article>
            </div>
            <div className="closing-digital-records">
              {shownClosing.digitalPayments.map((payment) => (
                <div key={payment.paymentMode}>
                  <span>{paymentLabel(payment.paymentMode)}</span>
                  <small>
                    Expected {formatMoney(payment.expectedAmountPaise)} · Verified{" "}
                    {formatMoney(payment.verifiedAmountPaise)}
                  </small>
                  <strong className={payment.variancePaise ? "has-variance" : ""}>
                    {payment.variancePaise
                      ? `${payment.variancePaise > 0 ? "+" : ""}${formatMoney(payment.variancePaise)}`
                      : "Matched"}
                  </strong>
                </div>
              ))}
            </div>
            {receipt ? (
              <div className="closing-actions">
                <Link className="button" href="/dashboard">
                  Return to owner control
                </Link>
              </div>
            ) : (
              <button
                className="secondary-button"
                type="button"
                onClick={() => setShowForm(true)}
              >
                Record a correction
              </button>
            )}
          </section>
        )}

        {showForm && (
          <section className="closing-form" aria-labelledby="reconcile-heading">
            <div className="section-title">
              <div>
                <p className="eyebrow">
                  {previous ? `Revision ${previous.revision + 1}` : "First close"}
                </p>
                <h2 id="reconcile-heading">Reconcile the shop day</h2>
              </div>
              <span>Owner only</span>
            </div>

            <div className="closing-explainer">
              <strong>Expected drawer cash</strong>
              <span>
                Opening float + {formatMoney(expectedCashSales)} cash sales
                + cash paid in − cash paid out.
              </span>
            </div>

            <div className="closing-fields three">
              <label>
                Opening cash float
                <input
                  aria-label="Opening cash float"
                  inputMode="decimal"
                  placeholder="₹0.00"
                  value={openingCash}
                  onChange={(event) => setOpeningCash(event.target.value)}
                />
              </label>
              <label>
                Cash paid in
                <input
                  aria-label="Cash paid in"
                  inputMode="decimal"
                  value={cashPaidIn}
                  onChange={(event) => setCashPaidIn(event.target.value)}
                />
              </label>
              <label>
                Cash paid out
                <input
                  aria-label="Cash paid out"
                  inputMode="decimal"
                  value={cashPaidOut}
                  onChange={(event) => setCashPaidOut(event.target.value)}
                />
              </label>
            </div>

            {hasCashMovement && (
              <label className="closing-note-field">
                Explain cash paid in or out
                <textarea
                  aria-label="Explain cash paid in or out"
                  placeholder="What changed the drawer cash, and why?"
                  value={cashMovementNote}
                  onChange={(event) => setCashMovementNote(event.target.value)}
                />
              </label>
            )}

            <div className="cash-count-panel">
              <div>
                <small>Expected drawer cash</small>
                <strong>
                  {expectedDrawer !== null && expectedDrawer >= 0
                    ? formatMoney(expectedDrawer)
                    : "Enter valid cash figures"}
                </strong>
              </div>
              <label>
                Cash physically counted
                <input
                  aria-label="Cash physically counted"
                  inputMode="decimal"
                  placeholder="Count, then enter"
                  value={countedCash}
                  onChange={(event) => setCountedCash(event.target.value)}
                />
              </label>
              <div className={varianceClass(cashVariance)}>
                <small>Cash variance</small>
                <strong>
                  {cashVariance === null ? "—" : formatMoney(cashVariance)}
                </strong>
              </div>
            </div>

            <div className="section-title digital-title">
              <div>
                <h3>Verify digital payments</h3>
                <p>Read each total from the payment provider—not from this screen.</p>
              </div>
            </div>
            <div className="digital-closing-list">
              {(["UPI", "CARD", "BANK_TRANSFER"] as const).map((mode) => (
                <div key={mode}>
                  <span>
                    <strong>{paymentLabel(mode)}</strong>
                    <small>
                      System expected {formatMoney(expectedPayment(initialClosing, mode))}
                    </small>
                  </span>
                  <label>
                    Verified amount
                    <input
                      aria-label={`${paymentLabel(mode)} verified amount`}
                      inputMode="decimal"
                      placeholder="₹0.00"
                      value={verifiedPayments[mode]}
                      onChange={(event) =>
                        setVerifiedPayments((current) => ({
                          ...current,
                          [mode]: event.target.value,
                        }))}
                    />
                  </label>
                  <div className={varianceClass(digitalVariances[mode])}>
                    <small>Variance</small>
                    <strong>
                      {digitalVariances[mode] === null
                        ? "—"
                        : formatMoney(digitalVariances[mode])}
                    </strong>
                  </div>
                </div>
              ))}
            </div>

            {hasVariance && (
              <label className="closing-note-field variance-note">
                Explain the variance
                <textarea
                  aria-label="Explain the variance"
                  placeholder="What was checked, what differs, and what happens next?"
                  value={varianceNote}
                  onChange={(event) => setVarianceNote(event.target.value)}
                />
              </label>
            )}

            {previous && (
              <div className="closing-correction">
                <p className="eyebrow">Correction evidence</p>
                <div className="closing-fields two">
                  <label>
                    Correction reason
                    <select
                      aria-label="Correction reason"
                      value={correctionReason}
                      onChange={(event) =>
                        setCorrectionReason(event.target.value as CorrectionReason)}
                    >
                      <option value="LATE_SALES">Sales completed after closing</option>
                      <option value="COUNT_CORRECTION">Cash count correction</option>
                      <option value="PAYMENT_CORRECTION">Payment verification correction</option>
                      <option value="OTHER">Other controlled correction</option>
                    </select>
                  </label>
                  <label>
                    Why is a new revision needed?
                    <input
                      aria-label="Why is a new revision needed?"
                      value={correctionNote}
                      onChange={(event) => setCorrectionNote(event.target.value)}
                    />
                  </label>
                </div>
                <p>
                  Revision {previous.revision} remains unchanged. This creates
                  revision {previous.revision + 1} linked to it.
                </p>
              </div>
            )}

            <label className="closing-note-field">
              Closing note <span>(optional)</span>
              <textarea
                aria-label="Closing note"
                placeholder="Anything the next owner review should know"
                value={closingNote}
                onChange={(event) => setClosingNote(event.target.value)}
              />
            </label>

            {error && <div className="closing-alert danger" role="alert">{error}</div>}
            <div className="closing-submit">
              <p>
                This records an immutable owner closing. It does not change any
                sale, payment or stock record.
              </p>
              <button
                className="complete-button"
                type="button"
                disabled={!formComplete || submitting}
                onClick={submitClosing}
              >
                {submitting
                  ? "Recording safely…"
                  : previous
                    ? "Record closing revision"
                    : "Record daily closing"}
              </button>
            </div>
          </section>
        )}
      </section>
    </AppShell>
  );
}
