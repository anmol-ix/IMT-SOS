import { describe, expect, it } from "vitest";
import {
  buildInternalSku,
  isRackCode,
  minimumGrowthPrice,
  priceFloorConflict,
  productPricingConflict,
  recommendedPriceFloors,
  suggestSkuCode,
} from "@/shared/product-setup-policy";

describe("new product setup policy", () => {
  it("builds the accepted internal SKU and optional variant suffix", () => {
    expect(buildInternalSku("car", "rc", 41, "red")).toBe(
      "IMT-CAR-RC-0041-RED",
    );
    expect(buildInternalSku("edu", "blk", 42)).toBe("IMT-EDU-BLK-0042");
  });

  it("suggests stable SKU codes while avoiding an existing code", () => {
    expect(suggestSkuCode("Remote Control")).toBe("RC");
    expect(suggestSkuCode("Action Figures and Playsets")).toBe("ACT");
    expect(suggestSkuCode("Cars", ["CAR"])).toBe("CA1");
    expect(suggestSkuCode("Dark Blue", [], 4)).toBe("DB");
  });

  it("accepts only the physical ItsMyToy rack and shelf layout", () => {
    expect(isRackCode("L1-S1")).toBe(true);
    expect(isRackCode("C3-S6")).toBe(true);
    expect(isRackCode("R4-S2")).toBe(true);
    expect(isRackCode("L7-S1")).toBe(false);
    expect(isRackCode("C4-S2")).toBe(false);
    expect(isRackCode("R1-S7")).toBe(false);
  });

  it("generates the accepted role floors rounded upward to ₹5", () => {
    expect(recommendedPriceFloors(40_000, 80_000)).toEqual({
      ownerFloorPaise: 64_000,
      trustedOperatorFloorPaise: 72_000,
      storeOperatorFloorPaise: 76_000,
    });
    expect(recommendedPriceFloors(40_300, 50_100)).toEqual({
      ownerFloorPaise: 40_500,
      trustedOperatorFloorPaise: 45_500,
      storeOperatorFloorPaise: 48_000,
    });
  });

  it("keeps the ordinary maximum discount above a 10% purchase-cost profit", () => {
    expect(minimumGrowthPrice(8_000)).toBe(8_800);
    expect(minimumGrowthPrice(8_001)).toBe(8_900);
  });

  it("blocks an MRP or standard price that would create unsafe pricing", () => {
    expect(productPricingConflict(40_000, 80_000, 100_000)).toBeNull();
    expect(productPricingConflict(40_000, 80_000, 79_999)).toMatch(/MRP/);
    expect(productPricingConflict(79_999, 79_999, 100_000)).toBeNull();
    expect(priceFloorConflict(
      79_999,
      79_999,
      recommendedPriceFloors(79_999, 79_999),
    )).toMatch(/cannot exceed/);
  });

  it("keeps the Wholesale price between cost and the Retail price", () => {
    expect(productPricingConflict(40_000, 80_000, 100_000, 65_000)).toBeNull();
    expect(productPricingConflict(40_000, 80_000, 100_000, 80_001))
      .toMatch(/higher than the Retail/);
    expect(productPricingConflict(40_000, 80_000, 100_000, 39_999))
      .toMatch(/purchase cost/);
  });

  it("allows owner overrides only when the role floors remain safely ordered", () => {
    expect(priceFloorConflict(40_000, 80_000, {
      ownerFloorPaise: 60_000,
      trustedOperatorFloorPaise: 68_000,
      storeOperatorFloorPaise: 75_000,
    })).toBeNull();
    expect(priceFloorConflict(40_000, 80_000, {
      ownerFloorPaise: 35_000,
      trustedOperatorFloorPaise: 68_000,
      storeOperatorFloorPaise: 75_000,
    })).toBeNull();
    expect(priceFloorConflict(40_000, 80_000, {
      ownerFloorPaise: 60_000,
      trustedOperatorFloorPaise: 59_999,
      storeOperatorFloorPaise: 75_000,
    })).toMatch(/increase from owner/);
  });
});
