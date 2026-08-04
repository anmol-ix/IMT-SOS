import { describe, expect, it } from "vitest";
import {
  allocateFifo,
  applyMarkup,
  suggestedWholesalePrice,
} from "@/shared/fifo-inventory";

describe("FIFO inventory and Wholesale suggestions", () => {
  const lots = [
    { id: "old", remainingQuantity: 3, unitCostPaise: 40_000 },
    { id: "new", remainingQuantity: 10, unitCostPaise: 50_000 },
  ];

  it("consumes the oldest purchase-cost layer first", () => {
    expect(allocateFifo(lots, 4)).toEqual({
      allocations: [
        {
          lotId: "old",
          quantity: 3,
          unitCostPaise: 40_000,
          totalCostPaise: 120_000,
        },
        {
          lotId: "new",
          quantity: 1,
          unitCostPaise: 50_000,
          totalCostPaise: 50_000,
        },
      ],
      totalCostPaise: 170_000,
    });
  });

  it("suggests 10% above each FIFO purchase layer", () => {
    expect(applyMarkup(40_000)).toBe(44_000);
    expect(applyMarkup(50_000)).toBe(55_000);
    expect(suggestedWholesalePrice(lots, 4)).toEqual({
      allocations: [
        {
          lotId: "old",
          quantity: 3,
          unitCostPaise: 40_000,
          totalCostPaise: 120_000,
        },
        {
          lotId: "new",
          quantity: 1,
          unitCostPaise: 50_000,
          totalCostPaise: 50_000,
        },
      ],
      totalCostPaise: 170_000,
      totalPricePaise: 187_000,
      unitPricePaise: 46_750,
    });
  });

  it("rejects a quantity that is larger than the available layers", () => {
    expect(() => allocateFifo(lots, 14)).toThrow(
      "FIFO lots do not contain enough stock.",
    );
  });
});
