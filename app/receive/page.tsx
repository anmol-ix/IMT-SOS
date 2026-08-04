import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/current-user";
import { searchSellableProducts } from "@/server/catalog";
import { listStockReceiptDrafts } from "@/server/complete-stock-receipt";
import { listSuppliers } from "@/server/suppliers";
import { listProductMetadata } from "@/server/product-metadata";
import ReceiveWorkspace from "./ReceiveWorkspace";

export default async function ReceivePage() {
  const currentUser = await getCurrentUser();
  if (!["BUSINESS_OWNER", "TRUSTED_OPERATOR"].includes(currentUser.role)) redirect("/");
  const [initialProducts, initialDrafts, initialSuppliers, initialMetadata] = await Promise.all([
    searchSellableProducts(currentUser, ""),
    listStockReceiptDrafts(currentUser),
    listSuppliers(currentUser),
    listProductMetadata(currentUser),
  ]);

  return (
    <ReceiveWorkspace
      displayName={currentUser.displayName}
      role={currentUser.role as "BUSINESS_OWNER" | "TRUSTED_OPERATOR"}
      initialProducts={initialProducts}
      initialDrafts={initialDrafts}
      initialSuppliers={initialSuppliers}
      initialMetadata={initialMetadata}
    />
  );
}
