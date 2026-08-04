import { notFound } from "next/navigation";
import { requireCurrentUser } from "@/server/auth/current-user";
import { listGuestSaleApprovals } from "@/server/guest-sale-approvals";
import { listOfflineSaleConflicts } from "@/server/offline-sale-conflicts";
import { listPriceApprovals } from "@/server/price-approvals";
import { listPendingStockAdjustments } from "@/server/stock-adjustments";
import ApprovalsWorkspace from "../../../approvals/ApprovalsWorkspace";

const modes = {
  offline: "OFFLINE",
  stock: "STOCK",
  guest: "GUEST",
  price: "PRICE",
} as const;

export default async function ApprovalTypePage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const type = (await params).type;
  if (!(type in modes)) notFound();
  const user = await requireCurrentUser(["BUSINESS_OWNER"]);
  const [price, guest, stock, offline] = await Promise.all([
    listPriceApprovals(user),
    listGuestSaleApprovals(user),
    listPendingStockAdjustments(user),
    listOfflineSaleConflicts(user),
  ]);
  return (
    <ApprovalsWorkspace
      displayName={user.displayName}
      initialApprovals={price}
      initialGuestApprovals={guest}
      initialStockAdjustments={stock}
      initialOfflineSaleConflicts={offline}
      mode={modes[type as keyof typeof modes]}
    />
  );
}
