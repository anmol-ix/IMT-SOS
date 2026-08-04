import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { CurrentUser } from "./auth/current-user";
import { requireRole } from "./auth/roles";
import { getDatabase, inTransaction } from "./database";
import { IdempotencyConflictError } from "./proof-command";
import { ProductUnavailableError } from "./complete-sale";
import { roundedAverageUnitCost } from "./inventory-costing";
import { createReceiptInventoryLot } from "./inventory-lots";

export type StockReceiptLineInput = {
  variantId: string;
  sellableQuantity: number;
  openBoxQuantity: number;
  damagedQuantity: number;
  invoiceUnitCostPaise: number;
};

export type CompleteStockReceiptInput = {
  supplierId: string;
  supplierInvoiceReference?: string;
  note?: string;
  duplicateAcknowledged?: boolean;
  lines: StockReceiptLineInput[];
};

export type CompletedStockReceiptLine = {
  variantId: string;
  productName: string;
  sku: string;
  receivedQuantity: number;
  receivedSellableQuantity: number;
  receivedOpenBoxQuantity: number;
  receivedDamagedQuantity: number;
  newStock: number;
  newSellableStock: number;
  newOpenBoxStock: number;
  newDamagedStock: number;
  inventoryValuePaise: number;
  latestLandedCostPaise: number;
  weightedAverageCostPaise: number;
};

export type CompleteStockReceiptResult = {
  receiptId: string;
  receiptNumber: string;
  supplierName: string;
  totalReceivedQuantity: number;
  totalSellableQuantity: number;
  totalOpenBoxQuantity: number;
  totalDamagedQuantity: number;
  totalReceivedValuePaise: number;
  lines: CompletedStockReceiptLine[];
  replayed: boolean;
};

export type StockReceiptDraftLine = {
  variantId: string;
  productName: string;
  sku: string;
  quantity: number;
  sellableQuantity: number;
  openBoxQuantity: number;
  damagedQuantity: number;
  invoiceUnitCostPaise?: number;
};

export type StockReceiptDraft = {
  receiptId: string;
  receiptNumber: string;
  supplierId: string;
  supplierName: string;
  supplierInvoiceReference: string | null;
  note: string | null;
  createdByName: string;
  createdAt: string;
  totalQuantity: number;
  totalSellableQuantity: number;
  totalOpenBoxQuantity: number;
  totalDamagedQuantity: number;
  totalInvoiceValuePaise?: number;
  lines: StockReceiptDraftLine[];
  replayed: boolean;
};

type ProductRow = {
  variant_id: string;
  product_name: string;
  sku: string;
  location_id: string;
  quantity_on_hand: number;
  inventory_value_paise: string;
  latest_landed_cost_paise: string;
};

type SupplierRow = {
  id: string;
  name: string;
};

type DraftRow = {
  receipt_id: string;
  receipt_number: string;
  supplier_id: string;
  supplier_name: string;
  supplier_invoice_reference: string | null;
  note: string | null;
  created_by_name: string;
  created_at: Date;
  variant_id: string;
  product_name: string;
  sku: string;
  quantity_received: number;
  sellable_quantity: number;
  open_box_quantity: number;
  damaged_quantity: number;
  invoice_unit_cost_paise: string;
};

type ReceiptLineRow = {
  id: string;
  variant_id: string;
  product_name: string;
  sku: string;
  location_id: string;
  quantity_received: number;
  sellable_quantity: number;
  open_box_quantity: number;
  damaged_quantity: number;
  invoice_unit_cost_paise: string;
};

const productSql = `SELECT
  v.id AS variant_id, p.name AS product_name, v.sku,
  l.id AS location_id, ib.quantity_on_hand,
  ib.inventory_value_paise, ib.latest_landed_cost_paise
FROM product_variants v
JOIN products p ON p.id = v.product_id
JOIN inventory_balances ib ON ib.variant_id = v.id
JOIN locations l ON l.id = ib.location_id AND l.status = 'ACTIVE'
WHERE v.id = $1 AND p.business_id = $2
  AND p.status = 'ACTIVE' AND v.status = 'ACTIVE'
ORDER BY l.created_at
LIMIT 1`;

