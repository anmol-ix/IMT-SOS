import type { AppRole } from "./auth/roles";

export type SalePrice = {
  standardPricePaise: number;
  ownerFloorPaise: number;
  trustedOperatorFloorPaise: number;
  storeOperatorFloorPaise: number;
};

export class PriceNotAllowedError extends Error {
  readonly status = 403;
  readonly code = "PRICE_NOT_ALLOWED";

  constructor() {
    super("The selected price is outside your permitted range.");
    this.name = "PriceNotAllowedError";
  }
}

export class PriceApprovalRequiredError extends Error {
  readonly status = 409;
  readonly code = "PRICE_APPROVAL_REQUIRED";

  constructor() {
    super("This price needs online approval from a business owner.");
    this.name = "PriceApprovalRequiredError";
  }
}

export const PRICE_EXCEPTION_REASONS = [
  "CLEARANCE",
  "DAMAGED_PACKAGING",
  "CUSTOMER_SERVICE_RECOVERY",
  "PRICING_CORRECTION",
  "OTHER",
] as const;

export type PriceExceptionReason = (typeof PRICE_EXCEPTION_REASONS)[number];

export function minimumPriceForRole(price: SalePrice, role: AppRole): number {
  if (role === "BUSINESS_OWNER") return price.ownerFloorPaise;
  if (role === "TRUSTED_OPERATOR") return price.trustedOperatorFloorPaise;
  return price.storeOperatorFloorPaise;
}

export function requirePermittedPrice(
  unitPricePaise: number,
  price: SalePrice,
  role: AppRole,
): void {
  const floor = minimumPriceForRole(price, role);
  if (unitPricePaise < floor || unitPricePaise > price.standardPricePaise) {
    throw new PriceNotAllowedError();
  }
}

export function priceNeedsApproval(
  unitPricePaise: number,
  price: SalePrice,
  role: AppRole,
): boolean {
  if (unitPricePaise <= 0 || unitPricePaise > price.standardPricePaise) {
    throw new PriceNotAllowedError();
  }
  return unitPricePaise < minimumPriceForRole(price, role);
}

export function requireExceptionReason(
  reason: PriceExceptionReason | undefined,
  note: string | undefined,
): asserts reason is PriceExceptionReason {
  if (!reason || (reason === "OTHER" && !note?.trim())) {
    throw new PriceApprovalRequiredError();
  }
}
