export const PAYMENT_MODES = ["CASH", "UPI", "CARD", "BANK_TRANSFER"] as const;

export type PaymentMode = (typeof PAYMENT_MODES)[number];

export type SalePayment = {
  paymentMode: PaymentMode;
  amountPaise: number;
};

export class InvalidPaymentsError extends Error {
  readonly status = 400;
  readonly code = "INVALID_PAYMENTS";

  constructor(message = "Enter one or two payments that exactly match the sale total.") {
    super(message);
    this.name = "InvalidPaymentsError";
  }
}

export function requireExactPayments(payments: SalePayment[], totalPaise: number): void {
  if (
    payments.length < 1
    || payments.length > 2
    || payments.some((payment) => !Number.isInteger(payment.amountPaise)
      || payment.amountPaise <= 0)
  ) {
    throw new InvalidPaymentsError();
  }
  if (new Set(payments.map((payment) => payment.paymentMode)).size !== payments.length) {
    throw new InvalidPaymentsError("Choose two different payment methods for a split sale.");
  }
  if (payments.reduce((total, payment) => total + payment.amountPaise, 0) !== totalPaise) {
    throw new InvalidPaymentsError();
  }
}
