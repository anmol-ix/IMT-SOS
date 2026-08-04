import { requireCurrentUser } from "@/server/auth/current-user";
import InventoryWorkspace from "../InventoryWorkspace";
import { loadInventoryProducts } from "../data";

export default async function LabelsPage() {
  const user = await requireCurrentUser();
  const products = await loadInventoryProducts(user);
  return (
    <InventoryWorkspace
      displayName={user.displayName}
      role={user.role}
      initialProducts={products}
      mode="LABELS"
    />
  );
}
