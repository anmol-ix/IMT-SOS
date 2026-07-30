import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { CurrentUser } from "./auth/current-user";
import { inTransaction } from "./database";
import { allocateWeightedAverageCost } from "./inventory-costing";
import {
  consumeGuestSaleApproval,
  CustomerOrGuestApprovalRequiredError,
  requireApprovedGuestSale,
} from "./guest-sale-approvals";
import { requiresCustomerPrompt } from "./guest-sale-policy";
import {
  type SalePayment,
  requireExactPayments,
} from "./payment-policy";
import { consumePriceApproval, requireApprovedPrice } from "./price-approvals";
import { IdempotencyConflictError } from "./proof-command";
import { requireOfflineSaleDevice } from "./devices";
import { requireOfflineSalePolicy } from "./offline-sale-policy";
import {
  priceNeedsApproval,
  requirePermittedPrice,
  type PriceExceptionReason,
  requireExceptionReason,
} from "./sale-policy";

export type CompleteSaleLineInput = {
  variantId: string;
  quantity: number;
  unitPricePaise: number;
  approvalId?: string;
  ownerException?: {
    reason: PriceExceptionReason;
    note?: string;
  };
};

export type CompleteSaleInput = {
  saleType?: "RETAIL" | "WHOLESALE";
  lines: CompleteSaleLineInput[];
  customerId?: string;
  guestApprovalId?: string;
  ownerGuestOverride?: boolean;
  payments: SalePayment[];
  offline?: {
    schemaVersion: 1;
    deviceId: string;
    devicePublicId: string;
    validatedAt: string;
    createdAt: string;
    catalogAsOf: string;
    lines: Array<{
      variantId: string;
      priceVersionId: string;
      cachedStock: number;
      queuedBeforeQuantity: number;
    }>;
  };
};

export type CompleteSaleLineResult = {
  variantId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPricePaise: number;
  totalPaise: number;
  remainingStock: number;
  grossProductProfitPaise: number;
  replacementMarginPaise: number;
  remainingInventoryValuePaise: number;
  remainingWeightedAverageCostPaise: number;
};

export type CompleteSaleResult = {
  saleId: string;
  saleNumber: string;
  completedAt: string;
  customerName: string | null;
  saleType: "RETAIL" | "WHOLESALE";
  payments: SalePayment[];
  totalPaise: number;
  lines: CompleteSaleLineResult[];
  grossProductProfitPaise: number;
  replacementMarginPaise: number;
  replayed: boolean;
};

export type CompleteSaleOptions = {
  ownerResolution?: {
    conflictId: string;
    owner: CurrentUser;
    note: string;
    requestHash: string;
  };
};

type ProductRow = {
  variant_id: string;
  product_name: string;
  sku: string;
  location_id: string;
  quantity_on_hand: number;
  price_version_id: string;
  inventory_value_paise: string;
  latest_landed_cost_paise: string;
  mrp_paise: string;
  standard_price_paise: string;
  wholesale_price_paise: string;
  owner_floor_paise: string;
  trusted_operator_floor_paise: string;
  store_operator_floor_paise: string;
};

type SaleLineContext = {
  inputIndex: number;
  input: CompleteSaleLineInput;
  row: ProductRow;
  result: CompleteSaleLineResult;
  accountingCogsPaise: number;
  replacementCostPaise: number;
  exception?: {
    approvalId: string | null;
    reason: PriceExceptionReason;
    note: string | null;
  };
};

export class ProductUnavailableError extends Error {
  readonly status = 404;
  readonly code = "PRODUCT_UNAVAILABLE";

  constructor() {
    super("A product in this cart is not available for sale.");
    this.name = "ProductUnavailableError";
  }
}

export class InsufficientStockError extends Error {
  readonly status = 409;
  readonly code = "INSUFFICIENT_STOCK";

  constructor() {
    super("There is not enough stock to complete this cart.");
    this.name = "InsufficientStockError";
  }
}

export class InvalidSaleLinesError extends Error {
  readonly status = 400;
  readonly code = "INVALID_SALE_LINES";

  constructor() {
    super("Each product may appear only once in a sale.");
    this.name = "InvalidSaleLinesError";
  }
}

export class CustomerUnavailableError extends Error {
  readonly status = 404;
  readonly code = "CUSTOMER_UNAVAILABLE";

