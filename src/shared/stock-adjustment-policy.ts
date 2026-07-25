export const STOCK_CONDITIONS = [
  "SELLABLE",
  "OPEN_BOX",
  "DAMAGED",
] as const;

export type StockCondition = (typeof STOCK_CONDITIONS)[number];

export const STOCK_ADJUSTMENT_REASONS = [
  "PHYSICAL_COUNT",
  "DAMAGE_OR_PACKAGING_FOUND",
  "LOSS_OR_MISSING",
  "FOUND_STOCK",
  "DATA_CORRECTION",
  "OTHER",
] as const;

export type StockAdjustmentReason =
  (typeof STOCK_ADJUSTMENT_REASONS)[number];

export const STOCK_ADJUSTMENT_REASON_LABELS: Record<
  StockAdjustmentReason,
  string
> = {
  PHYSICAL_COUNT: "Routine physical count",
  DAMAGE_OR_PACKAGING_FOUND: "Damage or packaging issue found",
  LOSS_OR_MISSING: "Lost or missing stock",
  FOUND_STOCK: "Stock found during checking",
  DATA_CORRECTION: "Earlier data-entry correction",
  OTHER: "Other",
};

export function stockAdjustmentConflict(input: {
  recordedQuantity: number;
  countedQuantity: number;
  note?: string;
}): string | null {
  if (
    !Number.isInteger(input.recordedQuantity)
    || !Number.isInteger(input.countedQuantity)
    || input.recordedQuantity < 0
    || input.countedQuantity < 0
  ) {
    return "Recorded and counted quantities must be whole numbers at or above zero.";
  }
  if (input.recordedQuantity === input.countedQuantity) {
    return "The physical count already matches the recorded quantity.";
  }
  const note = input.note?.trim() ?? "";
  if (note.length < 3) {
    return "Add a short note explaining when and how the stock was counted.";
  }
  if (note.length > 500) return "The count note must be 500 characters or fewer.";
  return null;
}

export function calculateCountedInventoryValue(input: {
  currentQuantity: number;
  currentValuePaise: bigint;
  countedQuantity: number;
  fallbackUnitCostPaise: bigint;
}): {
  nextValuePaise: bigint;
  valueDeltaPaise: bigint;
  appliedUnitCostPaise: bigint;
} {
  const {
    currentQuantity,
    currentValuePaise,
    countedQuantity,
    fallbackUnitCostPaise,
  } = input;
  if (
    !Number.isInteger(currentQuantity)
    || !Number.isInteger(countedQuantity)
    || currentQuantity < 0
    || countedQuantity < 0
    || currentValuePaise < 0n
    || fallbackUnitCostPaise < 0n
    || currentQuantity === countedQuantity
  ) {
    throw new RangeError("Stock-count valuation received invalid values.");
  }

  const roundedUnitCost = currentQuantity > 0
    ? (currentValuePaise + BigInt(currentQuantity) / 2n)
      / BigInt(currentQuantity)
    : fallbackUnitCostPaise;

  if (countedQuantity > currentQuantity) {
    if (roundedUnitCost <= 0n) {
      throw new RangeError(
        "Found stock has no usable cost. Receive it through a supplier receipt instead.",
      );
    }
    const valueDeltaPaise =
      BigInt(countedQuantity - currentQuantity) * roundedUnitCost;
    return {
      nextValuePaise: currentValuePaise + valueDeltaPaise,
      valueDeltaPaise,
      appliedUnitCostPaise: roundedUnitCost,
    };
  }

  const removedQuantity = currentQuantity - countedQuantity;
  const removedValuePaise = countedQuantity === 0
    ? currentValuePaise
    : (
      currentValuePaise * BigInt(removedQuantity)
      + BigInt(currentQuantity) / 2n
    ) / BigInt(currentQuantity);
  return {
    nextValuePaise: currentValuePaise - removedValuePaise,
    valueDeltaPaise: -removedValuePaise,
    appliedUnitCostPaise: roundedUnitCost,
  };
}
