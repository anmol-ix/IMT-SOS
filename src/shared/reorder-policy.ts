export const REORDER_POLICY_REASONS = [
  "INITIAL_SETUP",
  "SALES_VELOCITY",
  "SUPPLIER_LEAD_TIME",
  "SEASONALITY",
  "STORAGE_CAPACITY",
  "DATA_CORRECTION",
  "OTHER",
] as const;

export type ReorderPolicyReason = (typeof REORDER_POLICY_REASONS)[number];

export type ReorderPolicyValues = {
  reorderPoint: number | null;
  restockTarget: number | null;
};

export class InvalidReorderPolicyError extends Error {
  readonly status = 400;
  readonly code = "INVALID_REORDER_POLICY";

  constructor(message: string) {
    super(message);
    this.name = "InvalidReorderPolicyError";
  }
}

export function requireValidReorderPolicy(
  policy: ReorderPolicyValues,
  note: string,
): void {
  const bothDisabled =
    policy.reorderPoint === null && policy.restockTarget === null;
  if (
    !bothDisabled
    && (policy.reorderPoint === null || policy.restockTarget === null)
  ) {
    throw new InvalidReorderPolicyError(
      "Set both the reorder point and restock target, or disable both.",
    );
  }
  if (policy.reorderPoint !== null && policy.restockTarget !== null) {
    const { reorderPoint, restockTarget } = policy;
    if (
      !Number.isInteger(reorderPoint)
      || !Number.isInteger(restockTarget)
      || reorderPoint < 0
      || reorderPoint > 100_000
      || restockTarget < 1
      || restockTarget > 100_000
    ) {
      throw new InvalidReorderPolicyError(
        "Reorder quantities must be whole units between 0 and 100,000.",
      );
    }
    if (restockTarget <= reorderPoint) {
      throw new InvalidReorderPolicyError(
        "Restock target must be greater than the reorder point.",
      );
    }
  }
  if (note.trim().length < 3 || note.trim().length > 500) {
    throw new InvalidReorderPolicyError(
      "Add a short note explaining this replenishment decision.",
    );
  }
}

export function suggestedReorderQuantity(
  sellableQuantity: number,
  restockTarget: number | null,
): number | null {
  if (restockTarget === null) return null;
  return Math.max(0, restockTarget - sellableQuantity);
}
