import { describe, expect, it } from "vitest";
import { percentageChange, percentageOf } from "@/shared/insights-math";

describe("business insight calculations", () => {
  it("keeps comparisons honest when there is no earlier period", () => {
    expect(percentageChange(10_000, 0)).toBeNull();
  });

  it("returns one-decimal percentage changes and shares", () => {
    expect(percentageChange(125, 100)).toBe(25);
    expect(percentageChange(75, 100)).toBe(-25);
    expect(percentageOf(29, 100)).toBe(29);
    expect(percentageOf(1, 3)).toBe(33.3);
  });
});
