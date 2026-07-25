import { describe, expect, it } from "vitest";
import {
  guestApprovalCartHash,
  requiresCustomerPrompt,
} from "@/server/guest-sale-policy";

describe("Guest sale policy", () => {
  it("requests customer information from ₹5,000", () => {
    expect(requiresCustomerPrompt(499_999)).toBe(false);
    expect(requiresCustomerPrompt(500_000)).toBe(true);
  });

  it("locks approval to products, quantities and prices without depending on line order", () => {
    const first = [
      { variantId: "b", quantity: 2, unitPricePaise: 25_000 },
      { variantId: "a", quantity: 1, unitPricePaise: 50_000 },
    ];
    expect(guestApprovalCartHash([...first].reverse())).toBe(guestApprovalCartHash(first));
    expect(
      guestApprovalCartHash([
        first[0],
        { ...first[1], unitPricePaise: first[1].unitPricePaise - 1 },
      ]),
    ).not.toBe(guestApprovalCartHash(first));
  });
});
