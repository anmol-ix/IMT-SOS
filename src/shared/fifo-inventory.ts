export const DEFAULT_WHOLESALE_MARKUP_BPS = 1_000;

export type FifoInventoryLot = {
  id: string;
  remainingQuantity: number;
  unitCostPaise: number;
};

export type FifoAllocation = {
  lotId: string;
  quantity: number;
  unitCostPaise: number;
  totalCostPaise: number;
};

function requireQuantity(quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new RangeError("FIFO quantity must be a positive whole number.");
  }
}

export function applyMarkup(
  unitCostPaise: number,
  markupBps = DEFAULT_WHOLESALE_MARKUP_BPS,
): number {
  if (
    !Number.isInteger(unitCostPaise)
    || unitCostPaise < 0
    || !Number.isInteger(markupBps)
    || markupBps < 0
  ) {
    throw new RangeError("Wholesale markup received invalid values.");
  }
  return Math.ceil(unitCostPaise * (10_000 + markupBps) / 10_000);
}

export function allocateFifo(
  lots: readonly FifoInventoryLot[],
  quantity: number,
): { allocations: FifoAllocation[]; totalCostPaise: number } {
  requireQuantity(quantity);
  let remaining = quantity;
  const allocations: FifoAllocation[] = [];

  for (const lot of lots) {
    if (
      !lot.id
      || !Number.isInteger(lot.remainingQuantity)
      || lot.remainingQuantity < 0
      || !Number.isInteger(lot.unitCostPaise)
      || lot.unitCostPaise < 0
    ) {
      throw new RangeError("FIFO lot received invalid values.");
    }
    if (remaining === 0) break;
    if (lot.remainingQuantity === 0) continue;
    const allocatedQuantity = Math.min(remaining, lot.remainingQuantity);
    allocations.push({
      lotId: lot.id,
      quantity: allocatedQuantity,
      unitCostPaise: lot.unitCostPaise,
      totalCostPaise: allocatedQuantity * lot.unitCostPaise,
    });
    remaining -= allocatedQuantity;
  }

  if (remaining > 0) {
    throw new RangeError("FIFO lots do not contain enough stock.");
  }

  return {
    allocations,
    totalCostPaise: allocations.reduce(
      (sum, allocation) => sum + allocation.totalCostPaise,
      0,
    ),
  };
}

export function suggestedWholesalePrice(
  lots: readonly FifoInventoryLot[],
  quantity: number,
  markupBps = DEFAULT_WHOLESALE_MARKUP_BPS,
): {
  unitPricePaise: number;
  totalPricePaise: number;
  totalCostPaise: number;
  allocations: FifoAllocation[];
} {
  const fifo = allocateFifo(lots, quantity);
  const totalPricePaise = fifo.allocations.reduce(
    (sum, allocation) =>
      sum + allocation.quantity * applyMarkup(allocation.unitCostPaise, markupBps),
    0,
  );
  return {
    ...fifo,
    totalPricePaise,
    unitPricePaise: Math.ceil(totalPricePaise / quantity),
  };
}
