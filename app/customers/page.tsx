import type { Route } from "next";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import { requireCurrentUser } from "@/server/auth/current-user";
import { listCustomers, type CustomerSegment } from "@/server/customers";

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const segmentLabels: Record<CustomerSegment, string> = {
  RETAIL: "Retail",
  WHOLESALE: "Wholesale",
  MIXED: "Retail + Wholesale",
  NEW: "No sales yet",
};

const filters: Array<{ value: CustomerSegment | "ALL"; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "RETAIL", label: "Retail" },
  { value: "WHOLESALE", label: "Wholesale" },
  { value: "MIXED", label: "Both" },
  { value: "NEW", label: "No sales yet" },
];

function directoryHref(query: string, segment: CustomerSegment | "ALL") {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (segment !== "ALL") params.set("segment", segment);
  return `/customers${params.size ? `?${params}` : ""}` as Route;
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; segment?: string }>;
}) {
  const user = await requireCurrentUser();
  const params = await searchParams;
  const query = params.q?.trim().slice(0, 120) ?? "";
  const requestedSegment = params.segment?.toUpperCase();
  const segment: CustomerSegment | "ALL" = (
    requestedSegment === "RETAIL"
    || requestedSegment === "WHOLESALE"
    || requestedSegment === "MIXED"
    || requestedSegment === "NEW"
  ) ? requestedSegment : "ALL";
  const directory = await listCustomers(user, {
    query,
    segment: segment === "ALL" ? undefined : segment,
  });

  return (
    <AppShell displayName={user.displayName} role={user.role}>
      <section className="sell-page customers-page focused-page" aria-labelledby="customers-heading">
        <PageHeader
          eyebrow="Customer directory"
          headingId="customers-heading"
          title="Customers"
          description="Find Retail and Wholesale customers, then open a focused purchase profile."
          actions={<Link className="button" href="/sell/retail">Create sale</Link>}
        />

        <section className="customer-kpis" aria-label="Customer summary">
          <article><small>Customer records</small><strong>{directory.summary.totalCustomers}</strong></article>
          <article><small>Bought in 90 days</small><strong>{directory.summary.recentCustomers}</strong></article>
          <article><small>Wholesale buyers</small><strong>{directory.summary.wholesaleCustomers}</strong></article>
          <article><small>No recorded sale</small><strong>{directory.summary.customersWithoutSales}</strong></article>
        </section>

        <section className="customer-toolbar" aria-label="Find customers">
          <form action="/customers" method="get">
            {segment !== "ALL" && <input name="segment" type="hidden" value={segment} />}
            <label>
              <span>Search customer</span>
              <input defaultValue={query} name="q" placeholder="Name, phone or locality" type="search" />
            </label>
            <button className="button" type="submit">Search</button>
            {query && <Link className="customer-clear-search" href={directoryHref("", segment)}>Clear</Link>}
          </form>
          <nav className="customer-segments" aria-label="Customer type">
            {filters.map((filter) => (
              <Link
                className={segment === filter.value ? "active" : ""}
                href={directoryHref(query, filter.value)}
                key={filter.value}
              >
                {filter.label}
              </Link>
            ))}
          </nav>
        </section>

        <section className="customer-directory customer-directory--page" aria-labelledby="customer-list-heading">
          <div className="section-title">
            <div>
              <h2 id="customer-list-heading">Customer list</h2>
              <p>{directory.customers.length} {directory.customers.length === 1 ? "record" : "records"}</p>
            </div>
          </div>
          {directory.customers.length ? (
            <div className="customer-list">
              {directory.customers.map((customer) => (
                <Link href={`/customers/${customer.id}`} key={customer.id}>
                  <span className="customer-avatar" aria-hidden="true">{customer.name.charAt(0).toUpperCase()}</span>
                  <span className="customer-list-copy">
                    <strong>{customer.name}</strong>
                    <small>{customer.phone}{customer.locality ? ` · ${customer.locality}` : ""}</small>
                    <span className={`customer-segment ${customer.segment.toLowerCase()}`}>
                      {segmentLabels[customer.segment]}
                    </span>
                  </span>
                  <span className="customer-list-value">
                    <strong>{money.format(customer.totalSpendPaise / 100)}</strong>
                    <small>{customer.totalOrders} {customer.totalOrders === 1 ? "order" : "orders"}</small>
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="customer-empty">
              <h3>No customers found</h3>
              <p>Try another name, phone number, locality or customer type.</p>
            </div>
          )}
        </section>
      </section>
    </AppShell>
  );
}
