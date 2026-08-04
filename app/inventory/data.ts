import type { CurrentUser } from "@/server/auth/current-user";
import { listInventoryProducts } from "@/server/catalog";

export async function loadInventoryProducts(user: CurrentUser) {
  return (await listInventoryProducts(user)).map((product) => ({
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
}
