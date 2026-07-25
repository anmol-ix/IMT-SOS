import { describe, expect, it } from "vitest";
import {
  minimumPriceForRole,
  priceNeedsApproval,
  PriceApprovalRequiredError,
  PriceNotAllowedError,
  requireExceptionReason,
  requirePermittedPrice,
} from "@/server/sale-policy";

const price = {
  standardPricePaise: 80_000,
  ownerFloorPaise: 64_000,
  trustedOperatorFloorPaise: 72_000,
  storeOperatorFloorPaise: 76_000,
};

describe("sale price policy", () => {
  it("uses the signed-in role's floor and blocks lower prices", () => {
    expect(minimumPriceForRole(price, "STORE_OPERATOR")).toBe(76_000);
    expect(() => requirePermittedPrice(76_000, price, "STORE_OPERATOR")).not.toThrow();
    expect(() => requirePermittedPrice(75_999, price, "STORE_OPERATOR")).toThrow(
      PriceNotAllowedError,
    );
    expect(() => requirePermittedPrice(64_000, price, "BUSINESS_OWNER")).not.toThrow();
  });

  it("requires approval below the signed-in role floor", () => {
    expect(priceNeedsApproval(75_999, price, "STORE_OPERATOR")).toBe(true);
    expect(priceNeedsApproval(76_000, price, "STORE_OPERATOR")).toBe(false);
    expect(() => priceNeedsApproval(80_001, price, "STORE_OPERATOR")).toThrow(
      PriceNotAllowedError,
    );
  });

  it("requires a controlled reason and a note for other", () => {
    expect(() => requireExceptionReason("CLEARANCE", undefined)).not.toThrow();
    expect(() => requireExceptionReason("OTHER", "Local competitor correction")).not.toThrow();
    expect(() => requireExceptionReason("OTHER", "  ")).toThrow(PriceApprovalRequiredError);
    expect(() => requireExceptionReason(undefined, undefined)).toThrow(
      PriceApprovalRequiredError,
    );
  });
});
