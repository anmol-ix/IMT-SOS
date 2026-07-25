import { describe, expect, it } from "vitest";
import {
  InvalidReorderPolicyError,
  requireValidReorderPolicy,
  suggestedReorderQuantity,
} from "@/shared/reorder-policy";

describe("reorder policy", () => {
  it("accepts an explicit alert point and higher restock target", () => {
    expect(() =>
      requireValidReorderPolicy(
        { reorderPoint: 2, restockTarget: 10 },
        "Initial policy based on shelf capacity.",
      ),
    ).not.toThrow();
    expect(suggestedReorderQuantity(1, 10)).toBe(9);
    expect(suggestedReorderQuantity(12, 10)).toBe(0);
  });

  it("allows both values to be disabled with an accountable note", () => {
    expect(() =>
      requireValidReorderPolicy(
        { reorderPoint: null, restockTarget: null },
        "Seasonal item is no longer replenished.",
      ),
    ).not.toThrow();
    expect(suggestedReorderQuantity(0, null)).toBeNull();
  });

  it("rejects partial, inverted, fractional and unexplained policies", () => {
    expect(() =>
      requireValidReorderPolicy(
        { reorderPoint: 2, restockTarget: null },
        "Partial",
      ),
    ).toThrow(InvalidReorderPolicyError);
    expect(() =>
      requireValidReorderPolicy(
        { reorderPoint: 5, restockTarget: 5 },
        "Invalid target",
      ),
    ).toThrow("greater than the reorder point");
    expect(() =>
      requireValidReorderPolicy(
        { reorderPoint: 1.5, restockTarget: 10 },
        "Fractional",
      ),
    ).toThrow(InvalidReorderPolicyError);
    expect(() =>
      requireValidReorderPolicy(
        { reorderPoint: 2, restockTarget: 10 },
        "",
      ),
    ).toThrow("Add a short note");
  });
});
