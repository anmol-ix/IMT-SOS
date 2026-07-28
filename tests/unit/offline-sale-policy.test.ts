import { describe, expect, it } from "vitest";
import {
  OfflineSalePolicyError,
  requireOfflineSalePolicy,
} from "@/server/offline-sale-policy";
import type { CompleteSaleInput } from "@/server/complete-sale";

const variantId = "5a0be628-c716-41c8-9332-ac703252db61";

function sale(overrides: Partial<CompleteSaleInput> = {}): CompleteSaleInput {
  return {
    lines: [{ variantId, quantity: 2, unitPricePaise: 80_000 }],
    payments: [{ paymentMode: "CASH", amountPaise: 160_000 }],
    offline: {
      schemaVersion: 1,
      deviceId: "45ee4c95-a774-49c7-b3df-4a24c0bcaefd",
      devicePublicId: "21e97c07-c082-4c89-9f82-5e862df4ce99",
      validatedAt: "2026-07-28T03:00:00.000Z",
      createdAt: "2026-07-28T10:00:00.000Z",
      catalogAsOf: "2026-07-28T03:00:00.000Z",
      lines: [{
        variantId,
        priceVersionId: "641aecbe-ff97-4d26-9ce5-9dc3a3e10b31",
        cachedStock: 4,
        queuedBeforeQuantity: 1,
      }],
    },
    ...overrides,
  };
}

describe("server offline sale policy", () => {
  it("accepts a normal Guest sale that leaves one cached unit", () => {
    expect(() => requireOfflineSalePolicy(sale())).not.toThrow();
  });

  it("rejects customer data, unsupported payment and reserve violations", () => {
    expect(() => requireOfflineSalePolicy(sale({ customerId: variantId })))
      .toThrowError(OfflineSalePolicyError);
    expect(() => requireOfflineSalePolicy(sale({
      payments: [{ paymentMode: "CARD", amountPaise: 160_000 }],
    }))).toThrow(/Cash or UPI/i);
    expect(() => requireOfflineSalePolicy(sale({
      lines: [{ variantId, quantity: 3, unitPricePaise: 80_000 }],
      payments: [{ paymentMode: "UPI", amountPaise: 240_000 }],
    }))).toThrow(/one-unit/i);
  });

  it("rejects high-value Guest carts and mismatched metadata", () => {
    expect(() => requireOfflineSalePolicy(sale({
      lines: [{ variantId, quantity: 6, unitPricePaise: 90_000 }],
      payments: [{ paymentMode: "UPI", amountPaise: 540_000 }],
      offline: {
        ...sale().offline!,
        lines: [{
          ...sale().offline!.lines[0],
          cachedStock: 10,
        }],
      },
    }))).toThrow(/₹5,000/i);
    expect(() => requireOfflineSalePolicy(sale({
      offline: { ...sale().offline!, lines: [] },
    }))).toThrow(/does not match/i);
  });
});
