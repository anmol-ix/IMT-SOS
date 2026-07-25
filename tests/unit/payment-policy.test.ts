import { describe, expect, it } from "vitest";
import {
  InvalidPaymentsError,
  requireExactPayments,
} from "@/server/payment-policy";

describe("sale payment policy", () => {
  it("accepts one payment or two different methods that exactly match the total", () => {
    expect(() =>
      requireExactPayments([{ paymentMode: "UPI", amountPaise: 100_000 }], 100_000)
    ).not.toThrow();
    expect(() =>
      requireExactPayments([
        { paymentMode: "CASH", amountPaise: 40_000 },
        { paymentMode: "UPI", amountPaise: 60_000 },
      ], 100_000)
    ).not.toThrow();
  });

  it("rejects partial, excess, duplicate-method and three-part payments", () => {
    expect(() =>
      requireExactPayments([{ paymentMode: "CASH", amountPaise: 99_999 }], 100_000)
    ).toThrow(InvalidPaymentsError);
    expect(() =>
      requireExactPayments([
        { paymentMode: "UPI", amountPaise: 40_000 },
        { paymentMode: "UPI", amountPaise: 60_000 },
      ], 100_000)
    ).toThrow(InvalidPaymentsError);
    expect(() =>
      requireExactPayments([
        { paymentMode: "CASH", amountPaise: 30_000 },
        { paymentMode: "UPI", amountPaise: 30_000 },
        { paymentMode: "CARD", amountPaise: 40_000 },
      ], 100_000)
    ).toThrow(InvalidPaymentsError);
  });
});
