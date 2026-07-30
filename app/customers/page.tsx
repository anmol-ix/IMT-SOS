import type { Route } from "next";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import { requireCurrentUser } from "@/server/auth/current-user";
import {
  getCustomerProfile,
  listCustomers,
  type CustomerSegment,
} from "@/server/customers";

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const purchaseDate = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

const segmentLabels: Record<CustomerSegment, string> = {
  RETAIL: "Retail",
  WHOLESALE: "Wholesale",
  MIXED: "Retail + Wholesale",
  NEW: "No sales yet",
};

const filterOptions: Array<{ value: CustomerSegment | "ALL"; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "RETAIL", label: "Retail" },
  { value: "WHOLESALE", label: "Wholesale" },
  { value: "MIXED", label: "Both" },
  { value: "NEW", label: "No sales yet" },
];

function formatMoney(paise: number) {
  return money.format(paise / 100);
}

function formatPhone(phone: string) {
  return phone.length === 10
    ? `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`
    : `+${phone}`;
}

function phoneHref(phone: string) {
  return phone.length === 10 ? `tel:+91${phone}` : `tel:+${phone}`;
}

function paymentLabel(mode: string) {
  return mode === "BANK_TRANSFER"
    ? "Bank transfer"
    : mode.charAt(0) + mode.slice(1).toLowerCase();
}

function validCustomerId(value?: string) {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value)
    ? value
    : null;
}