const draftSql = `SELECT
  r.id AS receipt_id, r.receipt_number, r.supplier_id, r.supplier_name,
  r.supplier_invoice_reference, r.note, creator.display_name AS created_by_name,
  r.created_at, l.variant_id, p.name AS product_name, v.sku,
  l.quantity_received, l.sellable_quantity, l.open_box_quantity,
  l.damaged_quantity, l.invoice_unit_cost_paise
FROM stock_receipts r
JOIN stock_receipt_lines l ON l.receipt_id = r.id
JOIN product_variants v ON v.id = l.variant_id
JOIN products p ON p.id = v.product_id
JOIN app_users creator ON creator.id = r.created_by`;

function inputHash(input: CompleteStockReceiptInput) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function normalizeInvoiceReference(value?: string): string | null {
  const normalized = value?.trim().replace(/\s+/g, "").toUpperCase();
  return normalized || null;
}

function draftView(
  rows: DraftRow[],
  includeCost: boolean,
  replayed = false,
): StockReceiptDraft {
  const first = rows[0];
  const totalQuantity = rows.reduce((sum, row) => sum + row.quantity_received, 0);
  const totalSellableQuantity = rows.reduce(
    (sum, row) => sum + row.sellable_quantity,
    0,
  );
  const totalOpenBoxQuantity = rows.reduce(
    (sum, row) => sum + row.open_box_quantity,
    0,
  );
  const totalDamagedQuantity = rows.reduce(
    (sum, row) => sum + row.damaged_quantity,
    0,
  );
  const totalInvoiceValuePaise = rows.reduce(
    (sum, row) => sum + row.quantity_received * Number(row.invoice_unit_cost_paise),
    0,
  );
  return {
    receiptId: first.receipt_id,
    receiptNumber: first.receipt_number,
    supplierId: first.supplier_id,
    supplierName: first.supplier_name,
    supplierInvoiceReference: first.supplier_invoice_reference,
    note: first.note,
    createdByName: first.created_by_name,
    createdAt: first.created_at.toISOString(),
    totalQuantity,
    totalSellableQuantity,
    totalOpenBoxQuantity,
    totalDamagedQuantity,
    ...(includeCost ? { totalInvoiceValuePaise } : {}),
    lines: rows.map((row) => ({
      variantId: row.variant_id,
      productName: row.product_name,
      sku: row.sku,
      quantity: row.quantity_received,
      sellableQuantity: row.sellable_quantity,
      openBoxQuantity: row.open_box_quantity,
      damagedQuantity: row.damaged_quantity,
      ...(includeCost
        ? { invoiceUnitCostPaise: Number(row.invoice_unit_cost_paise) }
        : {}),
    })),
    replayed,
  };
}

export class StockReceiptUnavailableError extends Error {
  readonly status = 409;
  readonly code = "STOCK_RECEIPT_UNAVAILABLE";

  constructor(message = "This stock receipt draft is no longer available.") {
    super(message);
    this.name = "StockReceiptUnavailableError";
  }
}

export class InvalidStockReceiptError extends Error {
  readonly status = 400;
  readonly code = "INVALID_STOCK_RECEIPT";

  constructor(message: string) {
    super(message);
    this.name = "InvalidStockReceiptError";
  }
}

export class DuplicateSupplierInvoiceError extends Error {
  readonly status = 409;
  readonly code = "POSSIBLE_DUPLICATE_SUPPLIER_INVOICE";

  constructor(receiptNumber: string, status: string) {
    super(
      `Possible duplicate: this supplier bill reference is already on ${receiptNumber} (${status.toLowerCase()}). Check the supplier document before continuing.`,
    );
    this.name = "DuplicateSupplierInvoiceError";
  }
}

async function loadSupplier(
  client: PoolClient,
  user: CurrentUser,
  supplierId: string,
): Promise<SupplierRow> {
  const result = await client.query<SupplierRow>(
    `SELECT id, name FROM suppliers
      WHERE id = $1 AND business_id = $2 AND status = 'ACTIVE'`,
    [supplierId, user.businessId],
  );
  if (!result.rows[0]) {
    throw new InvalidStockReceiptError("Select an active supplier before saving the receipt.");
  }
  return result.rows[0];
}

