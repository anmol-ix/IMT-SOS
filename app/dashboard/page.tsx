import Link from "next/link";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import { requireCurrentUser } from "@/server/auth/current-user";
import { getDailyClosingView } from "@/server/daily-closing";
import { getOwnerDashboard } from "@/server/owner-dashboard";

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});
const updatedAt = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

function formatMoney(paise: number) {
  return money.format(paise / 100);
}

function paymentLabel(mode: string) {
  return mode === "BANK_TRANSFER"
    ? "Bank transfer"
    : mode === "UPI"
      ? "UPI"
      : mode.charAt(0) + mode.slice(1).toLowerCase();
}

export default async function DashboardPage() {
  const user = await requireCurrentUser(["BUSINESS_OWNER"]);
  const [dashboard, closing] = await Promise.all([
    getOwnerDashboard(user),
    getDailyClosingView(user),
  ]);
  const closingNeedsAction = closing.status === "CLOSED" ? 0 : 1;
  const pendingApprovals =
    dashboard.actions.offlineSaleConflicts
    + dashboard.actions.priceApprovals
    + dashboard.actions.guestApprovals
    + dashboard.actions.stockAdjustments;
  const reorderSetupNeedsAction = dashboard.stock.unconfiguredReorderPolicyCount;
  const criticalDataIssues =
    dashboard.dataQuality.ledgerMismatchCount
    + dashboard.dataQuality.missingRackCount
    + dashboard.dataQuality.missingBalanceCount
    + dashboard.dataQuality.missingActivePriceCount;

  return (
    <AppShell displayName={user.displayName} role="BUSINESS_OWNER">
      <section className="sell-page dashboard-page" aria-labelledby="dashboard-heading">
        <PageHeader
          eyebrow={`Owner overview · ${dashboard.businessDate}`}
          headingId="dashboard-heading"
          title="Operations overview"
          description="Today’s position, pending decisions and stock risk."
          actions={
            <div className="dashboard-updated">
              <span>Updated</span>
              <strong>{updatedAt.format(new Date(dashboard.asOf))}</strong>
              <Link href="/dashboard">Refresh</Link>
            </div>
          }
        />

        <section className="dashboard-section" aria-labelledby="today-heading">
          <div className="section-title">
            <h2 id="today-heading">Today’s position</h2>
            <span>India shop day</span>
          </div>
          <div className="dashboard-metrics">
            <article className="metric-card primary">
              <small>Revenue</small>
              <strong>{formatMoney(dashboard.today.revenuePaise)}</strong>
              <span>{dashboard.today.orderCount} completed orders</span>
            </article>
            <article className="metric-card">
              <small>Units sold</small>
              <strong>{dashboard.today.unitCount}</strong>
              <span>Across completed sales</span>
            </article>
            <article className="metric-card internal">
              <small>Accounting gross product profit</small>
              <strong>
                {formatMoney(dashboard.today.accountingGrossProductProfitPaise)}
              </strong>
              <span>Sales minus frozen accounting COGS</span>
            </article>
            <article className="metric-card internal">
              <small>Replacement margin</small>
              <strong>{formatMoney(dashboard.today.replacementMarginPaise)}</strong>
              <span>Sales minus sale-time replacement cost</span>
            </article>
          </div>
        </section>

        <section className="dashboard-section" aria-labelledby="queue-heading">
          <div className="section-title">
            <h2 id="queue-heading">Action queue</h2>
            <span>
              {pendingApprovals
                + dashboard.actions.receiptDrafts
                + closingNeedsAction
                + reorderSetupNeedsAction} waiting
            </span>
          </div>
          <div className="action-grid">
            <Link className={pendingApprovals ? "action-card urgent" : "action-card"} href="/approvals">
              <span>Owner decisions</span>
              <strong>{pendingApprovals}</strong>
              <small>
                {dashboard.actions.offlineSaleConflicts} offline ·{" "}
                {dashboard.actions.stockAdjustments} stock ·{" "}
                {dashboard.actions.priceApprovals} price ·{" "}
                {dashboard.actions.guestApprovals} Guest
              </small>
            </Link>
            <Link
              className={dashboard.actions.receiptDrafts ? "action-card waiting" : "action-card"}
              href="/receive"
            >
              <span>Receipts awaiting review</span>
              <strong>{dashboard.actions.receiptDrafts}</strong>
              <small>Trusted-operator drafts with zero stock effect</small>
            </Link>
            <Link
              className={dashboard.stock.outOfStockCount ? "action-card urgent" : "action-card"}
              href="/dashboard#stock-risk"
            >
              <span>Out-of-stock SKUs</span>
              <strong>{dashboard.stock.outOfStockCount}</strong>
              <small>{dashboard.stock.lowStockCount} configured reorder alerts</small>
            </Link>
            <Link
              className={reorderSetupNeedsAction ? "action-card waiting" : "action-card safe"}
              href="/dashboard#stock-risk"
            >
              <span>Reorder policies missing</span>
              <strong>{reorderSetupNeedsAction}</strong>
              <small>Set an alert point and restock target per SKU</small>
            </Link>
            <Link
              className={criticalDataIssues ? "action-card urgent" : "action-card safe"}
              href="/dashboard#data-quality"
            >
              <span>Critical data exceptions</span>
              <strong>{criticalDataIssues}</strong>
              <small>
                {criticalDataIssues
                  ? "Open the checks below"
                  : "Ledger, rack, balance and active price checks passed"}
              </small>
            </Link>
            <Link
              className={
                closing.status === "NEEDS_RECONCILIATION"
                  ? "action-card urgent"
                  : closing.status === "OPEN"
                    ? "action-card waiting"
                    : "action-card safe"
              }
              href="/closing"
            >
              <span>Daily closing</span>
              <strong>
                {closing.status === "NEEDS_RECONCILIATION"
                  ? "Reconcile"
                  : closing.status === "OPEN"
                    ? "Open"
                    : "Closed"}
              </strong>
              <small>
                {closing.status === "NEEDS_RECONCILIATION"
                  ? `${closing.transactionsAfterClosing} later sales need a new revision`
                  : closing.status === "OPEN"
                    ? "Count cash and independently verify payments"
                    : `Revision ${closing.latestClosing?.revision} recorded`}
              </small>
            </Link>
          </div>
        </section>

        <div className="dashboard-two-column">
          <section className="dashboard-section dashboard-panel" aria-labelledby="payments-heading">
            <div className="section-title">
              <h2 id="payments-heading">Payments today</h2>
              <span>{formatMoney(dashboard.today.revenuePaise)}</span>
            </div>
            {dashboard.payments.length ? (
              <div className="payment-breakdown">
                {dashboard.payments.map((payment) => (
                  <div key={payment.paymentMode}>
                    <span>{paymentLabel(payment.paymentMode)}</span>
                    <strong>{formatMoney(payment.amountPaise)}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <p className="dashboard-empty">No completed payments today.</p>
            )}
          </section>

          <section className="dashboard-section dashboard-panel" aria-labelledby="team-heading">
            <div className="section-title">
              <h2 id="team-heading">Sales by person</h2>
              <span>{dashboard.sellers.length} active today</span>
            </div>
            {dashboard.sellers.length ? (
              <div className="seller-breakdown">
                {dashboard.sellers.map((seller) => (
                  <div key={seller.userId}>
                    <span>
                      <strong>{seller.name}</strong>
                      <small>
                        {seller.orderCount} orders · {seller.unitCount} units
                      </small>
                    </span>
                    <strong>{formatMoney(seller.revenuePaise)}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <p className="dashboard-empty">No completed sales today.</p>
            )}
          </section>
        </div>

        <section
          className="dashboard-section stock-risk-section"
          id="stock-risk"
          aria-labelledby="stock-heading"
        >
          <div className="section-title">
            <h2 id="stock-heading">Stock position</h2>
            <span>{dashboard.stock.activeSkuCount} active SKUs</span>
          </div>
          <div className="stock-position-grid">
            <article>
              <small>Sellable units</small>
              <strong>{dashboard.stock.sellableUnitCount}</strong>
            </article>
            <article className={dashboard.stock.outOfStockCount ? "risk" : ""}>
              <small>Out of stock</small>
              <strong>{dashboard.stock.outOfStockCount}</strong>
            </article>
            <article className={dashboard.stock.lowStockCount ? "watch" : ""}>
              <small>Reorder alerts</small>
              <strong>{dashboard.stock.lowStockCount}</strong>
            </article>
            <article>
              <small>Policies configured</small>
              <strong>{dashboard.stock.configuredReorderPolicyCount}</strong>
            </article>
          </div>
          <p className="threshold-note">
            Each alert uses that SKU’s owner-configured reorder point. The suggested
            order quantity refills stock to its target; no fallback threshold is applied.
          </p>
          {dashboard.lowStockProducts.length ? (
            <div className="low-stock-list">
              {dashboard.lowStockProducts.map((product) => (
                <Link
                  href={`/inventory?product=${product.variantId}`}
                  key={product.variantId}
                >
                  <span>
                    <strong>{product.productName}</strong>
                    <small>
                      {product.sku} · {product.rackLocation ?? "Rack missing"}
                    </small>
                    <small>
                      {product.reorderPolicyStatus === "CONFIGURED"
                        ? `${product.quantity} left · alert at ${product.reorderPoint} · target ${product.restockTarget}`
                        : `${product.quantity} left · reorder policy missing`}
                    </small>
                  </span>
                  <strong
                    className={
                      product.reorderPolicyStatus === "UNCONFIGURED"
                        ? "low"
                        : product.quantity === 0
                          ? "out"
                          : "low"
                    }
                  >
                    {product.reorderPolicyStatus === "CONFIGURED"
                      ? `Order ${product.suggestedReorderQuantity}`
                      : "Set policy"}
                  </strong>
                </Link>
              ))}
            </div>
          ) : (
            <p className="dashboard-empty">
              No SKU is out of stock or at its configured reorder point.
            </p>
          )}
          <div className="reorder-policy-setup">
            <div>
              <strong>Policies still to configure</strong>
              <span>
                {dashboard.stock.unconfiguredReorderPolicyCount} never configured ·{" "}
                {dashboard.stock.disabledReorderPolicyCount} deliberately disabled
              </span>
            </div>
            {dashboard.unconfiguredReorderProducts.length ? (
              <div className="low-stock-list">
                {dashboard.unconfiguredReorderProducts.map((product) => (
                  <Link
                    href={`/inventory?product=${product.variantId}`}
                    key={product.variantId}
                  >
                    <span>
                      <strong>{product.productName}</strong>
                      <small>
                        {product.sku} · {product.quantity} sellable ·{" "}
                        {product.rackLocation ?? "Rack missing"}
                      </small>
                    </span>
                    <strong className="low">Set policy</strong>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="dashboard-empty">
                Every active SKU has been configured or deliberately disabled.
              </p>
            )}
          </div>
        </section>

        <section
          className="dashboard-section data-quality-section"
          id="data-quality"
          aria-labelledby="quality-heading"
        >
          <div className="section-title">
            <h2 id="quality-heading">Stock and catalogue checks</h2>
            <span>{criticalDataIssues ? `${criticalDataIssues} exceptions` : "All passed"}</span>
          </div>
          <div className="quality-grid">
            <article className={dashboard.dataQuality.ledgerMismatchCount ? "failed" : "passed"}>
              <strong>{dashboard.dataQuality.ledgerMismatchCount}</strong>
              <span>Ledger mismatches</span>
            </article>
            <article className={dashboard.dataQuality.missingRackCount ? "failed" : "passed"}>
              <strong>{dashboard.dataQuality.missingRackCount}</strong>
              <span>Missing racks</span>
            </article>
            <article className={dashboard.dataQuality.missingBalanceCount ? "failed" : "passed"}>
              <strong>{dashboard.dataQuality.missingBalanceCount}</strong>
              <span>Missing balances</span>
            </article>
            <article className={dashboard.dataQuality.missingActivePriceCount ? "failed" : "passed"}>
              <strong>{dashboard.dataQuality.missingActivePriceCount}</strong>
              <span>Missing active prices</span>
            </article>
          </div>
          <Link className="dashboard-text-link" href="/inventory">
            Investigate through inventory history →
          </Link>
        </section>
      </section>
    </AppShell>
  );
}
