export const DIGITAL_PAYMENT_MODES = [
  "UPI",
  "CARD",
  "BANK_TRANSFER",
] as const;

export type DigitalPaymentMode = (typeof DIGITAL_PAYMENT_MODES)[number];

export type DailyClosingCalculationInput = {
  expectedCashSalesPaise: number;
  openingCashPaise: number;
  cashPaidInPaise: number;
  cashPaidOutPaise: number;
  countedCashPaise: number;
  expectedDigitalPayments: Record<DigitalPaymentMode, number>;
  verifiedDigitalPayments: Record<DigitalPaymentMode, number>;
  cashMovementNote?: string;
  varianceNote?: string;
};

export type DailyClosingCalculation = {
  expectedDrawerCashPaise: number;
  cashVariancePaise: number;
  digitalPayments: Array<{
    paymentMode: DigitalPaymentMode;
    expectedAmountPaise: number;
    verifiedAmountPaise: number;
    variancePaise: number;
  }>;
  hasVariance: boolean;
};

export class InvalidDailyClosingError extends Error {
  readonly status = 400;
  readonly code = "INVALID_DAILY_CLOSING";

  constructor(message: string) {
    super(message);
    this.name = "InvalidDailyClosingError";
  }
}

function requireMoney(...values: number[]): void {
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new InvalidDailyClosingError(
      "Closing amounts must be whole, non-negative paise values.",
    );
  }
}

export function calculateDailyClosing(
  input: DailyClosingCalculationInput,
): DailyClosingCalculation {
  requireMoney(
    input.expectedCashSalesPaise,
    input.openingCashPaise,
    input.cashPaidInPaise,
    input.cashPaidOutPaise,
    input.countedCashPaise,
    ...DIGITAL_PAYMENT_MODES.flatMap((mode) => [
      input.expectedDigitalPayments[mode],
      input.verifiedDigitalPayments[mode],
    ]),
  );

  const expectedDrawerCashPaise =
    input.openingCashPaise
    + input.expectedCashSalesPaise
    + input.cashPaidInPaise
    - input.cashPaidOutPaise;
  if (expectedDrawerCashPaise < 0) {
    throw new InvalidDailyClosingError(
      "Cash paid out cannot exceed opening cash, cash sales and cash paid in.",
    );
  }

  if (
    (input.cashPaidInPaise > 0 || input.cashPaidOutPaise > 0)
    && (input.cashMovementNote?.trim().length ?? 0) < 3
  ) {
    throw new InvalidDailyClosingError(
      "Explain cash paid in or paid out before closing.",
    );
  }

  const cashVariancePaise = input.countedCashPaise - expectedDrawerCashPaise;
  const digitalPayments = DIGITAL_PAYMENT_MODES.map((paymentMode) => {
    const expectedAmountPaise = input.expectedDigitalPayments[paymentMode];
    const verifiedAmountPaise = input.verifiedDigitalPayments[paymentMode];
    return {
      paymentMode,
      expectedAmountPaise,
      verifiedAmountPaise,
      variancePaise: verifiedAmountPaise - expectedAmountPaise,
    };
  });
  const hasVariance =
    cashVariancePaise !== 0
    || digitalPayments.some((payment) => payment.variancePaise !== 0);

  if (hasVariance && (input.varianceNote?.trim().length ?? 0) < 3) {
    throw new InvalidDailyClosingError(
      "Explain every cash or digital-payment variance before closing.",
    );
  }

  return {
    expectedDrawerCashPaise,
    cashVariancePaise,
    digitalPayments,
    hasVariance,
  };
}
