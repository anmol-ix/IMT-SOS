import Link from "next/link";
import type { Route } from "next";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import { requireCurrentUser } from "@/server/auth/current-user";
import { listGuestSaleApprovals } from "@/server/guest-sale-approvals";
import { listOfflineSaleConflicts } from "@/server/offline-sale-conflicts";
import { listPriceApprovals } from "@/server/price-approvals";
import { listPendingStockAdjustments } from "@/server/stock-adjustments";

export default async function ApprovalQueuePage() {
  const user = await requireCurrentUser(["BUSINESS_OWNER"]);
  const [offline, stock, guest, price] = await Promise.all([
    listOfflineSaleConflicts(user),
    listPendingStockAdjustments(user),
    listGuestSaleApprovals(user),
    listPriceApprovals(user),
  ]);
  const queues: Array<{
    href: string;
    label: string;
    count: number;
    copy: string;
  }> = [
    { href: "/operations/approvals/offline", label: "Offline sale conflicts", count: offline.length, copy: "Sales that could not safely sync." },
    { href: "/operations/approvals/stock", label: "Stock-count differences", count: stock.length, copy: "Physical counts waiting for an owner." },
    { href: "/operations/approvals/guest", label: "Guest sale requests", count: guest.length, copy: "High-value carts without customer details." },
    { href: "/operations/approvals/price", label: "Lower-price requests", count: price.length, copy: "Prices below an operator’s permitted floor." },
  ];
  return (
    <AppShell displayName={user.displayName} role="BUSINESS_OWNER">
      <section className="sell-page focused-page" aria-labelledby="approval-queue-heading">
        <PageHeader
          eyebrow="Owner decisions"
          headingId="approval-queue-heading"
          title="Approvals"
          description="Open one queue at a time and decide with the right context."
        />
        <section className="module-card-grid" aria-label="Approval queues">
          {queues.map((queue) => (
            <Link className={queue.count ? "module-card module-card--attention" : "module-card"} href={queue.href as Route} key={queue.href}>
              <span><strong>{queue.label}</strong><small>{queue.copy}</small></span>
              <b>{queue.count}</b>
            </Link>
          ))}
        </section>
      </section>
    </AppShell>
  );
}
