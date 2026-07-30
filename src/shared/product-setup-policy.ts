export const PRODUCT_UNITS = ["UNIT", "PACK", "SET", "PAIR"] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

export const RACK_CODES = [
  ...Array.from({ length: 6 }, (_, column) =>
    Array.from({ length: 6 }, (_, shelf) => `L${column + 1}-S${shelf + 1}`),
  ).flat(),
  ...Array.from({ length: 3 }, (_, column) =>
    Array.from({ length: 6 }, (_, shelf) => `C${column + 1}-S${shelf + 1}`),
  ).flat(),
  ...Array.from({ length: 4 }, (_, column) =>
    Array.from({ length: 6 }, (_, shelf) => `R${column + 1}-S${shelf + 1}`),
  ).flat(),
] as const;

export function isRackCode(value: string): boolean {
  return /^(?:L[1-6]|C[1-3]|R[1-4])-S[1-6]$/.test(value);
}

export function normalizeSkuCode(value: string, maximumLength = 3): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, maximumLength);
}

export function buildInternalSku(
  categoryCode: string,
  subcategoryCode: string,
  sequenceNumber: number,
  variantCode?: string,
): string {
  const category = normalizeSkuCode(categoryCode);
  const subcategory = normalizeSkuCode(subcategoryCode);
  const variant = variantCode
    ? normalizeSkuCode(variantCode, 4)
    : "";
  if (
    category.length < 2 ||
    subcategory.length < 2 ||
    !Number.isInteger(sequenceNumber) ||
    sequenceNumber < 1 ||
    sequenceNumber > 9_999
  ) {
    throw new Error("A valid category, sub-category and SKU sequence are required.");
  }
  return [
    "IMT",
    category,
    subcategory,
    String(sequenceNumber).padStart(4, "0"),
    ...(variant ? [variant] : []),
  ].join("-");
}

function roundUpToFiveRupees(paise: number): number {
  return Math.ceil(paise / 500) * 500;
}

export function recommendedPriceFloors(
  purchaseCostPaise: number,
  standardPricePaise: number,
) {
  const ownerFloorPaise = roundUpToFiveRupees(
    Math.max(purchaseCostPaise, Math.ceil(standardPricePaise * 0.8)),
  );
  const trustedOperatorFloorPaise = roundUpToFiveRupees(
    Math.max(ownerFloorPaise, Math.ceil(standardPricePaise * 0.9)),
  );
  const storeOperatorFloorPaise = roundUpToFiveRupees(
    Math.max(trustedOperatorFloorPaise, Math.ceil(standardPricePaise * 0.95)),
  );
  return {
    ownerFloorPaise,
    trustedOperatorFloorPaise,
    storeOperatorFloorPaise,
  };
}

export type PriceFloors = ReturnType<typeof recommendedPriceFloors>;

export function priceFloorConflict(
  _purchaseCostPaise: number,
  standardPricePaise: number,
  floors: PriceFloors,
): string | null {
  if (
    floors.ownerFloorPaise < 1 ||
    floors.trustedOperatorFloorPaise < floors.ownerFloorPaise ||
    floors.storeOperatorFloorPaise < floors.trustedOperatorFloorPaise
  ) {
    return "Price floors must increase from owner to trusted operator to store operator.";
  }
  if (floors.storeOperatorFloorPaise > standardPricePaise) {
    return "Store-operator floor cannot exceed the standard selling price.";
  }
  return null;
}

export function productPricingConflict(
  purchaseCostPaise: number,
  standardPricePaise: number,
  mrpPaise: number,
  wholesalePricePaise = standardPricePaise,
): string | null {
  if (
    !Number.isInteger(purchaseCostPaise) ||
    !Number.isInteger(standardPricePaise) ||
    !Number.isInteger(mrpPaise) ||
    !Number.isInteger(wholesalePricePaise) ||
    purchaseCostPaise < 1 ||
    standardPricePaise < 1 ||
    mrpPaise < 1 ||
    wholesalePricePaise < 1
  ) {
    return "Purchase cost, Retail price, Wholesale price and MRP must be positive amounts.";
  }
  if (mrpPaise < standardPricePaise) {
    return "MRP cannot be lower than the Retail price.";
  }
  if (wholesalePricePaise > standardPricePaise) {
    return "Wholesale price cannot be higher than the Retail price.";
  }
  if (wholesalePricePaise < purchaseCostPaise) {
    return "Wholesale price cannot be lower than the latest purchase cost.";
  }
  return null;
}
