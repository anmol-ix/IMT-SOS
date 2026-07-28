import { requireCurrentUser } from "@/server/auth/current-user";
import { listGuestSaleApprovals } from "@/server/guest-sale-approvals";
import { listOfflineSaleConflicts } from "@/server/offline-sale-conflicts";
import { listPriceApprovals } from "@/server/price-approvals";
import { listPendingStockAdjustments } from "@/server/stock-adjustments";
import ApprovalsWorkspace from "./ApprovalsWorkspace";

export default async function ApprovalsPage() {
  const user = await requireCurrentUser(["BUSINESS_OWNER"]);
  const [
    priceApprovals,
    guestApprovals,
    stockAdjustments,
    offlineSaleConflicts,
  ] = await Promise.all([
    listPriceApprovals(user),
    listGuestSaleApprovals(user),
    listPendingStockAdjustments(user),
    listOfflineSaleConflicts(user),
  ]);
  return (
    <ApprovalsWorkspace
      displayName={user.displayName}
      initialApprovals={priceApprovals}
      initialGuestApprovals={guestApprovals}
      initialStockAdjustments={stockAdjustments}
      initialOfflineSaleConflicts={offlineSaleConflicts}
    />
  );
}
