export const PRODUCT_CHANGE_REASONS = [
  "SUPPLIER_LABEL_CHANGE",
  "MARGIN_REVIEW",
  "RACK_REORGANISATION",
  "DATA_CORRECTION",
  "OTHER",
] as const;

export type ProductChangeReason = (typeof PRODUCT_CHANGE_REASONS)[number];

export const PRODUCT_CHANGE_REASON_LABELS: Record<ProductChangeReason, string> = {
  SUPPLIER_LABEL_CHANGE: "Supplier label or MRP changed",
  MARGIN_REVIEW: "Margin or selling-price review",
  RACK_REORGANISATION: "Rack reorganisation",
  DATA_CORRECTION: "Correct earlier data entry",
  OTHER: "Other",
};

export function productChangeNoteConflict(
  reason: ProductChangeReason,
  note?: string,
): string | null {
  if (reason === "OTHER" && !note?.trim()) {
    return "Add a note when the change reason is Other.";
  }
  return null;
}