  constructor() {
    super("This customer record is unavailable. Find or create the customer again.");
    this.name = "CustomerUnavailableError";
  }
}

export class WholesaleCustomerRequiredError extends Error {
  readonly status = 400;
  readonly code = "WHOLESALE_CUSTOMER_REQUIRED";

  constructor() {
    super("Select the shopkeeper or business customer before completing a Wholesale sale.");
    this.name = "WholesaleCustomerRequiredError";
  }
}

export async function completeSale(
  user: CurrentUser,
  commandId: string,
  input: CompleteSaleInput,
  options: CompleteSaleOptions = {},
): Promise<CompleteSaleResult> {
  const saleType = input.saleType ?? "RETAIL";
  if (input.offline && saleType !== "RETAIL") {
    const error = new Error(
      "Wholesale sales must be completed while connected.",
    ) as Error & { status: number; code: string };
    error.status = 400;
    error.code = "WHOLESALE_ONLINE_REQUIRED";
    throw error;
  }
  const ownerResolution = options.ownerResolution;
  if (
    ownerResolution
    && (
      ownerResolution.owner.role !== "BUSINESS_OWNER"
      || ownerResolution.owner.businessId !== user.businessId
      || !ownerResolution.note.trim()
      || !/^[0-9a-f]{64}$/.test(ownerResolution.requestHash)
    )
  ) {
    const error = new Error("Only this business owner can confirm an offline sale.") as
      Error & { status: number; code: string };
    error.status = 403;
    error.code = "FORBIDDEN";
    throw error;
  }
  const requestHash = ownerResolution?.requestHash
    ?? createHash("sha256").update(JSON.stringify(input)).digest("hex");

  return inTransaction(async (client) => {
    const prior = await client.query<{
      request_hash: string;
      result_json: Omit<CompleteSaleResult, "replayed">;
    }>(
      `SELECT request_hash, result_json
         FROM sales
        WHERE business_id = $1 AND command_id = $2`,
      [user.businessId, commandId],
    );
    if (prior.rows[0]) {
      if (prior.rows[0].request_hash !== requestHash) throw new IdempotencyConflictError();
      return { ...prior.rows[0].result_json, replayed: true };
    }

    if (new Set(input.lines.map((line) => line.variantId)).size !== input.lines.length) {
      throw new InvalidSaleLinesError();
    }
    if (input.offline) {
      const conflict = await client.query<{
        id: string;
        operator_user_id: string;
        request_hash: string;
        status: "PENDING" | "COMPLETED" | "DISMISSED";
      }>(
        `SELECT id, operator_user_id, request_hash, status
           FROM offline_sale_conflicts
          WHERE business_id = $1 AND command_id = $2
          FOR UPDATE`,
        [
          user.businessId,
          commandId,
        ],
      );
      const row = conflict.rows[0];
      if (
        ownerResolution
        && (
          !row
          || row.id !== ownerResolution.conflictId
          || row.operator_user_id !== user.id
          || row.request_hash !== ownerResolution.requestHash
          || row.status !== "PENDING"
        )
      ) {
        const error = new Error(
          "This offline-sale conflict is no longer awaiting a decision.",
        ) as Error & { status: number; code: string };
        error.status = 409;
        error.code = "OFFLINE_CONFLICT_UNAVAILABLE";
        throw error;
      }
      if (!ownerResolution && row?.status === "DISMISSED") {
        const error = new Error(
          "The owner confirmed that this queued command was not a completed sale.",
        ) as Error & { status: number; code: string };
        error.status = 409;
        error.code = "OFFLINE_SALE_DISMISSED";
        throw error;
      }
    }
    requireOfflineSalePolicy(input);
    if (input.offline && !ownerResolution) {
      await requireOfflineSaleDevice(client, user, input.offline);
    }

    const orderedLines = input.lines
      .map((line, inputIndex) => ({ line, inputIndex }))
      .sort((a, b) => a.line.variantId.localeCompare(b.line.variantId));
    const contexts: SaleLineContext[] = [];

    for (const { line, inputIndex } of orderedLines) {
      const product = await client.query<ProductRow>(
        `SELECT
           v.id AS variant_id, p.name AS product_name, v.sku, l.id AS location_id,
           ib.quantity_on_hand, ib.inventory_value_paise, ib.latest_landed_cost_paise,
           pv.id AS price_version_id, pv.mrp_paise, pv.standard_price_paise,
           pv.wholesale_price_paise,
           pv.owner_floor_paise, pv.trusted_operator_floor_paise,
           pv.store_operator_floor_paise
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
         JOIN price_versions pv ON pv.variant_id = v.id AND pv.effective_to IS NULL
         JOIN inventory_balances ib ON ib.variant_id = v.id
         JOIN locations l ON l.id = ib.location_id AND l.status = 'ACTIVE'
         WHERE v.id = $1 AND p.business_id = $2
           AND p.status = 'ACTIVE' AND v.status = 'ACTIVE'
         ORDER BY l.created_at
         LIMIT 1
         FOR UPDATE OF ib`,
        [line.variantId, user.businessId],
      );
      const row = product.rows[0];
      if (!row) throw new ProductUnavailableError();
      if (row.quantity_on_hand < line.quantity) throw new InsufficientStockError();

      const latestLandedCostPaise = Number(row.latest_landed_cost_paise);
      const listedPricePaise = saleType === "WHOLESALE"
        ? Number(row.wholesale_price_paise)
        : Number(row.standard_price_paise);
      const price = {
        standardPricePaise: listedPricePaise,
        ownerFloorPaise: Math.max(Number(row.owner_floor_paise), latestLandedCostPaise),
        trustedOperatorFloorPaise: Math.max(
          Number(row.trusted_operator_floor_paise),
          latestLandedCostPaise,
        ),
        storeOperatorFloorPaise: Math.max(
          Number(row.store_operator_floor_paise),
          latestLandedCostPaise,
        ),
      };
      const totalPaise = line.quantity * line.unitPricePaise;
      const accountingCogsPaise = Number(
        allocateWeightedAverageCost(
          BigInt(row.inventory_value_paise),
          row.quantity_on_hand,
          line.quantity,
        ),
      );
      const replacementCostPaise = latestLandedCostPaise * line.quantity;
      const needsApproval = priceNeedsApproval(line.unitPricePaise, price, user.role);
      let exception: SaleLineContext["exception"];

      if (input.offline) {
        const cached = input.offline.lines.find(
          (item) => item.variantId === line.variantId,
        );
        if (!ownerResolution && cached?.priceVersionId !== row.price_version_id) {
          const error = new Error(
            `${row.product_name} was repriced after this device went offline.`,
          ) as Error & { status: number; code: string };
          error.status = 409;
          error.code = "PRICE_VERSION_CHANGED";
          throw error;
        }
        if (ownerResolution) {
          if (needsApproval || cached?.priceVersionId !== row.price_version_id) {
            exception = {
              approvalId: null,
              reason: "OTHER",
              note: `Owner-confirmed offline sale: ${ownerResolution.note.trim()}`,
            };
          }
        } else {
          requirePermittedPrice(line.unitPricePaise, price, user.role);
        }
      } else if (needsApproval) {
        if (user.role === "BUSINESS_OWNER") {
          requireExceptionReason(line.ownerException?.reason, line.ownerException?.note);
          exception = {
            approvalId: null,
            reason: line.ownerException.reason,
            note: line.ownerException.note?.trim() || null,
          };
        } else {
          const approval = await requireApprovedPrice(client, user, line.approvalId, {
            variantId: line.variantId,
            quantity: line.quantity,
            unitPricePaise: line.unitPricePaise,
            priceVersionId: row.price_version_id,
            replacementUnitCostPaise: latestLandedCostPaise,
            accountingCogsPaise,
          });
          exception = {
            approvalId: approval.id,
            reason: approval.reason,
            note: approval.note,
          };
        }
      }

      const remainingStock = row.quantity_on_hand - line.quantity;
      const remainingInventoryValuePaise =
        Number(row.inventory_value_paise) - accountingCogsPaise;
      contexts.push({
        inputIndex,
        input: line,
        row,
        accountingCogsPaise,
        replacementCostPaise,
        exception,
        result: {
          variantId: row.variant_id,
          productName: row.product_name,
          sku: row.sku,
          quantity: line.quantity,
          unitPricePaise: line.unitPricePaise,
          totalPaise,
          remainingStock,
          grossProductProfitPaise: totalPaise - accountingCogsPaise,
          replacementMarginPaise: totalPaise - replacementCostPaise,
          remainingInventoryValuePaise,
          remainingWeightedAverageCostPaise:
            remainingStock > 0 ? Math.round(remainingInventoryValuePaise / remainingStock) : 0,
        },
      });
    }

    const saleId = randomUUID();
    const saleNumber = `SAL-${saleId.replaceAll("-", "").slice(0, 12).toUpperCase()}`;
    const completedAt = new Date().toISOString();
    const totalPaise = contexts.reduce((sum, line) => sum + line.result.totalPaise, 0);
    requireExactPayments(input.payments, totalPaise);
    const grossProductProfitPaise = contexts.reduce(
      (sum, line) => sum + line.result.grossProductProfitPaise,
      0,
    );
    const replacementMarginPaise = contexts.reduce(
      (sum, line) => sum + line.result.replacementMarginPaise,
      0,
    );
    let customer: { id: string; name: string; phone_normalized: string } | null = null;
    if (input.customerId) {
      const customerResult = await client.query<{
        id: string;
        name: string;
        phone_normalized: string;
      }>(
        `SELECT id, name, phone_normalized
           FROM customers
          WHERE id = $1 AND business_id = $2 AND status = 'ACTIVE'`,
        [input.customerId, user.businessId],
      );
      customer = customerResult.rows[0] ?? null;
      if (!customer) throw new CustomerUnavailableError();
    }
    if (saleType === "WHOLESALE" && !customer) {
      throw new WholesaleCustomerRequiredError();
    }

    let guestApproval: { id: string; reason: "CUSTOMER_DECLINED" } | null = null;
    let guestOverrideReason: "CUSTOMER_DECLINED" | null = null;
    if (!customer && requiresCustomerPrompt(totalPaise)) {
      if (user.role === "BUSINESS_OWNER") {
        if (!input.ownerGuestOverride) throw new CustomerOrGuestApprovalRequiredError();
        guestOverrideReason = "CUSTOMER_DECLINED";
      } else {
        guestApproval = await requireApprovedGuestSale(
          client,
          user,
          input.guestApprovalId,
          commandId,
          input.lines,
          totalPaise,
        );
        guestOverrideReason = guestApproval.reason;
      }
    }
    const lines = contexts
      .sort((a, b) => a.inputIndex - b.inputIndex)
      .map((line) => line.result);
    const result = {
      saleId,
      saleNumber,
      completedAt,
      customerName: customer?.name ?? null,
      saleType,
      payments: input.payments,
      totalPaise,
      lines,
      grossProductProfitPaise,
      replacementMarginPaise,
    };

    const inserted = await client.query(
      `INSERT INTO sales
         (id, sale_number, business_id, location_id, status, total_paise, created_by,
          completed_at, command_id, request_hash, customer_id, customer_name, customer_phone,
          guest_approval_id, guest_override_reason, sales_channel, sale_type, result_json,
          offline_device_id, offline_created_at, offline_catalog_as_of)
       VALUES ($1, $2, $3, $4, 'COMPLETED', $5, $6, $7, $8, $9, $10, $11, $12,
               $13, $14, 'SHOP', $15, $16, $17, $18, $19)
       ON CONFLICT (command_id) WHERE command_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        saleId,
        saleNumber,
        user.businessId,
        contexts[0].row.location_id,
        totalPaise,
        user.id,
        completedAt,
        commandId,
        requestHash,
        customer?.id ?? null,
        customer?.name ?? null,
        customer?.phone_normalized ?? null,
        guestApproval?.id ?? null,
        guestOverrideReason,
        saleType,
        result,
        input.offline?.deviceId ?? null,
        input.offline?.createdAt ?? null,
        input.offline?.catalogAsOf ?? null,
      ],
    );
    if (!inserted.rows[0]) {
      const concurrent = await client.query<{
        request_hash: string;
        result_json: Omit<CompleteSaleResult, "replayed">;
      }>("SELECT request_hash, result_json FROM sales WHERE command_id = $1", [commandId]);
      if (!concurrent.rows[0] || concurrent.rows[0].request_hash !== requestHash) {
        throw new IdempotencyConflictError();
      }
      return { ...concurrent.rows[0].result_json, replayed: true };
    }

    for (const line of contexts) {
      await client.query(
        `INSERT INTO sale_lines
           (sale_id, variant_id, price_version_id, quantity, unit_price_paise,
            replacement_unit_cost_paise, accounting_cogs_paise,
            mrp_paise, standard_price_paise, wholesale_price_paise, price_approval_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          saleId,
          line.row.variant_id,
          line.row.price_version_id,
          line.input.quantity,
          line.input.unitPricePaise,
          line.row.latest_landed_cost_paise,
          line.accountingCogsPaise,
          line.row.mrp_paise,
          line.row.standard_price_paise,
          line.row.wholesale_price_paise,
          line.exception?.approvalId ?? null,
        ],
      );
      if (line.exception?.approvalId) {
        await consumePriceApproval(client, line.exception.approvalId);
      }
      await client.query(
        `UPDATE inventory_balances
            SET quantity_on_hand = quantity_on_hand - $1,
                inventory_value_paise = inventory_value_paise - $2,
                version = version + 1,
                updated_at = now()
          WHERE location_id = $3 AND variant_id = $4`,
        [
          line.input.quantity,
          line.accountingCogsPaise,
          line.row.location_id,
          line.row.variant_id,
        ],
      );
      await client.query(
        `INSERT INTO inventory_movements
           (business_id, location_id, variant_id, movement_type, quantity_delta,
            reference_type, reference_id, created_by)
         VALUES ($1, $2, $3, 'SALE', $4, 'SALE', $5, $6)`,
        [
          user.businessId,
          line.row.location_id,
          line.row.variant_id,
          -line.input.quantity,
          saleId,
          user.id,
        ],
      );
    }
    if (guestApproval) {
      await consumeGuestSaleApproval(client, guestApproval.id);
    }

    for (const payment of input.payments) {
      await client.query(
        `INSERT INTO sale_payments (sale_id, payment_mode, amount_paise)
         VALUES ($1, $2, $3)`,
        [saleId, payment.paymentMode, payment.amountPaise],
      );
    }
    await client.query(
      `INSERT INTO audit_events
         (business_id, actor_user_id, event_type, entity_type, entity_id, details)
       VALUES ($1, $2, 'SALE_COMPLETED', 'SALE', $3, $4)`,
      [
        user.businessId,
        user.id,
        saleId,
        {
          totalPaise,
          saleType,
          payments: input.payments,
          customerId: customer?.id ?? null,
          guestApprovalId: guestApproval?.id ?? null,
          guestOverrideReason,
          offline: input.offline
            ? {
                deviceId: input.offline.deviceId,
                createdAt: input.offline.createdAt,
                catalogAsOf: input.offline.catalogAsOf,
              }
            : null,
          lines: contexts.map((line) => ({
            sku: line.row.sku,
            quantity: line.input.quantity,
            unitPricePaise: line.input.unitPricePaise,
            accountingCogsPaise: line.accountingCogsPaise,
            replacementCostPaise: line.replacementCostPaise,
            priceException: line.exception ?? null,
          })),
        },
      ],
    );
    if (input.offline) {
      const resolved = await client.query<{ id: string }>(
        `UPDATE offline_sale_conflicts
            SET status = 'COMPLETED',
                resolved_by = $1,
                resolved_at = now(),
                resolution_action = $2,
                resolution_note = $3,
                sale_id = $4
          WHERE business_id = $5
            AND command_id = $6
            AND ($7::uuid IS NULL OR id = $7)
            AND status = 'PENDING'
        RETURNING id`,
        [
          ownerResolution?.owner.id ?? null,
          ownerResolution ? "OWNER_CONFIRMED" : "SYNCED_AFTER_RETRY",
          ownerResolution?.note.trim() ?? null,
          saleId,
          user.businessId,
          commandId,
          ownerResolution?.conflictId ?? null,
        ],
      );
      if (resolved.rows[0] && ownerResolution) {
        await client.query(
          `INSERT INTO audit_events
             (business_id, actor_user_id, event_type, entity_type, entity_id, details)
           VALUES ($1, $2, 'OFFLINE_SALE_OWNER_CONFIRMED', 'OFFLINE_SALE_CONFLICT', $3, $4)`,
          [
            user.businessId,
            ownerResolution.owner.id,
            resolved.rows[0].id,
            {
              commandId,
              saleId,
              operatorUserId: user.id,
              note: ownerResolution.note.trim(),
            },
          ],
        );
      }
    }

    return { ...result, replayed: false };
  });
}
