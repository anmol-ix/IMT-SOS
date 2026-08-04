export const PAYMENT_MODES = ["CASH", "UPI", "CARD", "BANK_TRANSFER"] as const;

export type PaymentMode = (typeof PAYMENT_MODES)[number];

export type SalePayment = {
  paymentMode: PaymentMode;
  amountPaise: number;
};

export const DUE_REASONS = [
  "CUSTOMER_WILL_PAY_LATER",
  "DIGITAL_PAYMENT_PENDING",
] as const;

export type DueReason = (typeof DUE_REASONS)[number];

export type PaymentBalance = {
  amountPaidPaise: number;
  balanceDuePaise: number;
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
  const balance = requirePaymentBalance(payments, totalPaise);
  if (balance.balanceDuePaise !== 0) throw new InvalidPaymentsError();
}

export function requirePaymentBalance(
  payments: SalePayment[],
  totalPaise: number,
  dueReason?: DueReason,
): PaymentBalance {
  if (
    payments.length > 2
    || payments.some((payment) => !Number.isInteger(payment.amountPaise)
      || payment.amountPaise <= 0)
  ) {
    throw new InvalidPaymentsError();
  }
  if (new Set(payments.map((payment) => payment.paymentMode)).size !== payments.length) {
    throw new InvalidPaymentsError("Choose two different payment methods for a split sale.");
  }
  const amountPaidPaise = payments.reduce(
    (total, payment) => total + payment.amountPaise,
    0,
  );
  const balanceDuePaise = totalPaise - amountPaidPaise;
  if (balanceDuePaise < 0) {
    throw new InvalidPaymentsError("Payments cannot exceed the sale total.");
  }
  if (balanceDuePaise > 0 && !dueReason) {
    throw new InvalidPaymentsError("Choose why the remaining balance is unpaid.");
  }
  if (balanceDuePaise === 0 && dueReason) {
    throw new InvalidPaymentsError("Remove the due reason when the sale is paid in full.");
  }
  return { amountPaidPaise, balanceDuePaise };
}
