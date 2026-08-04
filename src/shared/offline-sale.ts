import {
  offlineDeviceState,
  type OfflineDeviceEnrollment,
} from "@/shared/offline-device";
import type {
  OfflineCatalogProduct,
  OfflineCatalogSnapshot,
} from "@/shared/offline-catalog";

export const OFFLINE_SALE_SCHEMA_VERSION = 1;
export const OFFLINE_GUEST_LIMIT_PAISE = 500_000;

export type OfflineSalePaymentMode = "CASH" | "UPI";
export type OfflineSaleStatus = "QUEUED" | "NEEDS_REVIEW";

export type OfflineSalePayload = {
  lines: Array<{
    variantId: string;
    quantity: number;
    unitPricePaise: number;
  }>;
  payments: Array<{
    paymentMode: OfflineSalePaymentMode;
    amountPaise: number;
  }>;
  offline: {
    schemaVersion: typeof OFFLINE_SALE_SCHEMA_VERSION;
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

export type OfflineSaleCommand = {
  commandId: string;
  commandType: "COMPLETE_GUEST_SALE";
  schemaVersion: typeof OFFLINE_SALE_SCHEMA_VERSION;
  userBinding: string;
  createdAt: string;
  status: OfflineSaleStatus;
  retryCount: number;
  lastResult: {
    code: string;
    message: string;
    at: string;
  } | null;
  display: {
    totalPaise: number;
    units: number;
    paymentMode: OfflineSalePaymentMode;
    products: Array<{
      variantId: string;
      name: string;
      sku: string;
      quantity: number;
    }>;
  };
  payload: OfflineSalePayload;
};

export type OfflineCartLine = {
  variantId: string;
  quantity: number;
  unitPricePaise: number;
};

export class OfflineSaleNotAllowedError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OfflineSaleNotAllowedError";
    this.code = code;
  }
}

export function offlineAvailableQuantity(
  lastKnownStock: number,
  locallyQueuedQuantity: number,
): number {
  return Math.max(0, lastKnownStock - locallyQueuedQuantity - 1);
}

export function queuedQuantityForVariant(
  commands: OfflineSaleCommand[],
  variantId: string,
): number {
  return commands.reduce(
    (total, command) => total + command.payload.lines
      .filter((line) => line.variantId === variantId)
      .reduce((lineTotal, line) => lineTotal + line.quantity, 0),
    0,
  );
}

function requireCatalogProduct(
  products: OfflineCatalogProduct[],
  variantId: string,
): OfflineCatalogProduct {
  const product = products.find((item) => item.id === variantId);
  if (!product || !product.priceVersionId) {
    throw new OfflineSaleNotAllowedError(
      "PRODUCT_NOT_CACHED",
      "Reconnect before selling a product that is not in the saved catalogue.",
    );
  }
  return product;
}

export function buildOfflineSaleCommand(input: {
  commandId: string;
  userBinding: string;
  catalog: OfflineCatalogSnapshot;
  device: OfflineDeviceEnrollment | null;
  queuedCommands: OfflineSaleCommand[];
  lines: OfflineCartLine[];
  paymentMode: OfflineSalePaymentMode;
  now?: Date;
}): OfflineSaleCommand {
  const now = input.now ?? new Date();
  if (offlineDeviceState(input.device, now.getTime()) !== "ACTIVE" || !input.device) {
    throw new OfflineSaleNotAllowedError(
      "DEVICE_NOT_ACTIVE",
      "Reconnect and validate this approved device before queuing an offline sale.",
    );
  }
  if (input.lines.length < 1) {
    throw new OfflineSaleNotAllowedError("EMPTY_CART", "Add a product before checkout.");
  }
  if (new Set(input.lines.map((line) => line.variantId)).size !== input.lines.length) {
    throw new OfflineSaleNotAllowedError(
      "DUPLICATE_PRODUCT",
      "Each product may appear only once in an offline cart.",
    );
  }

  const products = input.lines.map((line) => {
    const product = requireCatalogProduct(input.catalog.products, line.variantId);
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new OfflineSaleNotAllowedError(
        "INVALID_QUANTITY",
        `Enter a valid quantity for ${product.name}.`,
      );
    }
    if (
      !Number.isInteger(line.unitPricePaise)
      || line.unitPricePaise < Math.min(
        product.standardPricePaise,
        product.minimumPricePaise,
      )
      || line.unitPricePaise > product.standardPricePaise
    ) {
      throw new OfflineSaleNotAllowedError(
        "PRICE_NOT_ALLOWED",
        `${product.name} must stay between the saved permitted price and standard price while offline.`,
      );
    }
    const queuedBeforeQuantity = queuedQuantityForVariant(
      input.queuedCommands,
      line.variantId,
    );
    if (
      line.quantity
      > offlineAvailableQuantity(product.stock, queuedBeforeQuantity)
    ) {
      throw new OfflineSaleNotAllowedError(
        "OFFLINE_STOCK_RESERVE",
        `${product.name} cannot use the last known unit while offline.`,
      );
    }
    return { line, product, queuedBeforeQuantity };
  });

  const totalPaise = products.reduce(
    (total, { line }) => total + line.quantity * line.unitPricePaise,
    0,
  );
  if (totalPaise >= OFFLINE_GUEST_LIMIT_PAISE) {
    throw new OfflineSaleNotAllowedError(
      "CUSTOMER_APPROVAL_REQUIRED",
      "Reconnect for a Guest sale of ₹5,000 or more so the customer decision can be approved.",
    );
  }

  const createdAt = now.toISOString();
  const payload: OfflineSalePayload = {
    lines: products.map(({ line }) => line),
    payments: [{ paymentMode: input.paymentMode, amountPaise: totalPaise }],
    offline: {
      schemaVersion: OFFLINE_SALE_SCHEMA_VERSION,
      deviceId: input.device.deviceId,
      devicePublicId: input.device.devicePublicId,
      validatedAt: input.device.lastValidatedAt!,
      createdAt,
      catalogAsOf: input.catalog.asOf,
      lines: products.map(({ line, product, queuedBeforeQuantity }) => ({
        variantId: line.variantId,
        priceVersionId: product.priceVersionId,
        cachedStock: product.stock,
        queuedBeforeQuantity,
      })),
    },
  };

  return {
    commandId: input.commandId,
    commandType: "COMPLETE_GUEST_SALE",
    schemaVersion: OFFLINE_SALE_SCHEMA_VERSION,
    userBinding: input.userBinding,
    createdAt,
    status: "QUEUED",
    retryCount: 0,
    lastResult: null,
    display: {
      totalPaise,
      units: products.reduce((total, { line }) => total + line.quantity, 0),
      paymentMode: input.paymentMode,
      products: products.map(({ line, product }) => ({
        variantId: line.variantId,
        name: product.name,
        sku: product.sku,
        quantity: line.quantity,
      })),
    },
    payload,
  };
}
