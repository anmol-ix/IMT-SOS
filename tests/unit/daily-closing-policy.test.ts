import { describe, expect, it } from "vitest";
import {
  calculateDailyClosing,
  InvalidDailyClosingError,
} from "@/shared/daily-closing-policy";

const base = {
  expectedCashSalesPaise: 60_000,
  openingCashPaise: 20_000,
  cashPaidInPaise: 0,
  cashPaidOutPaise: 0,
  countedCashPaise: 80_000,
  expectedDigitalPayments: {
    UPI: 100_000,
    CARD: 20_000,
    BANK_TRANSFER: 0,
  },
  verifiedDigitalPayments: {
    UPI: 100_000,
    CARD: 20_000,
    BANK_TRANSFER: 0,
  },
};

describe("daily closing policy", () => {
  it("reconciles drawer cash separately from digital payments", () => {
    expect(calculateDailyClosing(base)).toEqual({
      expectedDrawerCashPaise: 80_000,
      cashVariancePaise: 0,
      digitalPayments: [
        {
          paymentMode: "UPI",
          expectedAmountPaise: 100_000,
          verifiedAmountPaise: 100_000,
          variancePaise: 0,
        },
        {
          paymentMode: "CARD",
          expectedAmountPaise: 20_000,
          verifiedAmountPaise: 20_000,
          variancePaise: 0,
        },
        {
          paymentMode: "BANK_TRANSFER",
          expectedAmountPaise: 0,
          verifiedAmountPaise: 0,
          variancePaise: 0,
        },
      ],
      hasVariance: false,
    });
  });

  it("includes accountable cash paid in and paid out", () => {
    const result = calculateDailyClosing({
      ...base,
      cashPaidInPaise: 10_000,
      cashPaidOutPaise: 5_000,
      countedCashPaise: 85_000,
      cashMovementNote: "₹100 added as change; ₹50 tea expense.",
    });
    expect(result.expectedDrawerCashPaise).toBe(85_000);
    expect(result.cashVariancePaise).toBe(0);
  });

  it("requires a note for cash movements and every variance", () => {
    expect(() =>
      calculateDailyClosing({
        ...base,
        cashPaidOutPaise: 5_000,
        countedCashPaise: 75_000,
      }),
    ).toThrow(InvalidDailyClosingError);

    expect(() =>
      calculateDailyClosing({
        ...base,
        countedCashPaise: 79_900,
      }),
    ).toThrow("Explain every cash or digital-payment variance");

    expect(() =>
      calculateDailyClosing({
        ...base,
        verifiedDigitalPayments: {
          ...base.verifiedDigitalPayments,
          UPI: 99_900,
        },
      }),
    ).toThrow("Explain every cash or digital-payment variance");
  });

  it("rejects negative and unsafe money inputs", () => {
    expect(() =>
      calculateDailyClosing({
        ...base,
        openingCashPaise: -1,
      }),
    ).toThrow(InvalidDailyClosingError);
    expect(() =>
      calculateDailyClosing({
        ...base,
        countedCashPaise: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow(InvalidDailyClosingError);
  });
});
