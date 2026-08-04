export type OfflineCatalogProduct = {
  id: string;
  priceVersionId: string;
  name: string;
  variantName: string | null;
  sku: string;
  barcode: string;
  barcodes: string[];
  rackLocation: string | null;
  stock: number;
  mrpPaise: number;
  standardPricePaise: number;
  minimumPricePaise: number;
  suggestedMinimumPricePaise?: number;
};

export type OfflineCatalogSnapshot = {
  asOf: string;
  products: OfflineCatalogProduct[];
};

export function toOfflineCatalogProduct(
  product: OfflineCatalogProduct,
): OfflineCatalogProduct {
  return {
    id: product.id,
    priceVersionId: product.priceVersionId,
    name: product.name,
    variantName: product.variantName,
    sku: product.sku,
    barcode: product.barcode,
    barcodes: product.barcodes,
    rackLocation: product.rackLocation,
    stock: product.stock,
    mrpPaise: product.mrpPaise,
    standardPricePaise: product.standardPricePaise,
    minimumPricePaise: product.minimumPricePaise,
    suggestedMinimumPricePaise:
      product.suggestedMinimumPricePaise ?? product.minimumPricePaise,
  };
}

export function searchOfflineCatalog(
  products: OfflineCatalogProduct[],
  rawQuery: string,
): OfflineCatalogProduct[] {
  const query = rawQuery.trim().toLocaleLowerCase("en");
  if (!query) return products.slice(0, 12);

  return products
    .filter((product) =>
      product.sku.toLocaleLowerCase("en").includes(query)
      || product.barcodes.some((barcode) =>
        barcode.toLocaleLowerCase("en").includes(query))
      || product.name.toLocaleLowerCase("en").includes(query)
      || product.variantName?.toLocaleLowerCase("en").includes(query)
    )
    .sort((left, right) => {
      const leftExact = left.sku.toLocaleLowerCase("en") === query
        || left.barcodes.some((barcode) =>
          barcode.toLocaleLowerCase("en") === query);
      const rightExact = right.sku.toLocaleLowerCase("en") === query
        || right.barcodes.some((barcode) =>
          barcode.toLocaleLowerCase("en") === query);
      return Number(rightExact) - Number(leftExact);
    })
    .slice(0, 12);
}
