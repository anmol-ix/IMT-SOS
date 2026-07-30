export type LabelCsvProduct = {
  sku: string;
  barcode: string;
  productName: string;
  variantName: string | null;
  mrpPaise: number;
  standardPricePaise: number;
  rackLocation: string | null;
};

function cell(value: string | number) {
  const raw = String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function buildLabelCsv(products: LabelCsvProduct[]) {
  const rows = products.map((product) => [
    product.sku,
    product.barcode,
    product.productName,
    product.variantName ?? "",
    (product.mrpPaise / 100).toFixed(2),
    (product.standardPricePaise / 100).toFixed(2),
    product.rackLocation ?? "",
  ]);
  return [
    ["SKU", "Barcode", "Product Name", "Variant", "MRP", "Selling Price", "Rack"],
    ...rows,
  ].map((row) => row.map(cell).join(",")).join("\r\n");
}
