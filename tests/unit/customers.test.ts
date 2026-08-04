import { describe, expect, it } from "vitest";
import { customerSegment } from "@/server/customers";

describe("customerSegment", () => {
  it("derives the customer type from completed Retail and Wholesale orders", () => {
    expect(customerSegment(2, 0)).toBe("RETAIL");
    expect(customerSegment(0, 3)).toBe("WHOLESALE");
    expect(customerSegment(2, 3)).toBe("MIXED");
    expect(customerSegment(0, 0)).toBe("NEW");
  });
});
