import { createHash } from "node:crypto";

export const CUSTOMER_PROMPT_THRESHOLD_PAISE = 500_000;

export type GuestApprovalCartLine = {
  variantId: string;
  quantity: number;
  unitPricePaise: number;
};

export function requiresCustomerPrompt(totalPaise: number): boolean {
  return totalPaise >= CUSTOMER_PROMPT_THRESHOLD_PAISE;
}

export function guestApprovalCartHash(lines: GuestApprovalCartLine[]): string {
  const exactCart = lines
    .map(({ variantId, quantity, unitPricePaise }) => ({
      variantId,
      quantity,
      unitPricePaise,
    }))
    .sort((a, b) => a.variantId.localeCompare(b.variantId));
  return createHash("sha256").update(JSON.stringify(exactCart)).digest("hex");
}
