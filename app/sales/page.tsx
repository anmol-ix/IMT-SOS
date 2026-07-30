import Link from "next/link";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import { listActivity } from "@/server/activity";
import { requireCurrentUser } from "@/server/auth/current-user";

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});
const saleDate = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

export default async function SalesHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requireCurrentUser();
  const sales = await listActivity(user, "SALES");
  const page = Math.max(1, Math.min(10, Number.parseInt((await searchParams).page ?? "1", 10) || 1));
  const pageSize = 12;
  const pageCount = Math.max(1, Math.ceil(sales.length / pageSize));
  const visibleSales = sales.slice((page - 1) * pageSize, page * pageSize);

  return (
    <AppShell displayName={user.displayName} role={user.role}>
      <section className="sell-page activity-page focused-page" aria-labelledby="sales-heading">
        <PageHeader
          eyebrow="Completed sales"
          headingId="sales-heading"
          title="Sales history"
          description="Review completed Retail and Wholesale sales. Newest sales appear first."
          actions={<Link className="button" href="/sell/retail">Create sale</Link>}
        />
        {visibleSales.length ? (
          <section className="activity-list compact-list" aria-label="Completed sales">
            {visibleSales.map((sale) => sale.kind === "SALE" && (
              <article className="activity-card sale-activity" key={sale.id}>
                <div className="activity-card-heading">
                  <div>
                    <p className="eyebrow">Completed sale</p>
                    <h2>{sale.saleNumber}</h2>
                  </div>
                  <strong className="activity-amount">
                    {money.format(sale.totalPaise / 100)}
                  </strong>
                </div>
                <p className="activity-time">
                  {saleDate.format(new Date(sale.happenedAt))}
                </p>
                <div className="activity-facts">
                  <span><strong>{sale.unitCount}</strong> units across {sale.itemCount} products</span>
                  <span>{sale.paymentModes.join(" + ")}</span>
                  <span>{sale.customerName}</span>
                </div>
                <p className="activity-actor">Sold by <strong>{sale.actorName}</strong></p>
              </article>
            ))}
          </section>
        ) : (
          <section className="results-panel empty-approvals">
            <h2>No completed sales yet</h2>
            <p>Your first completed sale will appear here automatically.</p>
          </section>
        )}
        {pageCount > 1 && (
          <nav className="pagination" aria-label="Sales history pages">
            <Link className={page === 1 ? "disabled" : ""} aria-disabled={page === 1} href={page > 2 ? `/sales?page=${page - 1}` : "/sales"}>Previous</Link>
            <span>Page {page} of {pageCount}</span>
            <Link className={page === pageCount ? "disabled" : ""} aria-disabled={page === pageCount} href={`/sales?page=${Math.min(pageCount, page + 1)}`}>Next</Link>
          </nav>
        )}
      </section>
    </AppShell>
  );
}