async function protectDuplicateInvoice(
  client: PoolClient,
  user: CurrentUser,
  input: CompleteStockReceiptInput,
): Promise<string | null> {
  const normalized = normalizeInvoiceReference(input.supplierInvoiceReference);
  if (!normalized) return null;

  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`${user.businessId}:${input.supplierId}:${normalized}`],
  );
  const duplicate = await client.query<{ receipt_number: string; status: string }>(
    `SELECT receipt_number, status
       FROM stock_receipts
      WHERE business_id = $1 AND supplier_id = $2
        AND supplier_invoice_reference_normalized = $3
        AND status <> 'VOIDED'
      ORDER BY created_at DESC
      LIMIT 1`,
    [user.businessId, input.supplierId, normalized],
  );
  if (duplicate.rows[0] && !input.duplicateAcknowledged) {
    throw new DuplicateSupplierInvoiceError(
      duplicate.rows[0].receipt_number,
      duplicate.rows[0].status,
    );
  }
  return normalized;
}

function assertDistinctLines(lines: StockReceiptLineInput[]) {
  if (lines.length === 0) {
    throw new InvalidStockReceiptError("Add at least one product to the receipt.");
  }
  const variants = new Set(lines.map((line) => line.variantId));
  if (variants.size !== lines.length) {
    throw new InvalidStockReceiptError(
      "The same product appears twice. Update its existing receipt line instead.",
    );
  }
  if (lines.some((line) =>
    line.sellableQuantity < 0 ||
    line.openBoxQuantity < 0 ||
    line.damagedQuantity < 0 ||
    line.sellableQuantity + line.openBoxQuantity + line.damagedQuantity < 1
  )) {
    throw new InvalidStockReceiptError(
      "Each receipt line needs at least one sellable, open-box or damaged unit.",
    );
  }
}

async function loadProducts(
  client: PoolClient,
  user: CurrentUser,
  lines: StockReceiptLineInput[],
): Promise<Map<string, ProductRow>> {
  assertDistinctLines(lines);
  const products = new Map<string, ProductRow>();
  for (const line of [...lines].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
    const result = await client.query<ProductRow>(productSql, [line.variantId, user.businessId]);
    if (!result.rows[0]) throw new ProductUnavailableError();
    products.set(line.variantId, result.rows[0]);
  }
  return products;
}

async function loadDraft(
  client: PoolClient,
  user: CurrentUser,
  receiptId: string,
): Promise<DraftRow[]> {
  const result = await client.query<DraftRow>(
    `${draftSql} WHERE r.id = $1 AND r.business_id = $2 ORDER BY l.created_at, l.id`,
    [receiptId, user.businessId],
  );
  return result.rows;
}

async function applyConditionReceipt(
  client: PoolClient,
  line: ReceiptLineRow,
  condition: "OPEN_BOX" | "DAMAGED",
  quantity: number,
  unitCost: number,
): Promise<number> {
  if (quantity === 0) {
    const current = await client.query<{ quantity_on_hand: number }>(
      `SELECT quantity_on_hand
         FROM inventory_condition_balances
        WHERE location_id = $1 AND variant_id = $2 AND stock_condition = $3`,
      [line.location_id, line.variant_id, condition],
    );
    return current.rows[0]?.quantity_on_hand ?? 0;
  }
  const updated = await client.query<{ quantity_on_hand: number }>(
    `INSERT INTO inventory_condition_balances
       (location_id, variant_id, stock_condition, quantity_on_hand,
        inventory_value_paise)
     VALUES (
       $1, $2, $3, $4::integer,
       $4::integer::bigint * $5::bigint
     )
     ON CONFLICT (location_id, variant_id, stock_condition)
     DO UPDATE SET
       quantity_on_hand =
         inventory_condition_balances.quantity_on_hand + EXCLUDED.quantity_on_hand,
       inventory_value_paise =
         inventory_condition_balances.inventory_value_paise
         + EXCLUDED.inventory_value_paise,
       version = inventory_condition_balances.version + 1,
       updated_at = now()
     RETURNING quantity_on_hand`,
    [line.location_id, line.variant_id, condition, quantity, unitCost],
  );
  return updated.rows[0].quantity_on_hand;
}

async function insertReceiptMovement(
  client: PoolClient,
  user: CurrentUser,
  receiptId: string,
  line: ReceiptLineRow,
  condition: "SELLABLE" | "OPEN_BOX" | "DAMAGED",
  quantity: number,
) {
  if (quantity === 0) return;
  await client.query(
    `INSERT INTO inventory_movements
       (business_id, location_id, variant_id, movement_type, stock_condition,
        quantity_delta, reference_type, reference_id, created_by)
     VALUES ($1, $2, $3, 'RECEIPT', $4, $5, 'STOCK_RECEIPT', $6, $7)`,
    [
      user.businessId,
      line.location_id,
      line.variant_id,
      condition,
      quantity,
      receiptId,
      user.id,
    ],
  );
}

