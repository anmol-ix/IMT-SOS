import { describe, expect, it } from "vitest";
import {
  calculateCountedInventoryValue,
  stockAdjustmentConflict,
} from "../../src/shared/stock-adjustment-policy";

describe("stockAdjustmentConflict", () => {
  it("requires a real difference and a count note", () => {
    expect(stockAdjustmentConflict({
      recordedQuantity: 3,
      countedQuantity: 3,
      note: "Rack count",
    })).toMatch(/matches/);
    expect(stockAdjustmentConflict({
      recordedQuantity: 3,
      countedQuantity: 2,
      note: "",
    })).toMatch(/note/);
    expect(stockAdjustmentConflict({
      recordedQuantity: 3,
      countedQuantity: 2,
      note: "Counted rack C2-S4 with the owner.",
    })).toBeNull();
  });
});

describe("calculateCountedInventoryValue", () => {
  it("removes stock at moving weighted-average value", () => {
    expect(calculateCountedInventoryValue({
      currentQuantity: 3,
      currentValuePaise: 120_000n,
      countedQuantity: 2,
      fallbackUnitCostPaise: 50_000n,
    })).toEqual({
      nextValuePaise: 80_000n,
      valueDeltaPaise: -40_000n,
      appliedUnitCostPaise: 40_000n,
    });
  });

  it("values found stock using the current average, then latest landed cost", () => {
    expect(calculateCountedInventoryValue({
      currentQuantity: 2,
      currentValuePaise: 90_000n,
      countedQuantity: 4,
      fallbackUnitCostPaise: 60_000n,
    })).toEqual({
      nextValuePaise: 180_000n,
      valueDeltaPaise: 90_000n,
      appliedUnitCostPaise: 45_000n,
    });
    expect(calculateCountedInventoryValue({
      currentQuantity: 0,
      currentValuePaise: 0n,
      countedQuantity: 2,
      fallbackUnitCostPaise: 60_000n,
    })).toEqual({
      nextValuePaise: 120_000n,
      valueDeltaPaise: 120_000n,
      appliedUnitCostPaise: 60_000n,
    });
  });

  it("blocks found stock when no cost basis exists", () => {
    expect(() => calculateCountedInventoryValue({
      currentQuantity: 0,
      currentValuePaise: 0n,
      countedQuantity: 1,
      fallbackUnitCostPaise: 0n,
    })).toThrow(/supplier receipt/);
  });
});