function directoryHref({
  customer,
  query,
  segment,
}: {
  customer?: string;
  query?: string;
  segment?: CustomerSegment | "ALL";
}) {
  const parameters = new URLSearchParams();
  if (query) parameters.set("q", query);
  if (segment && segment !== "ALL") parameters.set("segment", segment);
  if (customer) parameters.set("customer", customer);
  const search = parameters.toString();
  return `/customers${search ? `?${search}` : ""}` as Route;
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; segment?: string; customer?: string }>;
}) {
  const user = await requireCurrentUser();
  const parameters = await searchParams;
  const query = parameters.q?.trim().slice(0, 120) ?? "";
  const requestedSegment = parameters.segment?.toUpperCase();
  const segment = (
    requestedSegment === "RETAIL"
    || requestedSegment === "WHOLESALE"
    || requestedSegment === "MIXED"
    || requestedSegment === "NEW"
  )
    ? requestedSegment
    : "ALL";
  const selectedId = validCustomerId(parameters.customer);
  const [directory, profile] = await Promise.all([
    listCustomers(user, {
      query,
      segment: segment === "ALL" ? undefined : segment,
    }),
    selectedId ? getCustomerProfile(user, selectedId) : Promise.resolve(null),
  ]);

  return (
    <AppShell displayName={user.displayName} role={user.role}>
      <section className="sell-page customers-page" aria-labelledby="customers-heading">
        <PageHeader
          eyebrow="Customer records"
          headingId="customers-heading"
          title="Customers"
          description="Find a customer, see what they bought and understand whether they buy Retail, Wholesale or both."
          actions={<Link className="secondary-button" href="/">Start a sale</Link>}
        />

        <section className="customer-kpis" aria-label="Customer summary">
          <article>
            <small>Customer records</small>
            <strong>{directory.summary.totalCustomers}</strong>
          </article>
          <article>
            <small>Bought in 90 days</small>
            <strong>{directory.summary.recentCustomers}</strong>
          </article>
          <article>
            <small>Wholesale buyers</small>
            <strong>{directory.summary.wholesaleCustomers}</strong>
          </article>
          <article>
            <small>No recorded sale</small>
            <strong>{directory.summary.customersWithoutSales}</strong>
          </article>
        </section>

        <section className="customer-toolbar" aria-label="Find customers">
          <form action="/customers" method="get">
            {segment !== "ALL" && <input name="segment" type="hidden" value={segment} />}
            <label>
              <span>Search customer</span>
              <input
                defaultValue={query}
                name="q"
                placeholder="Name, phone or locality"
                type="search"
              />
            </label>
            <button className="button" type="submit">Search</button>
            {query && (
              <Link
                className="customer-clear-search"
                href={directoryHref({ segment })}
              >
                Clear
              </Link>
            )}
          </form>
          <nav className="customer-segments" aria-label="Customer type">
            {filterOptions.map((option) => (
              <Link
                className={segment === option.value ? "active" : ""}
                href={directoryHref({
                  query,
                  segment: option.value,
                })}
                key={option.value}
              >
                {option.label}
              </Link>
            ))}
          </nav>
        </section>

        <div className={`customer-workspace ${profile ? "has-selection" : ""}`}>
          <section className="customer-directory" aria-labelledby="customer-list-heading">
            <div className="section-title">
              <div>
                <h2 id="customer-list-heading">Customer list</h2>
                <p>
                  {directory.customers.length}
                  {directory.customers.length === 1 ? " record" : " records"}
                  {query ? ` matching “${query}”` : ""}
                </p>
              </div>
            </div>
            {directory.customers.length ? (
              <div className="customer-list">
                {directory.customers.map((customer) => (
                  <Link
                    className={profile?.id === customer.id ? "selected" : ""}
                    href={directoryHref({
                      customer: customer.id,
                      query,
                      segment,
                    })}
                    key={customer.id}
                  >
                    <span className="customer-avatar" aria-hidden="true">
                      {customer.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="customer-list-copy">
                      <strong>{customer.name}</strong>
                      <small>
                        {formatPhone(customer.phone)}
                        {customer.locality ? ` · ${customer.locality}` : ""}
                      </small>
                      <span className={`customer-segment ${customer.segment.toLowerCase()}`}>
                        {segmentLabels[customer.segment]}
                      </span>
                    </span>
                    <span className="customer-list-value">
                      <strong>{formatMoney(customer.totalSpendPaise)}</strong>
                      <small>
                        {customer.totalOrders} {customer.totalOrders === 1 ? "order" : "orders"}
                      </small>
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

          {profile ? (
            <section className="customer-profile" aria-labelledby="customer-profile-heading">
              <div className="customer-profile-heading">
                <div>
                  <Link
                    className="customer-back"
                    href={directoryHref({ query, segment })}
                  >
                    ← Customer list
                  </Link>
                  <p className="eyebrow">Customer profile</p>
                  <h2 id="customer-profile-heading">{profile.name}</h2>
                  <span className={`customer-segment ${profile.segment.toLowerCase()}`}>
                    {segmentLabels[profile.segment]}
                  </span>
                </div>
                <div className="customer-contact">
                  <a href={phoneHref(profile.phone)}>{formatPhone(profile.phone)}</a>
                  {profile.email && <a href={`mailto:${profile.email}`}>{profile.email}</a>}
                  {profile.locality && <span>{profile.locality}</span>}
                </div>
              </div>

              <section className="customer-profile-kpis" aria-label="Customer purchase totals">
                <article>
                  <small>Total purchases</small>
                  <strong>{formatMoney(profile.totalSpendPaise)}</strong>
                </article>
                <article>
                  <small>Orders</small>
                  <strong>{profile.totalOrders}</strong>
                </article>
                <article>
                  <small>Units bought</small>
                  <strong>{profile.totalUnits}</strong>
                </article>
                <article>
                  <small>Average order</small>
                  <strong>{formatMoney(profile.averageOrderPaise)}</strong>
                </article>
              </section>

              {profile.totalOrders > 0 && (
                <section className="customer-channel-summary" aria-labelledby="customer-channel-heading">
                  <div className="section-title">
                    <div>
                      <h3 id="customer-channel-heading">How they buy</h3>
                      <p>Completed purchases by sale type</p>
                    </div>
                    {profile.lastPurchaseAt && (
                      <span>Last bought {purchaseDate.format(new Date(profile.lastPurchaseAt))}</span>
                    )}
                  </div>
                  <div>
                    <article>
                      <span><strong>Retail</strong><small>{profile.retailOrders} orders</small></span>
                      <strong>{formatMoney(profile.retailSpendPaise)}</strong>
                    </article>
                    <article>
                      <span><strong>Wholesale</strong><small>{profile.wholesaleOrders} orders</small></span>
                      <strong>{formatMoney(profile.wholesaleSpendPaise)}</strong>
                    </article>
                  </div>
                </section>
              )}

              <section className="customer-purchase-history" aria-labelledby="purchase-history-heading">
                <div className="section-title">
                  <div>
                    <h3 id="purchase-history-heading">Purchase history</h3>
                    <p>Latest completed sales for this customer</p>
                  </div>
                </div>
                {profile.purchases.length ? (
                  <div className="customer-purchases">
                    {profile.purchases.map((purchase) => (
                      <article key={purchase.id}>
                        <div className="customer-purchase-heading">
                          <span>
                            <strong>{purchase.saleNumber}</strong>
                            <small>{purchaseDate.format(new Date(purchase.completedAt))}</small>
                          </span>
                          <span>
                            <strong>{formatMoney(purchase.totalPaise)}</strong>
                            <small>{purchase.saleType === "WHOLESALE" ? "Wholesale" : "Retail"}</small>
                          </span>
                        </div>
                        <div className="customer-purchase-products">
                          {purchase.products.slice(0, 3).map((product) => (
                            <span key={`${purchase.id}-${product.sku}`}>
                              {product.name} × {product.quantity}
                            </span>
                          ))}
                          {purchase.products.length > 3 && (
                            <span>+{purchase.products.length - 3} more products</span>
                          )}
                        </div>
                        <footer>
                          <span>
                            {purchase.unitCount} {purchase.unitCount === 1 ? "unit" : "units"}
                            {" · "}
                            {purchase.paymentModes.map(paymentLabel).join(" + ")}
                          </span>
                          <span>Sold by {purchase.soldBy}</span>
                        </footer>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="customer-empty compact">
                    <h3>No purchase history yet</h3>
                    <p>This profile is ready to select during the customer’s first sale.</p>
                  </div>
                )}
              </section>
            </section>
          ) : (
            <section className="customer-profile customer-profile-empty">
              <div>
                <span className="customer-empty-icon" aria-hidden="true">⌁</span>
                <h2>Select a customer</h2>
                <p>Their contact details, Retail/Wholesale pattern and purchase history will appear here.</p>
              </div>
            </section>
          )}
        </div>
      </section>
    </AppShell>
  );
}