async function finishReceipt(
  client: PoolClient,
  user: CurrentUser,
  completionCommandId: string,
  receipt: {
    id: string;
    receiptNumber: string;
    supplierName: string;
  },
  lines: ReceiptLineRow[],
): Promise<CompleteStockReceiptResult> {
  const completedLines: CompletedStockReceiptLine[] = [];

  for (const line of [...lines].sort((a, b) => a.variant_id.localeCompare(b.variant_id))) {
    const balance = await client.query<{
      quantity_on_hand: number;
      inventory_value_paise: string;
      latest_landed_cost_paise: string;
    }>(
      `SELECT quantity_on_hand, inventory_value_paise, latest_landed_cost_paise
         FROM inventory_balances
        WHERE location_id = $1 AND variant_id = $2
        FOR UPDATE`,
      [line.location_id, line.variant_id],
    );
    const current = balance.rows[0];
    if (!current) throw new ProductUnavailableError();

    const sellableQuantity = line.sellable_quantity;
    const openBoxQuantity = line.open_box_quantity;
    const damagedQuantity = line.damaged_quantity;
    const quantity = sellableQuantity + openBoxQuantity + damagedQuantity;
    const unitCost = Number(line.invoice_unit_cost_paise);
    const newStock = current.quantity_on_hand + sellableQuantity;
    const inventoryValuePaise =
      BigInt(current.inventory_value_paise)
      + BigInt(sellableQuantity) * BigInt(unitCost);
    const newOpenBoxStock = await applyConditionReceipt(
      client,
      line,
      "OPEN_BOX",
      openBoxQuantity,
      unitCost,
    );
    const newDamagedStock = await applyConditionReceipt(
      client,
      line,
      "DAMAGED",
      damagedQuantity,
      unitCost,
    );
    const lineResult: CompletedStockReceiptLine = {
      variantId: line.variant_id,
      productName: line.product_name,
      sku: line.sku,
      receivedQuantity: quantity,
      receivedSellableQuantity: sellableQuantity,
      receivedOpenBoxQuantity: openBoxQuantity,
      receivedDamagedQuantity: damagedQuantity,
      newStock,
      newSellableStock: newStock,
      newOpenBoxStock,
      newDamagedStock,
      inventoryValuePaise: Number(inventoryValuePaise),
      latestLandedCostPaise: unitCost,
      weightedAverageCostPaise:
        newStock > 0
          ? Number(roundedAverageUnitCost(inventoryValuePaise, newStock))
          : 0,
    };

    await client.query(
      `UPDATE stock_receipt_lines
          SET previous_landed_cost_paise = $1
        WHERE receipt_id = $2 AND variant_id = $3`,
      [current.latest_landed_cost_paise, receipt.id, line.variant_id],
    );
    await client.query(
      `UPDATE inventory_balances
          SET quantity_on_hand = $1, inventory_value_paise = $2,
              latest_landed_cost_paise = $3, version = version + 1,
              updated_at = now()
        WHERE location_id = $4 AND variant_id = $5`,
      [
        newStock,
        inventoryValuePaise.toString(),
        unitCost,
        line.location_id,
        line.variant_id,
      ],
    );
    await createReceiptInventoryLot(client, {
      businessId: user.businessId,
      locationId: line.location_id,
      variantId: line.variant_id,
      receiptLineId: line.id,
      quantity: sellableQuantity,
      unitCostPaise: unitCost,
      receivedAt: new Date(),
    });
    await insertReceiptMovement(
      client,
      user,
      receipt.id,
      line,
      "SELLABLE",
      sellableQuantity,
    );
    await insertReceiptMovement(
      client,
      user,
      receipt.id,
      line,
      "OPEN_BOX",
      openBoxQuantity,
    );
    await insertReceiptMovement(
      client,
      user,
      receipt.id,
      line,
      "DAMAGED",
      damagedQuantity,
    );
    completedLines.push(lineResult);
  }

  const result = {
    receiptId: receipt.id,
    receiptNumber: receipt.receiptNumber,
    supplierName: receipt.supplierName,
    totalReceivedQuantity: completedLines.reduce(
      (sum, line) => sum + line.receivedQuantity,
      0,
    ),
    totalSellableQuantity: completedLines.reduce(
      (sum, line) => sum + line.receivedSellableQuantity,
      0,
    ),
    totalOpenBoxQuantity: completedLines.reduce(
      (sum, line) => sum + line.receivedOpenBoxQuantity,
      0,
    ),
    totalDamagedQuantity: completedLines.reduce(
      (sum, line) => sum + line.receivedDamagedQuantity,
      0,
    ),
    totalReceivedValuePaise: lines.reduce(
      (sum, line) =>
        sum + line.quantity_received * Number(line.invoice_unit_cost_paise),
      0,
    ),
    lines: completedLines,
  };

  await client.query(
    `UPDATE stock_receipts
        SET status = 'COMPLETED', completed_by = $1, completion_command_id = $2,
            completed_at = now(), result_json = $3, updated_at = now()
      WHERE id = $4 AND status = 'DRAFT'`,
    [user.id, completionCommandId, result, receipt.id],
  );
  await client.query(
    `INSERT INTO audit_events
       (business_id, actor_user_id, event_type, entity_type, entity_id, details)
     VALUES ($1, $2, 'STOCK_RECEIPT_COMPLETED', 'STOCK_RECEIPT', $3, $4)`,
    [
      user.businessId,
      user.id,
      receipt.id,
      {
        lineCount: completedLines.length,
        totalQuantity: result.totalReceivedQuantity,
        sellableQuantity: result.totalSellableQuantity,
        openBoxQuantity: result.totalOpenBoxQuantity,
        damagedQuantity: result.totalDamagedQuantity,
        supplierName: receipt.supplierName,
      },
    ],
  );

  return { ...result, replayed: false };
}

