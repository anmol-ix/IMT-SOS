import type { CSSProperties } from "react";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import { requireCurrentUser } from "@/server/auth/current-user";
import { getBusinessInsights } from "@/server/business-insights";
import { percentageChange, percentageOf } from "@/shared/insights-math";

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export default async function SalesReportPage() {
  const user = await requireCurrentUser(["BUSINESS_OWNER"]);
  const insights = await getBusinessInsights(user);
  const maximum = Math.max(...insights.monthlyTrend.map((month) => month.revenuePaise), 1);
  const change = percentageChange(insights.month.revenuePaise, insights.previousComparableMonth.revenuePaise);

  return (
    <AppShell displayName={user.displayName} role="BUSINESS_OWNER">
      <section className="sell-page reports-page focused-page" aria-labelledby="sales-report-heading">
        <PageHeader
          eyebrow="Sales report"
          headingId="sales-report-heading"
          title="Sales performance"
          description="Revenue, orders, units and channel mix without operational clutter."
        />
        <section className="insight-scorecard" aria-label="Sales performance">
          <article className="insight-kpi primary"><small>Today</small><strong>{money.format(insights.today.revenuePaise / 100)}</strong><span>{insights.today.orderCount} orders · {insights.today.unitCount} units</span></article>
          <article className="insight-kpi"><small>This month</small><strong>{money.format(insights.month.revenuePaise / 100)}</strong><span>{insights.month.orderCount} orders · {insights.month.unitCount} units</span><em>{change === null ? "No comparable sales" : `${change >= 0 ? "↑" : "↓"} ${Math.abs(change)}% vs same days last month`}</em></article>
          <article className="insight-kpi"><small>Average order</small><strong>{money.format(insights.month.averageOrderPaise / 100)}</strong><span>Completed sales only</span></article>
          <article className="insight-kpi"><small>Gross margin</small><strong>{percentageOf(insights.month.accountingGrossProductProfitPaise, insights.month.revenuePaise)}%</strong><span>{money.format(insights.month.accountingGrossProductProfitPaise / 100)} product profit</span></article>
        </section>
        <div className="report-grid">
          <section className="insight-panel trend-panel">
            <div className="section-title"><div><h2>Six-month sales trend</h2><p>Completed revenue by month</p></div></div>
            <div className="sales-trend" role="img" aria-label="Monthly sales trend">
              {insights.monthlyTrend.map((month) => (
                <article key={month.monthKey}>
                  <div className="trend-amount">{money.format(month.revenuePaise / 100)}</div>
                  <div className="trend-track"><span className="trend-bar" style={{ "--trend-height": `${Math.max(3, Math.round(month.revenuePaise / maximum * 100))}%` } as CSSProperties} /></div>
                  <strong>{month.monthLabel}</strong><small>{month.orderCount} orders</small>
                </article>
              ))}
            </div>
          </section>
          <section className="insight-panel channel-panel">
            <div className="section-title"><div><h2>Retail vs Wholesale</h2><p>This month</p></div></div>
            <div className="channel-list">
              {(["RETAIL", "WHOLESALE"] as const).map((type) => {
                const channel = insights.channels.find((item) => item.saleType === type);
                return <article key={type}><div><strong>{type === "RETAIL" ? "Retail" : "Wholesale"}</strong><span>{channel?.orderCount ?? 0} orders · {channel?.unitCount ?? 0} units</span></div><strong>{money.format((channel?.revenuePaise ?? 0) / 100)}</strong></article>;
              })}
            </div>
          </section>
        </div>
      </section>
    </AppShell>
  );
}
