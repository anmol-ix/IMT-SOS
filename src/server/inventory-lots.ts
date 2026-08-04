import "server-only";

import type { PoolClient } from "pg";
import {
  allocateFifo,
  type FifoAllocation,
  type FifoInventoryLot,
} from "@/shared/fifo-inventory";

type InventoryLotRow = {
  id: string;
  remaining_quantity: number;
  unit_cost_paise: string;
};

export class InventoryLotMismatchError extends Error {
  readonly status = 409;
  readonly code = "INVENTORY_LOT_MISMATCH";

  constructor(message = "The stock cost layers do not match the recorded stock.") {
    super(message);
    this.name = "InventoryLotMismatchError";
  }
}

function rowsToLots(rows: InventoryLotRow[]): FifoInventoryLot[] {
  return rows.map((row) => ({
    id: row.id,
    remainingQuantity: row.remaining_quantity,
    unitCostPaise: Number(row.unit_cost_paise),
  }));
}

async function insertOpeningLots(
  client: PoolClient,
  input: {
    businessId: string;
    locationId: string;
    variantId: string;
    quantity: number;
    valuePaise: number;
    receivedAt: Date;
  },
) {
  const baseCostPaise = Math.floor(input.valuePaise / input.quantity);
  const higherCostUnits = input.valuePaise % input.quantity;
  const lowerCostUnits = input.quantity - higherCostUnits;
  if (lowerCostUnits > 0) {
    await client.query(
      `INSERT INTO inventory_lots
        (business_id, location_id, variant_id, source_type,
         original_quantity, remaining_quantity, unit_cost_paise, received_at)
       VALUES ($1, $2, $3, 'OPENING_BALANCE', $4, $4, $5, $6)`,
      [
        input.businessId,
        input.locationId,
        input.variantId,
        lowerCostUnits,
        baseCostPaise,
        input.receivedAt,
      ],
    );
  }
  if (higherCostUnits > 0) {
    await client.query(
      `INSERT INTO inventory_lots
        (business_id, location_id, variant_id, source_type,
         original_quantity, remaining_quantity, unit_cost_paise, received_at)
       VALUES ($1, $2, $3, 'OPENING_BALANCE', $4, $4, $5, $6)`,
      [
        input.businessId,
        input.locationId,
        input.variantId,
        higherCostUnits,
        baseCostPaise + 1,
        new Date(input.receivedAt.getTime() + 1),
      ],
    );
  }
}

export async function lockInventoryLots(
  client: PoolClient,
  input: {
    businessId: string;
    locationId: string;
    variantId: string;
    quantityOnHand: number;
    inventoryValuePaise: number;
  },
): Promise<FifoInventoryLot[]> {
  let result = await client.query<InventoryLotRow>(
    `SELECT id, remaining_quantity, unit_cost_paise
       FROM inventory_lots
      WHERE business_id = $1 AND location_id = $2 AND variant_id = $3
        AND remaining_quantity > 0
      ORDER BY received_at, id
      FOR UPDATE`,
    [input.businessId, input.locationId, input.variantId],
  );
  let lots = rowsToLots(result.rows);
  const lotQuantity = lots.reduce((sum, lot) => sum + lot.remainingQuantity, 0);
  const lotValuePaise = lots.reduce(
    (sum, lot) => sum + lot.remainingQuantity * lot.unitCostPaise,
    0,
  );

  if (lotQuantity === input.quantityOnHand && lotValuePaise === input.inventoryValuePaise) {
    return lots;
  }

  // Records created by older imports and database-level tests may predate FIFO
  // lots. Fill only a positive, value-backed gap; never hide an over-allocation.
  const missingQuantity = input.quantityOnHand - lotQuantity;
  const missingValuePaise = input.inventoryValuePaise - lotValuePaise;
  if (missingQuantity <= 0 || missingValuePaise < 0) {
    throw new InventoryLotMismatchError();
  }
  const oldest = await client.query<{ received_at: Date }>(
    `SELECT received_at
       FROM inventory_lots
      WHERE business_id = $1 AND location_id = $2 AND variant_id = $3
      ORDER BY received_at, id
      LIMIT 1`,
    [input.businessId, input.locationId, input.variantId],
  );
  await insertOpeningLots(client, {
    businessId: input.businessId,
    locationId: input.locationId,
    variantId: input.variantId,
    quantity: missingQuantity,
    valuePaise: missingValuePaise,
    receivedAt: oldest.rows[0]
      ? new Date(oldest.rows[0].received_at.getTime() - 1)
      : new Date(0),
  });
  result = await client.query<InventoryLotRow>(
    `SELECT id, remaining_quantity, unit_cost_paise
       FROM inventory_lots
      WHERE business_id = $1 AND location_id = $2 AND variant_id = $3
        AND remaining_quantity > 0
      ORDER BY received_at, id
      FOR UPDATE`,
    [input.businessId, input.locationId, input.variantId],
  );
  lots = rowsToLots(result.rows);
  return lots;
}

