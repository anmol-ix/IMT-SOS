import Link from "next/link";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import { requireCurrentUser } from "@/server/auth/current-user";
import { getBusinessInsights } from "@/server/business-insights";

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export default async function InventoryReportPage() {
  const user = await requireCurrentUser(["BUSINESS_OWNER"]);
  const insights = await getBusinessInsights(user);
  return (
    <AppShell displayName={user.displayName} role="BUSINESS_OWNER">
      <section className="sell-page reports-page focused-page" aria-labelledby="inventory-report-heading">
        <PageHeader
          eyebrow="Inventory report"
          headingId="inventory-report-heading"
          title="Stock health"
          description="Current stock value and products that have not sold recently."
          actions={<Link className="secondary-button" href="/inventory">Open products</Link>}
        />
        <section className="insight-scorecard" aria-label="Stock summary">
          <article className="insight-kpi primary"><small>Stock cost value</small><strong>{money.format(insights.stock.stockValuePaise / 100)}</strong><span>Current accounting value</span></article>
          <article className="insight-kpi"><small>Active SKUs</small><strong>{insights.stock.activeSkuCount}</strong><span>Products available to operate</span></article>
          <article className="insight-kpi"><small>Sellable units</small><strong>{insights.stock.sellableUnitCount}</strong><span>Across active SKUs</span></article>
          <article className="insight-kpi"><small>Needs review</small><strong>{insights.stock.reviewSkuCount}</strong><span>{money.format(insights.stock.reviewValuePaise / 100)} with no sale in 60 days</span></article>
        </section>
        <section className="insight-panel">
          <div className="section-title"><div><h2>Slow-moving stock</h2><p>On hand with no recorded sale in 60 days</p></div></div>
          {insights.stockToReview.length ? (
            <div className="insight-ranking">
              {insights.stockToReview.map((product) => (
                <Link href={`/inventory/${product.variantId}`} key={product.variantId}>
                  <span><strong>{product.productName}</strong><small>{product.sku} · {product.quantity} units</small></span>
                  <span className="ranking-money"><strong>{money.format(product.stockValuePaise / 100)}</strong><small>{product.lastSoldAt ? "Previously sold" : "No recorded sale"}</small></span>
                </Link>
              ))}
            </div>
          ) : <p className="dashboard-empty">No stock currently meets this review rule.</p>}
        </section>
      </section>
    </AppShell>
  );
}
