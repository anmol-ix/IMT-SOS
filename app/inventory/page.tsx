import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import { searchSellableProducts } from "@/server/catalog";
import { getInventoryHistory } from "@/server/inventory-history";
import InventoryWorkspace from "./InventoryWorkspace";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  const user = await requireCurrentUser();
  let products = (await searchSellableProducts(user, "")).map((product) => ({
    id: product.id,
    name: product.name,
    variantName: product.variantName,
    sku: product.sku,
    rackLocation: product.rackLocation,
    stock: product.stock,
    openBoxStock: product.openBoxStock,
    damagedStock: product.damagedStock,
  }));
  const requestedProduct = z.string().uuid().safeParse(
    (await searchParams).product,
  );
  const initialInventory = requestedProduct.success
    ? await getInventoryHistory(user, requestedProduct.data)
    : undefined;
  if (
    initialInventory
    && !products.some((product) => product.id === initialInventory.product.id)
  ) {
    products = [{
      id: initialInventory.product.id,
      name: initialInventory.product.name,
      variantName: initialInventory.product.variantName,
      sku: initialInventory.product.sku,
      rackLocation: initialInventory.product.rackLocation,
      stock: initialInventory.balances.SELLABLE,
      openBoxStock: initialInventory.balances.OPEN_BOX,
      damagedStock: initialInventory.balances.DAMAGED,
    }, ...products];
  }
  return (
    <InventoryWorkspace
      displayName={user.displayName}
      role={user.role}
      initialProducts={products}
      initialInventory={initialInventory}
    />
  );
}
