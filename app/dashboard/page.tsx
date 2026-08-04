import Link from "next/link";
import type { Route } from "next";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import { requireCurrentUser } from "@/server/auth/current-user";
import { getDailyClosingView } from "@/server/daily-closing";
import { getOwnerDashboard } from "@/server/owner-dashboard";

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const updatedAt = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

export default async function DashboardPage() {
  const user = await requireCurrentUser(["BUSINESS_OWNER"]);
  const [dashboard, closing] = await Promise.all([
    getOwnerDashboard(user),
    getDailyClosingView(user),
  ]);
  const approvals =
    dashboard.actions.offlineSaleConflicts
    + dashboard.actions.priceApprovals
    + dashboard.actions.guestApprovals
    + dashboard.actions.stockAdjustments;
  const stockRisks = dashboard.stock.outOfStockCount + dashboard.stock.lowStockCount;
  const dataIssues =
    dashboard.dataQuality.ledgerMismatchCount
    + dashboard.dataQuality.missingRackCount
    + dashboard.dataQuality.missingBalanceCount
    + dashboard.dataQuality.missingActivePriceCount;

  const actions: Array<{
    href: Route;
    label: string;
    detail: string;
    value: number | string;
    attention: boolean;
  }> = [
    {
      href: "/operations/approvals",
      label: "Owner decisions",
      detail: "Price, stock, Guest and offline sale requests",
      value: approvals,
      attention: approvals > 0,
    },
    {
      href: "/inventory/receive",
      label: "Stock receipts",
      detail: "Draft receipts waiting to be completed",
      value: dashboard.actions.receiptDrafts,
      attention: dashboard.actions.receiptDrafts > 0,
    },
    {
      href: "/inventory",
      label: "Stock risks",
      detail: `${dashboard.stock.outOfStockCount} out · ${dashboard.stock.lowStockCount} low`,
      value: stockRisks,
      attention: stockRisks > 0,
    },
    {
      href: "/operations/closing",
      label: "Daily closing",
      detail: closing.status === "CLOSED" ? "Today is closed" : "Cash and payments need review",
      value: closing.status === "CLOSED" ? "Done" : "Open",
      attention: closing.status !== "CLOSED",
    },
  ];

  return (
    <AppShell displayName={user.displayName} role="BUSINESS_OWNER">
      <section className="sell-page dashboard-page dashboard-page--focused" aria-labelledby="dashboard-heading">
        <PageHeader
          eyebrow={`Today · ${dashboard.businessDate}`}
          headingId="dashboard-heading"
          title="Good to see you"
          description="What happened today and what needs your attention next."
          actions={<div className="dashboard-updated"><span>Updated</span><strong>{updatedAt.format(new Date(dashboard.asOf))}</strong><Link href="/dashboard">Refresh</Link></div>}
        />

        <section className="dashboard-metrics dashboard-metrics--compact" aria-label="Today at a glance">
          <article className="metric-card primary"><small>Revenue today</small><strong>{money.format(dashboard.today.revenuePaise / 100)}</strong><span>{dashboard.today.orderCount} completed orders</span></article>
          <article className="metric-card"><small>Units sold</small><strong>{dashboard.today.unitCount}</strong><span>Completed sales only</span></article>
          <article className="metric-card internal"><small>Product profit</small><strong>{money.format(dashboard.today.accountingGrossProductProfitPaise / 100)}</strong><span>Revenue minus accounting cost</span></article>
          <article className={dataIssues ? "metric-card risk" : "metric-card"}><small>Data checks</small><strong>{dataIssues || "Clear"}</strong><span>{dataIssues ? "exceptions need review" : "No critical exceptions"}</span></article>
        </section>

        <div className="home-grid">
          <section className="dashboard-section dashboard-panel" aria-labelledby="next-heading">
            <div className="section-title"><div><h2 id="next-heading">Needs attention</h2><p>Open the work area that owns the issue</p></div></div>
            <div className="home-action-list">
              {actions.map((action) => (
                <Link className={action.attention ? "home-action home-action--attention" : "home-action"} href={action.href} key={action.href}>
                  <span><strong>{action.label}</strong><small>{action.detail}</small></span>
                  <b>{action.value}</b>
                </Link>
              ))}
            </div>
          </section>

          <section className="dashboard-section dashboard-panel" aria-labelledby="shortcuts-heading">
            <div className="section-title"><div><h2 id="shortcuts-heading">Quick actions</h2><p>Common work, one click away</p></div></div>
            <div className="quick-action-grid">
              <Link href="/sell/retail"><strong>Retail sale</strong><small>Walk-in customer</small></Link>
              <Link href="/sell/wholesale"><strong>Wholesale sale</strong><small>Shopkeeper order</small></Link>
              <Link href="/inventory/receive"><strong>Receive stock</strong><small>Add supplier stock</small></Link>
              <Link href="/inventory"><strong>Find product</strong><small>Stock and history</small></Link>
            </div>
          </section>
        </div>
      </section>
    </AppShell>
  );
}
