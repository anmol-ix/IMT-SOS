import type { CSSProperties } from "react";
import Link from "next/link";
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
const reportDate = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

function formatMoney(paise: number) {
  return money.format(paise / 100);
}

function Change({
  value,
  unavailable = "No comparable sales",
}: {
  value: number | null;
  unavailable?: string;
}) {
  if (value === null) return <span className="insight-change neutral">{unavailable}</span>;
  return (
    <span className={`insight-change ${value >= 0 ? "up" : "down"}`}>
      {value >= 0 ? "↑" : "↓"} {Math.abs(value)}% vs same days last month
    </span>
  );
}

export default async function InsightsPage() {
  const user = await requireCurrentUser(["BUSINESS_OWNER"]);
  const insights = await getBusinessInsights(user);
  const revenueChange = percentageChange(
    insights.month.revenuePaise,
    insights.previousComparableMonth.revenuePaise,
  );
  const profitChange = percentageChange(
    insights.month.accountingGrossProductProfitPaise,
    insights.previousComparableMonth.accountingGrossProductProfitPaise,
  );
  const grossMargin = percentageOf(
    insights.month.accountingGrossProductProfitPaise,
    insights.month.revenuePaise,
  );
  const replacementMargin = percentageOf(
    insights.month.replacementMarginPaise,
    insights.month.revenuePaise,
  );
  const yearChange = insights.year.comparisonAvailable
    ? percentageChange(
        insights.year.revenuePaise,
        insights.year.previousComparableRevenuePaise,
      )
    : null;
  const trendMaximum = Math.max(
    ...insights.monthlyTrend.map((month) => month.revenuePaise),
    1,
  );
  const channels = (["RETAIL", "WHOLESALE"] as const).map((saleType) =>
    insights.channels.find((channel) => channel.saleType === saleType) ?? {
      saleType,
      revenuePaise: 0,
      orderCount: 0,
      unitCount: 0,
    });

  return (
    <AppShell displayName={user.displayName} role="BUSINESS_OWNER">
      <section className="sell-page insights-page" aria-labelledby="insights-heading">
        <PageHeader
          eyebrow="Management view"
          headingId="insights-heading"
          title="Reports overview"
          description="Sales, margin and stock signals that need an owner’s attention."
          actions={
            <div className="dashboard-updated">
              <span>Updated</span>
              <strong>{reportDate.format(new Date(insights.asOf))}</strong>
              <Link href="/reports">Refresh</Link>
            </div>
          }
        />

        <section className="insight-scorecard" aria-label="Current performance">
          <article className="insight-kpi primary">
            <small>Today</small>
            <strong>{formatMoney(insights.today.revenuePaise)}</strong>
            <span>
              {insights.today.orderCount} orders · {insights.today.unitCount} units
            </span>
            {!insights.today.orderCount && insights.lastSaleAt && (
              <em>Last sale {reportDate.format(new Date(insights.lastSaleAt))}</em>
            )}
          </article>
          <article className="insight-kpi">
            <small>This month</small>
            <strong>{formatMoney(insights.month.revenuePaise)}</strong>
            <span>
              {insights.month.orderCount} orders · {insights.month.unitCount} units
            </span>
            <Change value={revenueChange} />
          </article>
          <article className="insight-kpi">
            <small>Gross product profit</small>
            <strong>{formatMoney(insights.month.accountingGrossProductProfitPaise)}</strong>
            <span>{grossMargin}% of this month’s sales</span>
            <Change value={profitChange} />
          </article>
          <article className="insight-kpi">
            <small>Average order</small>
            <strong>{formatMoney(insights.month.averageOrderPaise)}</strong>
            <span>Replacement margin {replacementMargin}%</span>
            <em>
              YTD {formatMoney(insights.year.revenuePaise)} ·{" "}
              {yearChange === null ? "YoY starts after 12 months" : `${yearChange}% YoY`}
            </em>
          </article>
        </section>

        <div className="insights-layout">
          <section className="insight-panel trend-panel" aria-labelledby="trend-heading">
            <div className="section-title">
              <div>
                <h2 id="trend-heading">Six-month sales trend</h2>
                <p>Revenue by completed sale month</p>
              </div>
              <span>India shop time</span>
            </div>
            <div className="sales-trend" role="img" aria-label="Monthly revenue for the last six months">
              {insights.monthlyTrend.map((month) => (
                <article key={month.monthKey}>
                  <div className="trend-amount">{formatMoney(month.revenuePaise)}</div>
                  <div className="trend-track">
                    <span
                      className="trend-bar"
                      style={{
                        "--trend-height": `${Math.max(
                          3,
                          Math.round((month.revenuePaise / trendMaximum) * 100),
                        )}%`,
                      } as CSSProperties}
                    />
                  </div>
                  <strong>{month.monthLabel}</strong>
                  <small>{month.orderCount} orders</small>
                </article>
              ))}
            </div>
          </section>

          <section className="insight-panel channel-panel" aria-labelledby="channel-heading">
            <div className="section-title">
              <div>
                <h2 id="channel-heading">Retail vs Wholesale</h2>
                <p>This month</p>
              </div>
            </div>
            <div className="channel-list">
              {channels.map((channel) => {
                const share = percentageOf(
                  channel.revenuePaise,
                  insights.month.revenuePaise,
                );
                return (
                  <article key={channel.saleType}>
                    <div>
                      <strong>{channel.saleType === "RETAIL" ? "Retail" : "Wholesale"}</strong>
                      <span>{channel.orderCount} orders · {channel.unitCount} units</span>
                    </div>
                    <strong>{formatMoney(channel.revenuePaise)}</strong>
                    <div className="channel-share" aria-label={`${share}% of revenue`}>
                      <span style={{ width: `${share}%` }} />
                    </div>
                    <small>{share}% of revenue</small>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="insight-panel" aria-labelledby="products-heading">
            <div className="section-title">
              <div>
                <h2 id="products-heading">Best sellers</h2>
                <p>Highest revenue this month</p>
              </div>
            </div>
            {insights.topProducts.length ? (
              <div className="insight-ranking">
                {insights.topProducts.map((product, index) => (
                  <Link href={`/inventory/${product.variantId}`} key={product.variantId}>
                    <span className="rank">{index + 1}</span>
                    <span>
                      <strong>{product.productName}</strong>
                      <small>{product.sku} · {product.unitCount} units</small>
                    </span>
                    <span className="ranking-money">
                      <strong>{formatMoney(product.revenuePaise)}</strong>
                      <small>
                        {formatMoney(product.accountingGrossProductProfitPaise)} profit
                      </small>
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="dashboard-empty">No completed sales this month.</p>
            )}
          </section>

          <section className="insight-panel" aria-labelledby="stock-review-heading">
            <div className="section-title">
              <div>
                <h2 id="stock-review-heading">Stock to review</h2>
                <p>On hand with no sale in 60 days</p>
              </div>
              <span>{insights.stock.reviewSkuCount} SKUs</span>
            </div>
            <div className="stock-insight-summary">
              <span>
                <small>Total stock cost</small>
                <strong>{formatMoney(insights.stock.stockValuePaise)}</strong>
              </span>
              <span>
                <small>Review value</small>
                <strong>{formatMoney(insights.stock.reviewValuePaise)}</strong>
              </span>
            </div>
            {insights.stockToReview.length ? (
              <div className="insight-ranking compact">
                {insights.stockToReview.map((product) => (
                  <Link href={`/inventory/${product.variantId}`} key={product.variantId}>
                    <span>
                      <strong>{product.productName}</strong>
                      <small>{product.sku} · {product.quantity} units</small>
                    </span>
                    <span className="ranking-money">
                      <strong>{formatMoney(product.stockValuePaise)}</strong>
                      <small>
                        {product.lastSoldAt
                          ? `Last sold ${reportDate.format(new Date(product.lastSoldAt))}`
                          : "No recorded sale"}
                      </small>
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="dashboard-empty">No stock currently meets this review rule.</p>
            )}
          </section>
        </div>
      </section>
    </AppShell>
  );
}
