import { describe, expect, it } from "vitest";
import {
  InvalidPaymentsError,
  requireExactPayments,
  requirePaymentBalance,
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

  it("records a partial or unpaid amount only with a due reason", () => {
    expect(requirePaymentBalance(
      [{ paymentMode: "UPI", amountPaise: 60_000 }],
      100_000,
      "DIGITAL_PAYMENT_PENDING",
    )).toEqual({ amountPaidPaise: 60_000, balanceDuePaise: 40_000 });
    expect(requirePaymentBalance(
      [],
      100_000,
      "CUSTOMER_WILL_PAY_LATER",
    )).toEqual({ amountPaidPaise: 0, balanceDuePaise: 100_000 });
  });

  it("rejects an unpaid balance without a reason or a due reason on a paid sale", () => {
    expect(() =>
      requirePaymentBalance([{ paymentMode: "CASH", amountPaise: 60_000 }], 100_000)
    ).toThrow(InvalidPaymentsError);
    expect(() =>
      requirePaymentBalance(
        [{ paymentMode: "CASH", amountPaise: 100_000 }],
        100_000,
        "CUSTOMER_WILL_PAY_LATER",
      )
    ).toThrow(InvalidPaymentsError);
  });
});