export async function consumeInventoryLots(
  client: PoolClient,
  allocations: readonly FifoAllocation[],
  saleLineId?: string,
) {
  for (const [index, allocation] of allocations.entries()) {
    const updated = await client.query(
      `UPDATE inventory_lots
          SET remaining_quantity = remaining_quantity - $1
        WHERE id = $2 AND remaining_quantity >= $1
        RETURNING id`,
      [allocation.quantity, allocation.lotId],
    );
    if (!updated.rows[0]) throw new InventoryLotMismatchError();
    if (saleLineId) {
      await client.query(
        `INSERT INTO sale_line_cost_allocations
          (sale_line_id, inventory_lot_id, allocation_sequence,
           quantity, unit_cost_paise)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          saleLineId,
          allocation.lotId,
          index + 1,
          allocation.quantity,
          allocation.unitCostPaise,
        ],
      );
    }
  }
}

export async function consumeFifoInventory(
  client: PoolClient,
  input: {
    businessId: string;
    locationId: string;
    variantId: string;
    quantityOnHand: number;
    inventoryValuePaise: number;
    quantity: number;
  },
) {
  const lots = await lockInventoryLots(client, input);
  try {
    return allocateFifo(lots, input.quantity);
  } catch (error) {
    throw new InventoryLotMismatchError(
      error instanceof Error ? error.message : undefined,
    );
  }
}

export async function createReceiptInventoryLot(
  client: PoolClient,
  input: {
    businessId: string;
    locationId: string;
    variantId: string;
    receiptLineId: string;
    quantity: number;
    unitCostPaise: number;
    receivedAt: Date;
  },
) {
  if (input.quantity < 1) return;
  await client.query(
    `INSERT INTO inventory_lots
      (business_id, location_id, variant_id, source_type, source_id,
       original_quantity, remaining_quantity, unit_cost_paise, received_at)
     VALUES ($1, $2, $3, 'RECEIPT', $4, $5, $5, $6, $7)
     ON CONFLICT (source_type, source_id) WHERE source_id IS NOT NULL DO NOTHING`,
    [
      input.businessId,
      input.locationId,
      input.variantId,
      input.receiptLineId,
      input.quantity,
      input.unitCostPaise,
      input.receivedAt,
    ],
  );
}

export async function createAdjustmentInventoryLot(
  client: PoolClient,
  input: {
    businessId: string;
    locationId: string;
    variantId: string;
    adjustmentId: string;
    quantity: number;
    unitCostPaise: number;
  },
) {
  if (input.quantity < 1) return;
  await client.query(
    `INSERT INTO inventory_lots
      (business_id, location_id, variant_id, source_type, source_id,
       original_quantity, remaining_quantity, unit_cost_paise, received_at)
     VALUES ($1, $2, $3, 'ADJUSTMENT', $4, $5, $5, $6, now())
     ON CONFLICT (source_type, source_id) WHERE source_id IS NOT NULL DO NOTHING`,
    [
      input.businessId,
      input.locationId,
      input.variantId,
      input.adjustmentId,
      input.quantity,
      input.unitCostPaise,
    ],
  );
}
