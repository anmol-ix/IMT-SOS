"use client";

import Link from "next/link";
import { useState } from "react";
import type {
  WorkbookBatch,
  WorkbookReport,
} from "@/server/workbook-import";

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});
const reportDate = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

async function responseBody<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error?.message || "The validation could not be completed.");
  }
  return body as T;
}

function countIssues(report: WorkbookReport, severity: "ERROR" | "WARNING") {
  return report.rows.reduce(
    (total, row) =>
      total + row.issues.filter((issue) => issue.severity === severity).length,
    0,
  );
}

export default function MigrationWorkspace({
  displayName,
  initialBatches,
  initialReport,
  validationEnabled,
}: {
  displayName: string;
  initialBatches: WorkbookBatch[];
  initialReport: WorkbookReport | null;
  validationEnabled: boolean;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function validate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const body = await responseBody<{ report: WorkbookReport }>(
        await fetch("/api/v1/imports", {
          method: "POST",
          body: new FormData(event.currentTarget),
        }),
      );
      window.location.assign(`/migration?batch=${body.report.batch.id}`);
    } catch (currentError) {
      setError(
        currentError instanceof Error
          ? currentError.message
          : "The validation could not be completed.",
      );
      setSubmitting(false);
    }
  }

  const issueRows = initialReport?.rows.filter((row) => row.issues.length) ?? [];
  const errorCount = initialReport ? countIssues(initialReport, "ERROR") : 0;
  const warningCount = initialReport ? countIssues(initialReport, "WARNING") : 0;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="brand">ItsMyToy</p>
          <p className="welcome">Hi, {displayName}</p>
        </div>
        <nav className="app-nav" aria-label="Operations">
          <Link href="/dashboard">Home</Link>
          <Link href="/">Sell</Link>
          <Link href="/receive">Receive</Link>
          <Link href="/inventory">Inventory</Link>
          <Link href="/activity">Activity</Link>
          <Link className="active" href="/migration">Migration</Link>
          <Link href="/team">Team</Link>
        </nav>
        <span className="role-chip">Business owner</span>
      </header>

      <section className="sell-page migration-page" aria-labelledby="migration-heading">
        <div className="page-heading">
          <p className="eyebrow">M5 · controlled workbook migration</p>
          <h1 id="migration-heading">Validate before anything moves.</h1>
          <p>
            Export the three source tabs as CSV. This creates a frozen,
            owner-only validation report; it cannot create products, customers,
            stock movements or sales.
          </p>
        </div>

        <section className="migration-safety" aria-label="Migration safety boundary">
          <strong>
            {validationEnabled
              ? "Read-only staging is locked on"
              : "Production workbook uploads are locked"}
          </strong>
          <span>
            {validationEnabled
              ? "No live-import action exists in this milestone."
              : "Complete the backup and restore safety gate before enabling them."}
          </span>
        </section>

        <section className="migration-panel" aria-labelledby="snapshot-heading">
          <div className="migration-section-heading">
            <div>
              <p className="eyebrow">New snapshot</p>
              <h2 id="snapshot-heading">Upload the matching CSV exports</h2>
            </div>
            <span>3 files required</span>
          </div>
          <form className="migration-upload" onSubmit={validate}>
            <label>
              Inventory Master.csv
              <input
                name="inventory"
                type="file"
                accept=".csv,text/csv"
                required
                disabled={!validationEnabled}
              />
            </label>
            <label>
              Sales Log.csv
              <input
                name="sales"
                type="file"
                accept=".csv,text/csv"
                required
                disabled={!validationEnabled}
              />
            </label>
            <label>
              Customers.csv
              <input
                name="customers"
                type="file"
                accept=".csv,text/csv"
                required
                disabled={!validationEnabled}
              />
            </label>
            <button
              className="button"
              type="submit"
              disabled={submitting || !validationEnabled}
            >
              {submitting ? "Validating…" : "Validate snapshot"}
            </button>
          </form>
          {error && <p className="migration-error" role="alert">{error}</p>}
          <p className="migration-help">
            In Google Sheets: open one tab → File → Download → Comma Separated
            Values (.csv). Repeat for the same workbook snapshot.
          </p>
        </section>

        <section className="migration-panel" aria-labelledby="mapping-heading">
          <div className="migration-section-heading">
            <div>
              <p className="eyebrow">Explicit mapping</p>
              <h2 id="mapping-heading">What the validator trusts</h2>
            </div>
            <span>Formula totals are not source truth</span>
          </div>
          <div className="migration-mapping">
            <article>
              <h3>Inventory Master</h3>
              <p><strong>Uses:</strong> SKU, item, category, prices and quantities.</p>
              <p><strong>Checks:</strong> SKU uniqueness, positive prices and stock arithmetic.</p>
              <p><strong>Does not trust:</strong> dashboard totals or sales-value formulas.</p>
            </article>
            <article>
              <h3>Sales Log</h3>
              <p><strong>Uses:</strong> date, Sale ID, SKU, quantity, unit actual price and payment context.</p>
              <p><strong>Checks:</strong> line total = quantity × unit price; zero-price and missing-SKU rows are quarantined.</p>
              <p><strong>Flags:</strong> below-cost, missing payment mode and missing channel.</p>
            </article>
            <article>
              <h3>Customers</h3>
              <p><strong>Uses:</strong> source ID, name, phone, email, locality and notes.</p>
              <p><strong>Checks:</strong> unique valid phone and duplicate customer IDs.</p>
              <p><strong>Excludes:</strong> child name, birthday and age; spend and visit totals are derived later.</p>
            </article>
          </div>
        </section>

        {initialReport && (
          <section className="migration-panel migration-report" aria-labelledby="report-heading">
            <div className="migration-section-heading">
              <div>
                <p className="eyebrow">Frozen validation report</p>
                <h2 id="report-heading">
                  Snapshot {initialReport.batch.snapshotHash.slice(0, 12)}
                </h2>
                <p>
                  {reportDate.format(new Date(initialReport.batch.createdAt))}
                  {" · "}validated by {initialReport.batch.createdBy}
                </p>
              </div>
              <span>{initialReport.batch.status}</span>
            </div>

            <div className="migration-metrics">
              <article>
                <small>Source rows</small>
                <strong>
                  {initialReport.batch.reconciliation.source.products
                    + initialReport.batch.reconciliation.source.saleLines
                    + initialReport.batch.reconciliation.source.customers}
                </strong>
                <span>
                  {initialReport.batch.reconciliation.source.products} products ·{" "}
                  {initialReport.batch.reconciliation.source.saleLines} sale lines ·{" "}
                  {initialReport.batch.reconciliation.source.customers} customers
                </span>
              </article>
              <article className="safe">
                <small>Accepted for later review</small>
                <strong>
                  {initialReport.batch.reconciliation.accepted.products
                    + initialReport.batch.reconciliation.accepted.saleLines
                    + initialReport.batch.reconciliation.accepted.customers}
                </strong>
                <span>Still not imported into live records</span>
              </article>
              <article className={initialReport.batch.reconciliation.quarantined ? "urgent" : "safe"}>
                <small>Quarantined rows</small>
                <strong>{initialReport.batch.reconciliation.quarantined}</strong>
                <span>{errorCount} blocking errors</span>
              </article>
              <article className={warningCount ? "waiting" : "safe"}>
                <small>Warnings</small>
                <strong>{warningCount}</strong>
                <span>Owner review before import approval</span>
              </article>
            </div>

            <div className="migration-reconciliation">
              <div>
                <span>Source sales</span>
                <strong>
                  {initialReport.batch.reconciliation.sales.sourceUnits} units ·{" "}
                  {money.format(initialReport.batch.reconciliation.sales.sourceRevenuePaise / 100)}
                </strong>
              </div>
              <div>
                <span>Accepted sales after quarantine</span>
                <strong>
                  {initialReport.batch.reconciliation.sales.acceptedUnits} units ·{" "}
                  {money.format(initialReport.batch.reconciliation.sales.acceptedRevenuePaise / 100)}
                </strong>
              </div>
            </div>

            <div className="migration-exceptions">
              <div className="migration-section-heading">
                <div>
                  <h3>Exception report</h3>
                  <p>Every row with a blocking error or warning, with its source coordinate.</p>
                </div>
                <span>{issueRows.length} rows</span>
              </div>
              {issueRows.length ? (
                <div className="migration-issue-list">
                  {issueRows.map((row) => (
                    <article key={`${row.sheet}-${row.row}`}>
                      <div className="migration-row-heading">
                        <span>{row.sheet} · row {row.row}</span>
                        <strong>{row.sourceIdentifier || "No source ID"}</strong>
                        <em className={row.status.toLowerCase()}>{row.status}</em>
                      </div>
                      <ul>
                        {row.issues.map((issue, index) => (
                          <li key={`${issue.code}-${index}`} className={issue.severity.toLowerCase()}>
                            <strong>{issue.severity}: {issue.field}</strong>
                            <span>{issue.message}</span>
                            {issue.originalValue && <code>{issue.originalValue}</code>}
                          </li>
                        ))}
                      </ul>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="migration-empty">No exceptions were found in this snapshot.</p>
              )}
            </div>
          </section>
        )}

        {initialBatches.length > 0 && (
          <section className="migration-panel" aria-labelledby="history-heading">
            <div className="migration-section-heading">
              <div>
                <p className="eyebrow">Immutable history</p>
                <h2 id="history-heading">Validation snapshots</h2>
              </div>
              <span>{initialBatches.length} recent</span>
            </div>
            <div className="migration-history">
              {initialBatches.map((batch) => (
                <Link
                  className={initialReport?.batch.id === batch.id ? "active" : ""}
                  href={`/migration?batch=${batch.id}`}
                  key={batch.id}
                >
                  <span>
                    <strong>{batch.snapshotHash.slice(0, 12)}</strong>
                    <small>{reportDate.format(new Date(batch.createdAt))} · {batch.createdBy}</small>
                  </span>
                  <span>
                    {batch.reconciliation.quarantined} quarantined ·{" "}
                    {batch.reconciliation.warnings} warnings
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
