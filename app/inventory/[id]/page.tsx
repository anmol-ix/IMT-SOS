import { notFound } from "next/navigation";
import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import { getInventoryHistory } from "@/server/inventory-history";
import InventoryWorkspace from "../InventoryWorkspace";
import { loadInventoryProducts } from "../data";

export default async function ProductInventoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireCurrentUser();
  const parsed = z.string().uuid().safeParse((await params).id);
  if (!parsed.success) notFound();
  const inventory = await getInventoryHistory(user, parsed.data).catch(() => null);
  if (!inventory) notFound();
  const products = await loadInventoryProducts(user);

  return (
    <InventoryWorkspace
      displayName={user.displayName}
      role={user.role}
      initialProducts={products}
      initialInventory={inventory}
      mode="DETAIL"
    />
  );
}
