import Link from "next/link";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import { requireCurrentUser } from "@/server/auth/current-user";
import { listCustomers } from "@/server/customers";

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export default async function CustomerReportPage() {
  const user = await requireCurrentUser(["BUSINESS_OWNER"]);
  const directory = await listCustomers(user);
  const ranked = [...directory.customers]
    .filter((customer) => customer.totalOrders > 0)
    .sort((a, b) => b.totalSpendPaise - a.totalSpendPaise)
    .slice(0, 12);

  return (
    <AppShell displayName={user.displayName} role="BUSINESS_OWNER">
      <section className="sell-page reports-page focused-page" aria-labelledby="customer-report-heading">
        <PageHeader
          eyebrow="Customer report"
          headingId="customer-report-heading"
          title="Customer health"
          description="Useful customer activity signals and highest recorded spend."
          actions={<Link className="secondary-button" href="/customers">Open directory</Link>}
        />
        <section className="insight-scorecard" aria-label="Customer summary">
          <article className="insight-kpi primary"><small>Customer records</small><strong>{directory.summary.totalCustomers}</strong><span>Retail and Wholesale</span></article>
          <article className="insight-kpi"><small>Bought in 90 days</small><strong>{directory.summary.recentCustomers}</strong><span>Recently active customers</span></article>
          <article className="insight-kpi"><small>Wholesale buyers</small><strong>{directory.summary.wholesaleCustomers}</strong><span>Wholesale or mixed history</span></article>
          <article className="insight-kpi"><small>No recorded sale</small><strong>{directory.summary.customersWithoutSales}</strong><span>Profiles not yet converted</span></article>
        </section>
        <section className="insight-panel">
          <div className="section-title"><div><h2>Highest recorded spend</h2><p>Completed sales across each customer profile</p></div></div>
          {ranked.length ? <div className="insight-ranking">{ranked.map((customer, index) => (
            <Link href={`/customers/${customer.id}`} key={customer.id}>
              <span className="rank">{index + 1}</span>
              <span><strong>{customer.name}</strong><small>{customer.segment === "MIXED" ? "Retail + Wholesale" : customer.segment.toLowerCase()} · {customer.totalOrders} orders</small></span>
              <span className="ranking-money"><strong>{money.format(customer.totalSpendPaise / 100)}</strong></span>
            </Link>
          ))}</div> : <p className="dashboard-empty">No customer-linked sales yet.</p>}
        </section>
      </section>
    </AppShell>
  );
}
