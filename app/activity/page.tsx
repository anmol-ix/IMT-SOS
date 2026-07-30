import Link from "next/link";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import { requireCurrentUser } from "@/server/auth/current-user";
import {
  listActivity,
  type ActivityFilter,
  type ActivityItem,
} from "@/server/activity";

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const activityDate = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

function formatMoney(paise: number) {
  return money.format(paise / 100);
}

function paymentLabel(mode: string) {
  if (mode === "UPI") return "UPI";
  return mode === "BANK_TRANSFER"
    ? "Bank transfer"
    : mode.charAt(0) + mode.slice(1).toLowerCase();
}

function statusLabel(status: string) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function reasonLabel(reason: string) {
  return reason
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

function ActivityCard({ item }: { item: ActivityItem }) {
  if (item.kind === "SALE") {
    return (
      <article className="activity-card sale-activity">
        <div className="activity-card-heading">
          <div>
            <p className="eyebrow">Completed sale</p>
            <h2>{item.saleNumber}</h2>
          </div>
          <strong className="activity-amount">{formatMoney(item.totalPaise)}</strong>
        </div>
        <p className="activity-time">{activityDate.format(new Date(item.happenedAt))}</p>
        <div className="activity-facts">
          <span><strong>{item.unitCount}</strong> units across {item.itemCount} products</span>
          <span>{item.paymentModes.map(paymentLabel).join(" + ")}</span>
          <span>{item.customerName}</span>
        </div>
        <p className="activity-actor">Sold by <strong>{item.actorName}</strong></p>
      </article>
    );
  }

  if (item.kind === "PRICE_APPROVAL") {
    return (
      <article className="activity-card">
        <div className="activity-card-heading">
          <div>
            <p className="eyebrow">Lower-price request</p>
            <h2>{item.productName}</h2>
            <p>{item.sku}</p>
          </div>
          <span className={`activity-status ${item.status.toLowerCase()}`}>
            {statusLabel(item.status)}
          </span>
        </div>
        <p className="activity-time">{activityDate.format(new Date(item.happenedAt))}</p>
        <div className="approval-price-summary">
          <span>
            Requested
            <strong>{item.quantity} × {formatMoney(item.requestedUnitPricePaise)}</strong>
          </span>
          <span>
            Standard
            <strong>{formatMoney(item.standardPricePaise)}</strong>
          </span>
        </div>
        <p className="activity-actor">
          Requested by <strong>{item.actorName}</strong>
          {item.approverName && <> · decided by <strong>{item.approverName}</strong></>}
        </p>
        {item.reason && <p className="activity-note">Reason: {reasonLabel(item.reason)}</p>}
        {item.note && <p className="activity-note">Note: {item.note}</p>}
      </article>
    );
  }

  return (
    <article className="activity-card">
      <div className="activity-card-heading">
        <div>
          <p className="eyebrow">Customer-declined Guest request</p>
          <h2>{item.productCount} products</h2>
        </div>
        <span className={`activity-status ${item.status.toLowerCase()}`}>
          {statusLabel(item.status)}
        </span>
      </div>
      <p className="activity-time">{activityDate.format(new Date(item.happenedAt))}</p>
      <strong className="guest-activity-total">{formatMoney(item.totalPaise)}</strong>
      <p className="activity-actor">
        Requested by <strong>{item.actorName}</strong>
        {item.approverName && <> · decided by <strong>{item.approverName}</strong></>}
      </p>
      {item.note && <p className="activity-note">Note: {item.note}</p>}
    </article>
  );
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const user = await requireCurrentUser();
  const requestedType = (await searchParams).type?.toUpperCase();
  const filter: ActivityFilter =
    requestedType === "SALES" || requestedType === "APPROVALS"
      ? requestedType
      : "ALL";
  const items = await listActivity(user, filter);
  return (
    <AppShell displayName={user.displayName} role={user.role}>
      <section className="sell-page activity-page" aria-labelledby="activity-heading">
        <PageHeader
          eyebrow="Operational history"
          headingId="activity-heading"
          title="Activity"
          description={
            user.role === "BUSINESS_OWNER"
              ? "Recent sales and approval decisions across the business."
              : "Your recent sales and approval requests."
          }
        />

        <div className="activity-toolbar">
          <nav className="activity-filters" aria-label="Activity type">
            <Link className={filter === "ALL" ? "active" : ""} href="/activity">All</Link>
            <Link className={filter === "SALES" ? "active" : ""} href="/activity?type=sales">Sales</Link>
            <Link
              className={filter === "APPROVALS" ? "active" : ""}
              href="/activity?type=approvals"
            >
              Approvals
            </Link>
          </nav>
          <Link
            className="activity-refresh"
            href={filter === "ALL" ? "/activity" : `/activity?type=${filter.toLowerCase()}`}
          >
            Refresh
          </Link>
        </div>

        {items.length ? (
          <section className="activity-list" aria-label="Recent activity">
            {items.map((item) => <ActivityCard key={`${item.kind}-${item.id}`} item={item} />)}
          </section>
        ) : (
          <section className="results-panel empty-approvals">
            <h2>No activity yet</h2>
            <p>Completed sales and approval requests will appear here automatically.</p>
          </section>
        )}
      </section>
    </AppShell>
  );
}