export async function createStockReceiptDraft(
  user: CurrentUser,
  commandId: string,
  input: CompleteStockReceiptInput,
): Promise<StockReceiptDraft> {
  requireRole(user.role, ["TRUSTED_OPERATOR"]);
  const requestHash = inputHash(input);

  return inTransaction(async (client) => {
    const prior = await client.query<{ id: string; request_hash: string }>(
      `SELECT id, request_hash FROM stock_receipts
        WHERE business_id = $1 AND command_id = $2`,
      [user.businessId, commandId],
    );
    if (prior.rows[0]) {
      if (prior.rows[0].request_hash !== requestHash) throw new IdempotencyConflictError();
      const rows = await loadDraft(client, user, prior.rows[0].id);
      if (!rows[0]) throw new StockReceiptUnavailableError();
      return draftView(rows, false, true);
    }

    const supplier = await loadSupplier(client, user, input.supplierId);
    const normalizedReference = await protectDuplicateInvoice(client, user, input);
    const products = await loadProducts(client, user, input.lines);
    const receiptId = randomUUID();
    const receiptNumber = `RCV-${receiptId.slice(0, 8).toUpperCase()}`;
    const inserted = await client.query(
      `INSERT INTO stock_receipts
         (id, business_id, location_id, receipt_number, command_id, request_hash,
          supplier_id, supplier_name, supplier_invoice_reference,
          supplier_invoice_reference_normalized, note, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'DRAFT', $12)
       ON CONFLICT (command_id) DO NOTHING
       RETURNING id`,
      [
        receiptId,
        user.businessId,
        products.values().next().value?.location_id,
        receiptNumber,
        commandId,
        requestHash,
        supplier.id,
        supplier.name,
        input.supplierInvoiceReference?.trim() || null,
        normalizedReference,
        input.note?.trim() || null,
        user.id,
      ],
    );
    if (!inserted.rows[0]) {
      const concurrent = await client.query<{ id: string; request_hash: string }>(
        `SELECT id, request_hash FROM stock_receipts
          WHERE business_id = $1 AND command_id = $2`,
        [user.businessId, commandId],
      );
      if (concurrent.rows[0]?.request_hash !== requestHash) {
        throw new IdempotencyConflictError();
      }
      const rows = await loadDraft(client, user, concurrent.rows[0].id);
      if (!rows[0]) throw new StockReceiptUnavailableError();
      return draftView(rows, false, true);
    }

    for (const line of input.lines) {
      const product = products.get(line.variantId)!;
      await client.query(
        `INSERT INTO stock_receipt_lines
           (receipt_id, variant_id, quantity_received, sellable_quantity,
            open_box_quantity, damaged_quantity, invoice_unit_cost_paise,
            previous_landed_cost_paise)
         VALUES (
           $1, $2, $3::integer + $4::integer + $5::integer,
           $3, $4, $5, $6, $7
         )`,
        [
          receiptId,
          line.variantId,
          line.sellableQuantity,
          line.openBoxQuantity,
          line.damagedQuantity,
          line.invoiceUnitCostPaise,
          product.latest_landed_cost_paise,
        ],
      );
    }
    await client.query(
      `INSERT INTO audit_events
         (business_id, actor_user_id, event_type, entity_type, entity_id, details)
       VALUES ($1, $2, 'STOCK_RECEIPT_DRAFTED', 'STOCK_RECEIPT', $3, $4)`,
      [
        user.businessId,
        user.id,
        receiptId,
        {
          lineCount: input.lines.length,
          totalQuantity: input.lines.reduce(
            (sum, line) =>
              sum + line.sellableQuantity + line.openBoxQuantity + line.damagedQuantity,
            0,
          ),
          sellableQuantity: input.lines.reduce(
            (sum, line) => sum + line.sellableQuantity,
            0,
          ),
          openBoxQuantity: input.lines.reduce(
            (sum, line) => sum + line.openBoxQuantity,
            0,
          ),
          damagedQuantity: input.lines.reduce(
            (sum, line) => sum + line.damagedQuantity,
            0,
          ),
          supplierName: supplier.name,
        },
      ],
    );
    return draftView(await loadDraft(client, user, receiptId), false);
  });
}

