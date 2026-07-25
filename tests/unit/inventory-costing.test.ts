import { describe, expect, it } from "vitest";
import {
  allocateWeightedAverageCost,
  roundedAverageUnitCost,
} from "@/server/inventory-costing";

describe("moving weighted-average inventory costing", () => {
  it("preserves the 3 at ₹400 plus 10 at ₹500 scenario down to the paise", () => {
    const inventoryValue = 3n * 40_000n + 10n * 50_000n;
    expect(inventoryValue).toBe(620_000n);
    expect(roundedAverageUnitCost(inventoryValue, 13)).toBe(47_692n);

    const cogs = allocateWeightedAverageCost(inventoryValue, 13, 4);
    expect(cogs).toBe(190_769n);
    expect(140_000n - cogs).toBe(-50_769n);
    expect(140_000n - 4n * 50_000n).toBe(-60_000n);
    expect(inventoryValue - cogs).toBe(429_231n);
  });

  it("allocates every remaining paise when the final units are sold", () => {
    expect(allocateWeightedAverageCost(429_231n, 9, 9)).toBe(429_231n);
  });
});
