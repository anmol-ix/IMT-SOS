import { describe, expect, it } from "vitest";
import { saleRequestSchema } from "@/server/sale-request";

const request = {
  lines: [{
    variantId: "00000000-0000-4000-8000-000000000001",
    quantity: 1,
    unitPricePaise: 50_000,
  }],
  payments: [{ paymentMode: "UPI" as const, amountPaise: 50_000 }],
};

describe("Retail and Wholesale sale request", () => {
  it("keeps older and offline commands as Retail sales", () => {
    expect(saleRequestSchema.parse(request).saleType).toBe("RETAIL");
  });

  it("accepts an explicit Wholesale sale", () => {
    expect(saleRequestSchema.parse({ ...request, saleType: "WHOLESALE" }).saleType)
      .toBe("WHOLESALE");
  });

  it("accepts an unpaid sale request with a due reason", () => {
    const parsed = saleRequestSchema.parse({
      ...request,
      payments: [],
      dueReason: "CUSTOMER_WILL_PAY_LATER",
    });
    expect(parsed.payments).toEqual([]);
    expect(parsed.dueReason).toBe("CUSTOMER_WILL_PAY_LATER");
  });
});
