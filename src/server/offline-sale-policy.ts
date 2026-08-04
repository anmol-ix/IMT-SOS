import { OFFLINE_GUEST_LIMIT_PAISE } from "@/shared/offline-sale";
import type { CompleteSaleInput } from "@/server/complete-sale";

export class OfflineSalePolicyError extends Error {
  readonly status = 409;
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OfflineSalePolicyError";
    this.code = code;
  }
}

export function requireOfflineSalePolicy(input: CompleteSaleInput): void {
  if (!input.offline) return;
  if (
    input.customerId
    || input.guestApprovalId
    || input.ownerGuestOverride
    || input.dueReason
    || input.lines.some((line) => line.approvalId || line.ownerException)
  ) {
    throw new OfflineSalePolicyError(
      "OFFLINE_GUEST_ONLY",
      "Queued offline sales must remain Guest sales without approvals or customer details.",
    );
  }
  if (
    input.payments.length !== 1
    || !["CASH", "UPI"].includes(input.payments[0].paymentMode)
  ) {
    throw new OfflineSalePolicyError(
      "OFFLINE_PAYMENT_NOT_ALLOWED",
      "Queued offline sales may use one Cash or UPI payment only.",
    );
  }
  const totalPaise = input.lines.reduce(
    (total, line) => total + line.quantity * line.unitPricePaise,
    0,
  );
  if (totalPaise >= OFFLINE_GUEST_LIMIT_PAISE) {
    throw new OfflineSalePolicyError(
      "CUSTOMER_APPROVAL_REQUIRED",
      "Reconnect for a Guest sale of ₹5,000 or more.",
    );
  }
  if (
    input.offline.lines.length !== input.lines.length
    || new Set(input.offline.lines.map((line) => line.variantId)).size
      !== input.offline.lines.length
  ) {
    throw new OfflineSalePolicyError(
      "COMMAND_SCHEMA_UNSUPPORTED",
      "The queued sale does not match its offline stock snapshot.",
    );
  }
  for (const line of input.lines) {
    const cached = input.offline.lines.find(
      (item) => item.variantId === line.variantId,
    );
    if (
      !cached
      || cached.cachedStock - cached.queuedBeforeQuantity - line.quantity < 1
    ) {
      throw new OfflineSalePolicyError(
        "OFFLINE_STOCK_RESERVE",
        "The queued sale does not preserve the one-unit offline stock reserve.",
      );
    }
  }
}
