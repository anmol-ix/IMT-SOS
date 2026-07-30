import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import { requireCurrentUser } from "@/server/auth/current-user";
import { getCustomerProfile, type CustomerSegment } from "@/server/customers";

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
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

function paymentLabel(mode: string) {
  return mode === "BANK_TRANSFER" ? "Bank transfer" : mode === "UPI" ? "UPI" : mode.toLowerCase();
}

export default async function CustomerProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireCurrentUser();
  const parsed = z.string().uuid().safeParse((await params).id);
  if (!parsed.success) notFound();
  const profile = await getCustomerProfile(user, parsed.data);
  if (!profile) notFound();

  return (
    <AppShell displayName={user.displayName} role={user.role}>
      <section className="sell-page customer-profile-page focused-page" aria-labelledby="customer-profile-heading">
        <PageHeader
          eyebrow="Customer profile"
          headingId="customer-profile-heading"
          title={profile.name}
          description={`${profile.phone}${profile.locality ? ` · ${profile.locality}` : ""}`}
          actions={
            <div className="page-action-row">
              <Link className="secondary-button" href="/customers">Back to customers</Link>
              <Link className="button" href={profile.segment === "WHOLESALE" ? "/sell/wholesale" : "/sell/retail"}>
                Create sale
              </Link>
            </div>
          }
        />

        <section className="customer-profile-kpis" aria-label="Customer purchase totals">
          <article><small>Total purchases</small><strong>{money.format(profile.totalSpendPaise / 100)}</strong></article>
          <article><small>Orders</small><strong>{profile.totalOrders}</strong></article>
          <article><small>Units bought</small><strong>{profile.totalUnits}</strong></article>
          <article><small>Average order</small><strong>{money.format(profile.averageOrderPaise / 100)}</strong></article>
        </section>

        <div className="customer-profile-grid">
          <section className="customer-profile-panel">
            <div className="section-title">
              <div><h2>Customer details</h2><p>Saved contact and buying type</p></div>
              <span className={`customer-segment ${profile.segment.toLowerCase()}`}>{segmentLabels[profile.segment]}</span>
            </div>
            <dl className="record-details">
              <div><dt>Phone</dt><dd><a href={`tel:${profile.phone}`}>{profile.phone}</a></dd></div>
              <div><dt>Email</dt><dd>{profile.email ? <a href={`mailto:${profile.email}`}>{profile.email}</a> : "Not saved"}</dd></div>
              <div><dt>Locality</dt><dd>{profile.locality ?? "Not saved"}</dd></div>
              <div><dt>Retail purchases</dt><dd>{profile.retailOrders} orders · {money.format(profile.retailSpendPaise / 100)}</dd></div>
              <div><dt>Wholesale purchases</dt><dd>{profile.wholesaleOrders} orders · {money.format(profile.wholesaleSpendPaise / 100)}</dd></div>
            </dl>
          </section>

          <section className="customer-purchase-history customer-profile-panel" aria-labelledby="purchase-history-heading">
            <div className="section-title">
              <div><h2 id="purchase-history-heading">Purchase history</h2><p>Newest completed sales first</p></div>
            </div>
            {profile.purchases.length ? (
              <div className="customer-purchases">
                {profile.purchases.map((purchase) => (
                  <article key={purchase.id}>
                    <div className="customer-purchase-heading">
                      <span><strong>{purchase.saleNumber}</strong><small>{purchaseDate.format(new Date(purchase.completedAt))}</small></span>
                      <span><strong>{money.format(purchase.totalPaise / 100)}</strong><small>{purchase.saleType === "WHOLESALE" ? "Wholesale" : "Retail"}</small></span>
                    </div>
                    <div className="customer-purchase-products">
                      {purchase.products.map((product) => <span key={`${purchase.id}-${product.sku}`}>{product.name} × {product.quantity}</span>)}
                    </div>
                    <footer>
                      <span>{purchase.unitCount} units · {purchase.paymentModes.map(paymentLabel).join(" + ")}</span>
                      <span>Sold by {purchase.soldBy}</span>
                    </footer>
                  </article>
                ))}
              </div>
            ) : <div className="customer-empty compact"><h3>No purchase history yet</h3><p>This profile is ready for its first sale.</p></div>}
          </section>
        </div>
      </section>
    </AppShell>
  );
}
