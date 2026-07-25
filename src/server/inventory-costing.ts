export function allocateWeightedAverageCost(
  inventoryValuePaise: bigint,
  quantityOnHand: number,
  quantitySold: number,
): bigint {
  if (
    inventoryValuePaise < 0n ||
    !Number.isInteger(quantityOnHand) ||
    !Number.isInteger(quantitySold) ||
    quantityOnHand < 1 ||
    quantitySold < 1 ||
    quantitySold > quantityOnHand
  ) {
    throw new RangeError("Inventory cost allocation received invalid values.");
  }
  if (quantitySold === quantityOnHand) return inventoryValuePaise;
  const divisor = BigInt(quantityOnHand);
  return (inventoryValuePaise * BigInt(quantitySold) + divisor / 2n) / divisor;
}

export function roundedAverageUnitCost(
  inventoryValuePaise: bigint,
  quantityOnHand: number,
): bigint {
  if (quantityOnHand < 1) return 0n;
  const divisor = BigInt(quantityOnHand);
  return (inventoryValuePaise + divisor / 2n) / divisor;
}