export async function listStockReceiptDrafts(
  user: CurrentUser,
): Promise<StockReceiptDraft[]> {
  requireRole(user.role, ["BUSINESS_OWNER", "TRUSTED_OPERATOR"]);
  const result = await getDatabase().query<DraftRow>(
    `${draftSql}
     WHERE r.business_id = $1 AND r.status = 'DRAFT'
       AND ($2::boolean OR r.created_by = $3)
     ORDER BY r.created_at DESC, l.created_at, l.id
     LIMIT 500`,
    [user.businessId, user.role === "BUSINESS_OWNER", user.id],
  );
  const grouped = new Map<string, DraftRow[]>();
  for (const row of result.rows) {
    grouped.set(row.receipt_id, [...(grouped.get(row.receipt_id) ?? []), row]);
  }
  return [...grouped.values()]
    .slice(0, 50)
    .map((rows) => draftView(rows, user.role === "BUSINESS_OWNER"));
}

export async function completeStockReceiptDraft(
  user: CurrentUser,
  receiptId: string,
  completionCommandId: string,
): Promise<CompleteStockReceiptResult> {
  requireRole(user.role, ["BUSINESS_OWNER"]);

  return inTransaction(async (client) => {
    const prior = await client.query<{
      id: string;
      result_json: Omit<CompleteStockReceiptResult, "replayed">;
    }>(
      `SELECT id, result_json FROM stock_receipts
        WHERE business_id = $1 AND completion_command_id = $2`,
      [user.businessId, completionCommandId],
    );
    if (prior.rows[0]) {
      if (prior.rows[0].id !== receiptId) throw new IdempotencyConflictError();
      return { ...prior.rows[0].result_json, replayed: true };
    }

    const receipt = await client.query<{
      id: string;
      receipt_number: string;
      supplier_name: string;
      location_id: string;
    }>(
      `SELECT id, receipt_number, supplier_name, location_id
         FROM stock_receipts
        WHERE id = $1 AND business_id = $2 AND status = 'DRAFT'
        FOR UPDATE`,
      [receiptId, user.businessId],
    );
    const header = receipt.rows[0];
    if (!header) throw new StockReceiptUnavailableError();

    const lines = await client.query<ReceiptLineRow>(
      `SELECT l.id, l.variant_id, p.name AS product_name, v.sku, r.location_id,
              l.quantity_received, l.sellable_quantity, l.open_box_quantity,
              l.damaged_quantity, l.invoice_unit_cost_paise
         FROM stock_receipt_lines l
         JOIN stock_receipts r ON r.id = l.receipt_id
         JOIN product_variants v ON v.id = l.variant_id AND v.status = 'ACTIVE'
         JOIN products p ON p.id = v.product_id AND p.status = 'ACTIVE'
        WHERE l.receipt_id = $1 AND p.business_id = $2
        ORDER BY l.created_at, l.id`,
      [receiptId, user.businessId],
    );
    const storedLineCount = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM stock_receipt_lines
        WHERE receipt_id = $1`,
      [receiptId],
    );
    if (
      !lines.rows[0] ||
      lines.rows.length !== storedLineCount.rows[0].count
    ) {
      throw new ProductUnavailableError();
    }
    return finishReceipt(
      client,
      user,
      completionCommandId,
      {
        id: header.id,
        receiptNumber: header.receipt_number,
        supplierName: header.supplier_name,
      },
      lines.rows,
    );
  });
}

export async function completeStockReceipt(
  user: CurrentUser,
  commandId: string,
  input: CompleteStockReceiptInput,
): Promise<CompleteStockReceiptResult> {
  requireRole(user.role, ["BUSINESS_OWNER"]);
  const requestHash = inputHash(input);

  return inTransaction(async (client) => {
    const prior = await client.query<{
      request_hash: string;
      result_json: Omit<CompleteStockReceiptResult, "replayed">;
    }>(
      `SELECT request_hash, result_json FROM stock_receipts
        WHERE business_id = $1 AND command_id = $2`,
      [user.businessId, commandId],
    );
    if (prior.rows[0]) {
      if (prior.rows[0].request_hash !== requestHash) throw new IdempotencyConflictError();
      if (!prior.rows[0].result_json) throw new StockReceiptUnavailableError();
      return { ...prior.rows[0].result_json, replayed: true };
    }

    const supplier = await loadSupplier(client, user, input.supplierId);
    const normalizedReference = await protectDuplicateInvoice(client, user, input);
    const products = await loadProducts(client, user, input.lines);
    const receiptId = randomUUID();
    const receiptNumber = `RCV-${receiptId.slice(0, 8).toUpperCase()}`;
    const inserted = await client.query(
      `INSERT INTO stock_receipts
         (id, business_id, location_id, receipt_number, command_id, request_hash,
          supplier_id, supplier_name, supplier_invoice_reference,
          supplier_invoice_reference_normalized, note, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'DRAFT', $12)
       ON CONFLICT (command_id) DO NOTHING
       RETURNING id`,
      [
        receiptId,
        user.businessId,
        products.values().next().value?.location_id,
        receiptNumber,
        commandId,
        requestHash,
        supplier.id,
        supplier.name,
        input.supplierInvoiceReference?.trim() || null,
        normalizedReference,
        input.note?.trim() || null,
        user.id,
      ],
    );
    if (!inserted.rows[0]) {
      const concurrent = await client.query<{
        request_hash: string;
        result_json: Omit<CompleteStockReceiptResult, "replayed">;
      }>(
        `SELECT request_hash, result_json FROM stock_receipts
          WHERE business_id = $1 AND command_id = $2`,
        [user.businessId, commandId],
      );
      if (concurrent.rows[0]?.request_hash !== requestHash) {
        throw new IdempotencyConflictError();
      }
      if (!concurrent.rows[0].result_json) throw new StockReceiptUnavailableError();
      return { ...concurrent.rows[0].result_json, replayed: true };
    }

    const receiptLines: ReceiptLineRow[] = [];
    for (const line of input.lines) {
      const product = products.get(line.variantId)!;
      const receiptLine = await client.query<{ id: string }>(
        `INSERT INTO stock_receipt_lines
           (receipt_id, variant_id, quantity_received, sellable_quantity,
            open_box_quantity, damaged_quantity, invoice_unit_cost_paise,
            previous_landed_cost_paise)
         VALUES (
           $1, $2, $3::integer + $4::integer + $5::integer,
           $3, $4, $5, $6, $7
         )
         RETURNING id`,
        [
          receiptId,
          line.variantId,
          line.sellableQuantity,
          line.openBoxQuantity,
          line.damagedQuantity,
          line.invoiceUnitCostPaise,
          product.latest_landed_cost_paise,
        ],
      );
      receiptLines.push({
        id: receiptLine.rows[0].id,
        variant_id: line.variantId,
        product_name: product.product_name,
        sku: product.sku,
        location_id: product.location_id,
        quantity_received:
          line.sellableQuantity + line.openBoxQuantity + line.damagedQuantity,
        sellable_quantity: line.sellableQuantity,
        open_box_quantity: line.openBoxQuantity,
        damaged_quantity: line.damagedQuantity,
        invoice_unit_cost_paise: String(line.invoiceUnitCostPaise),
      });
    }
    return finishReceipt(
      client,
      user,
      commandId,
      { id: receiptId, receiptNumber, supplierName: supplier.name },
      receiptLines,
    );
  });
}
