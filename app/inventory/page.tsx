import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import { listInventoryProducts } from "@/server/catalog";
import { getInventoryHistory } from "@/server/inventory-history";
import InventoryWorkspace from "./InventoryWorkspace";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  const user = await requireCurrentUser();
  let products = (await listInventoryProducts(user)).map((product) => ({
    id: product.id,
    name: product.name,
    category: product.category,
    variantName: product.variantName,
    sku: product.sku,
    barcode: product.barcode,
    rackLocation: product.rackLocation,
    stock: product.stock,
    openBoxStock: product.openBoxStock,
    damagedStock: product.damagedStock,
    mrpPaise: product.mrpPaise,
    standardPricePaise: product.standardPricePaise,
    wholesalePricePaise: product.wholesalePricePaise,
    minimumPricePaise: product.minimumPricePaise,
    inventoryValuePaise: product.inventoryValuePaise,
    weightedAverageCostPaise: product.weightedAverageCostPaise,
    latestLandedCostPaise: product.latestLandedCostPaise,
    reorderPoint: product.reorderPoint,
    restockTarget: product.restockTarget,
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
      category: initialInventory.product.category,
      variantName: initialInventory.product.variantName,
      sku: initialInventory.product.sku,
      barcode: initialInventory.product.barcode,
      rackLocation: initialInventory.product.rackLocation,
      stock: initialInventory.balances.SELLABLE,
      openBoxStock: initialInventory.balances.OPEN_BOX,
      damagedStock: initialInventory.balances.DAMAGED,
      mrpPaise: initialInventory.product.mrpPaise,
      standardPricePaise: initialInventory.product.standardPricePaise,
      wholesalePricePaise: initialInventory.product.wholesalePricePaise,
      minimumPricePaise: initialInventory.product.minimumPricePaise,
      inventoryValuePaise: initialInventory.inventoryValuePaise,
      weightedAverageCostPaise: initialInventory.weightedAverageCostPaise,
      latestLandedCostPaise: initialInventory.latestLandedCostPaise,
      reorderPoint: initialInventory.product.reorderPoint,
      restockTarget: initialInventory.product.restockTarget,
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
