"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  readOfflineCatalog,
  saveOfflineCatalog,
} from "@/client/offline-catalog";
import {
  browserDeviceName,
  getDevicePublicId,
  readOfflineDevice,
  saveOfflineDevice,
} from "@/client/offline-device";
import {
  deleteOfflineSale,
  listOfflineSales,
  saveOfflineSale,
} from "@/client/offline-sales";
import { clearOfflineAccess } from "@/client/offline-storage";
import { useOnlineStatus } from "@/client/use-online-status";
import {
  searchOfflineCatalog,
  type OfflineCatalogSnapshot,
} from "@/shared/offline-catalog";
import {
  offlineDeviceState,
  type OfflineDeviceEnrollment,
} from "@/shared/offline-device";
import {
  buildOfflineSaleCommand,
  offlineAvailableQuantity,
  queuedQuantityForVariant,
  type OfflineSaleCommand,
  type OfflineSalePaymentMode,
} from "@/shared/offline-sale";
import BarcodeScanner from "./BarcodeScanner";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import Modal from "@/components/ui/Modal";

type Product = {
  id: string;
  priceVersionId: string;
  name: string;
  variantName: string | null;
  sku: string;
  barcode: string;
  rackLocation: string | null;
  stock: number;
  mrpPaise: number;
  standardPricePaise: number;
  wholesalePricePaise?: number;
  minimumPricePaise: number;
  inventoryValuePaise?: number;
  latestLandedCostPaise?: number;
  weightedAverageCostPaise?: number;
};

type Props = {
  cacheKey: string;
  userId: string;
  displayName: string;
  role: "BUSINESS_OWNER" | "TRUSTED_OPERATOR" | "STORE_OPERATOR";
  initialProducts: Product[];
  initialSaleType?: SaleType;
  fixedSaleType?: boolean;
};

type PriceApproval = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CONSUMED";
  requestedUnitPricePaise: number;
};

type Customer = {
  id: string;
  name: string;
  phone: string;
  locality: string | null;
  email: string | null;
  totalOrders: number;
  totalSpendPaise: number;
  lastPurchaseAt: string | null;
};

type GuestApproval = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CONSUMED";
  totalPaise: number;
};

type SaleReceipt = {
  saleId: string;
  saleNumber: string;
  completedAt: string;
  customerName: string | null;
  saleType: "RETAIL" | "WHOLESALE";
  payments: Array<{
    paymentMode: "CASH" | "UPI" | "CARD" | "BANK_TRANSFER";
    amountPaise: number;
  }>;
  totalPaise: number;
  lines: Array<{
    variantId: string;
    productName: string;
    sku: string;
    quantity: number;
    unitPricePaise: number;
    totalPaise: number;
  }>;
};

type CartLine = {
  product: Product;
  quantity: number;
  unitPricePaise: number;
  approval: PriceApproval | null;
  exceptionMode: boolean;
  exceptionReason: string;
  exceptionNote: string;
};

type SaleType = "RETAIL" | "WHOLESALE";

const exceptionReasons = [
  ["CLEARANCE", "Clearance"],
  ["DAMAGED_PACKAGING", "Damaged packaging / open box"],
  ["CUSTOMER_SERVICE_RECOVERY", "Customer-service recovery"],
  ["PRICING_CORRECTION", "Pricing correction"],
  ["OTHER", "Other"],
] as const;

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const receiptDate = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

const catalogDate = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

function formatMoney(paise: number) {
  return money.format(paise / 100);
}

function listedPrice(product: Product, saleType: SaleType) {
  return saleType === "WHOLESALE"
    ? product.wholesalePricePaise ?? product.standardPricePaise
    : product.standardPricePaise;
}

function savedAge(iso: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "saved just now";
  if (minutes < 60) return `saved ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `saved ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
}

function paymentLabel(mode: SaleReceipt["payments"][number]["paymentMode"]) {
  if (mode === "UPI") return "UPI";
  return mode === "BANK_TRANSFER"
    ? "Bank transfer"
    : mode.charAt(0) + mode.slice(1).toLowerCase();
}

function shareText(receipt: SaleReceipt) {
  return [
    `ItsMyToy ${receipt.saleType === "WHOLESALE" ? "Wholesale" : "Retail"} sale receipt`,
    receipt.saleNumber,
    receiptDate.format(new Date(receipt.completedAt)),
    "",
    ...receipt.lines.map((line) =>
      `${line.productName} — ${line.quantity} × ${formatMoney(line.unitPricePaise)} = ${formatMoney(line.totalPaise)}`
    ),
    "",
    ...receipt.payments.map((payment) =>
      `${paymentLabel(payment.paymentMode)}: ${formatMoney(payment.amountPaise)}`
    ),
    `Total: ${formatMoney(receipt.totalPaise)}`,
    "",
    "Operational sale receipt — not a GST tax invoice.",
  ].join("\n");
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    if (!copied) throw new Error("Copy failed");
  }
}

function deviceStateCopy(enrollment: OfflineDeviceEnrollment | null) {
  const state = offlineDeviceState(enrollment);
  if (state === "ACTIVE") {
    return {
      title: "This device is enrolled",
      detail: enrollment?.graceExpiresAt
        ? `Validated until ${catalogDate.format(new Date(enrollment.graceExpiresAt))}`
        : "Device validation is current.",
    };
  }
  if (state === "PENDING") {
    return {
      title: "Device approval pending",
      detail: "An owner must approve this device before future offline sales are enabled.",
    };
  }
  if (state === "REVOKED") {
    return {
      title: "Offline access revoked",
      detail: "Online selling still works. This device cannot receive offline selling access.",
    };
  }
  if (state === "EXPIRED") {
    return {
      title: "Offline validation expired",
      detail: "Reconnect to validate this device. The saved catalogue remains read only.",
    };
  }
  return {
    title: "Device enrollment unavailable",
    detail: "Reconnect to register this browser for bounded offline access.",
  };
}

export default function SellWorkspace({
  cacheKey,
  userId,
  displayName,
  role,
  initialProducts,
  initialSaleType = "RETAIL",
  fixedSaleType = false,
}: Props) {
  const online = useOnlineStatus();
  const [query, setQuery] = useState("");
  const [saleType, setSaleType] = useState<SaleType>(initialSaleType);
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [selected, setSelected] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [unitPrice, setUnitPrice] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [paymentMode, setPaymentMode] = useState("UPI");
  const [splitPayment, setSplitPayment] = useState(false);
  const [secondPaymentMode, setSecondPaymentMode] = useState("CASH");
  const [firstPaymentRupees, setFirstPaymentRupees] = useState("");
  const [showCustomerFinder, setShowCustomerFinder] = useState(false);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerLocality, setCustomerLocality] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerLoading, setCustomerLoading] = useState(false);
  const [guestApproval, setGuestApproval] = useState<GuestApproval | null>(null);
  const [guestApprovalLoading, setGuestApprovalLoading] = useState(false);
  const [ownerGuestOverride, setOwnerGuestOverride] = useState(false);
  const [receipt, setReceipt] = useState<SaleReceipt | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [commandId, setCommandId] = useState(() => crypto.randomUUID());
  const [showLowerPrice, setShowLowerPrice] = useState(false);
  const [lowerPriceRupees, setLowerPriceRupees] = useState("");
  const [approval, setApproval] = useState<PriceApproval | null>(null);
  const [checkingApproval, setCheckingApproval] = useState(false);
  const [exceptionMode, setExceptionMode] = useState(false);
  const [exceptionReason, setExceptionReason] = useState("CUSTOMER_SERVICE_RECOVERY");
  const [exceptionNote, setExceptionNote] = useState("");
  const [offlineCatalog, setOfflineCatalog] =
    useState<OfflineCatalogSnapshot | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [offlineDevice, setOfflineDevice] =
    useState<OfflineDeviceEnrollment | null>(null);
  const [deviceStatus, setDeviceStatus] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [offlineSales, setOfflineSales] = useState<OfflineSaleCommand[]>([]);
  const [syncingOfflineSales, setSyncingOfflineSales] = useState(false);
  const syncingOfflineSalesRef = useRef(false);

  const refreshOfflineCatalog = useCallback(async () => {
    if (!navigator.onLine) return;
    try {
      const response = await fetch("/api/v1/catalog/offline");
      if (!response.ok) throw new Error("Catalogue snapshot unavailable");
      const snapshot = await response.json() as OfflineCatalogSnapshot;
      await saveOfflineCatalog(cacheKey, snapshot);
      setOfflineCatalog(snapshot);
      setCatalogStatus("ready");
    } catch {
      const cached = await readOfflineCatalog(cacheKey).catch(() => null);
      setOfflineCatalog(cached);
      setCatalogStatus(cached ? "ready" : "unavailable");
    }
  }, [cacheKey]);

  const refreshDeviceEnrollment = useCallback(async () => {
    if (!navigator.onLine) return;
    try {
      const devicePublicId = await getDevicePublicId(cacheKey);
      const response = await fetch("/api/v1/devices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          devicePublicId,
          displayName: browserDeviceName(),
        }),
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          await clearOfflineAccess();
          setOfflineDevice(null);
          setDeviceStatus("unavailable");
          return;
        }
        throw new Error("Device enrollment unavailable");
      }
      const { device } = await response.json() as {
        device: OfflineDeviceEnrollment;
      };
      await saveOfflineDevice(cacheKey, device);
      setOfflineDevice(device);
      setDeviceStatus("ready");
    } catch {
      const cached = await readOfflineDevice(cacheKey).catch(() => null);
      setOfflineDevice(cached);
      setDeviceStatus(cached ? "ready" : "unavailable");
    }
  }, [cacheKey]);

  useEffect(() => {
    if (online) {
      queueMicrotask(() => void refreshOfflineCatalog());
      return;
    }
    void readOfflineCatalog(cacheKey)
      .then((cached) => {
        setOfflineCatalog(cached);
        setCatalogStatus(cached ? "ready" : "unavailable");
      })
      .catch(() => setCatalogStatus("unavailable"));
  }, [cacheKey, online, refreshOfflineCatalog]);

  useEffect(() => {
    if (online) {
      queueMicrotask(() => void refreshDeviceEnrollment());
      return;
    }
    void readOfflineDevice(cacheKey)
      .then((cached) => {
        setOfflineDevice(cached);
        setDeviceStatus(cached ? "ready" : "unavailable");
      })
      .catch(() => setDeviceStatus("unavailable"));
  }, [cacheKey, online, refreshDeviceEnrollment]);

  const refreshOfflineSales = useCallback(async () => {
    const commands = await listOfflineSales(userId).catch(() => []);
    setOfflineSales(commands);
    return commands;
  }, [userId]);

  useEffect(() => {
    queueMicrotask(() => void refreshOfflineSales());
  }, [refreshOfflineSales]);

  useEffect(() => {
    if (!online) {
      queueMicrotask(() => {
        setSelectedCustomer(null);
        setShowCustomerFinder(false);
        setGuestApproval(null);
        setOwnerGuestOverride(false);
      });
    }
  }, [online]);

  const syncOfflineSales = useCallback(async (retryNeedsReview = false) => {
    if (
      !navigator.onLine
      || syncingOfflineSalesRef.current
      || offlineDeviceState(offlineDevice) !== "ACTIVE"
    ) return;
    syncingOfflineSalesRef.current = true;
    setSyncingOfflineSales(true);
    let stopped = false;
    try {
      let storedCommands = await listOfflineSales(userId);
      try {
        const conflictResponse = await fetch("/api/v1/offline-sale-conflicts");
        if (conflictResponse.ok) {
          const conflictBody = await conflictResponse.json() as {
            conflicts: Array<{
              commandId: string;
              status: "PENDING" | "COMPLETED" | "DISMISSED";
            }>;
          };
          const resolvedIds = new Set(
            conflictBody.conflicts
              .filter((conflict) => conflict.status !== "PENDING")
              .map((conflict) => conflict.commandId),
          );
          for (const command of storedCommands) {
            if (resolvedIds.has(command.commandId)) {
              await deleteOfflineSale(command.commandId);
            }
          }
          if (resolvedIds.size) storedCommands = await listOfflineSales(userId);
        }
      } catch {
        // Conflict status is helpful, but it must never block a normal retry.
      }
      const commands = storedCommands.filter(
        (command) => retryNeedsReview || command.status === "QUEUED",
      );
      for (const command of commands) {
        const response = await fetch("/api/v1/sales", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": command.commandId,
          },
          body: JSON.stringify(command.payload),
        });
        const body = await response.json().catch(() => null);
        if (response.ok) {
          await deleteOfflineSale(command.commandId);
          const results = new Map<string, { remainingStock: number }>(
            (body?.sale?.lines ?? []).map((line: {
              variantId: string;
              remainingStock: number;
            }) => [line.variantId, line]),
          );
          setProducts((current) => current.map((product) => {
            const result = results.get(product.id);
            return result ? { ...product, stock: result.remainingStock } : product;
          }));
          continue;
        }
        const lastResult = {
          code: body?.error?.code ?? "SYNC_FAILED",
          message: body?.error?.message ?? "This queued sale needs review.",
          at: new Date().toISOString(),
        };
        await saveOfflineSale({
          ...command,
          status: "NEEDS_REVIEW",
          retryCount: command.retryCount + 1,
          lastResult,
        });
        if (response.status !== 401) {
          await fetch("/api/v1/offline-sale-conflicts", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              commandId: command.commandId,
              payload: command.payload,
              display: command.display,
              error: {
                code: lastResult.code,
                message: lastResult.message,
              },
            }),
          }).catch(() => null);
        }
        if (
          response.status === 401
          || response.status === 403
          || body?.error?.code === "COMMAND_SCHEMA_UNSUPPORTED"
        ) {
          stopped = true;
          break;
        }
      }
      const remaining = await refreshOfflineSales();
      if (commands.length > 0) {
        if (remaining.length === 0) {
          setMessage(`${commands.length} queued ${commands.length === 1 ? "sale" : "sales"} synced safely.`);
          void refreshOfflineCatalog();
        } else if (stopped) {
          setError("Queued-sale sync stopped. Revalidate this device or ask an owner to review it.");
        } else {
          setError(`${remaining.length} queued ${remaining.length === 1 ? "sale needs" : "sales need"} review.`);
        }
      }
    } catch {
      await refreshOfflineSales();
      setError("Queued-sale sync was interrupted. It will retry after the connection is stable.");
    } finally {
      syncingOfflineSalesRef.current = false;
      setSyncingOfflineSales(false);
    }
  }, [offlineDevice, refreshOfflineCatalog, refreshOfflineSales, userId]);

  useEffect(() => {
    if (online && offlineDeviceState(offlineDevice) === "ACTIVE") {
      queueMicrotask(() => void syncOfflineSales());
    }
  }, [offlineDevice, online, syncOfflineSales]);

  function resetGuestDecision() {
    setGuestApproval(null);
    setOwnerGuestOverride(false);
  }

  function clearPriceException() {
    setShowLowerPrice(false);
    setLowerPriceRupees("");
    setApproval(null);
    setExceptionMode(false);
    setExceptionReason("CUSTOMER_SERVICE_RECOVERY");
    setExceptionNote("");
  }

  function selectRegularPrice(price: number) {
    setUnitPrice(price);
    clearPriceException();
  }

  function changeQuantity(nextQuantity: number, product: Product) {
    setQuantity(nextQuantity);
    if (approval || exceptionMode) {
      setUnitPrice(listedPrice(product, saleType));
      clearPriceException();
    }
  }

  function chooseSaleType(nextSaleType: SaleType) {
    if (nextSaleType === saleType) return;
    if (cart.length && !window.confirm("Switching the sale type will clear the current cart. Continue?")) {
      return;
    }
    setSaleType(nextSaleType);
    setCart([]);
    setSelected(null);
    setSelectedCustomer(null);
    setCustomerResults([]);
    resetGuestDecision();
    clearPriceException();
    setCommandId(crypto.randomUUID());
    setMessage("");
    setError("");
  }

  function chooseProduct(product: Product) {
    const existing = cart.find((line) => line.product.id === product.id);
    setShowScanner(false);
    setSelected(product);
    setUnitPrice(existing?.unitPricePaise ?? listedPrice(product, saleType));
    setQuantity(existing?.quantity ?? 1);
    setApproval(existing?.approval ?? null);
    setExceptionMode(existing?.exceptionMode ?? false);
    setExceptionReason(existing?.exceptionReason ?? "CUSTOMER_SERVICE_RECOVERY");
    setExceptionNote(existing?.exceptionNote ?? "");
    setShowLowerPrice(existing?.exceptionMode ?? false);
    setLowerPriceRupees(
      existing?.exceptionMode ? (existing.unitPricePaise / 100).toFixed(2) : "",
    );
    setMessage("");
    setError("");
  }

  async function findCachedProducts(search: string, liveFallback = false) {
    const cached = offlineCatalog
      ?? await readOfflineCatalog(cacheKey).catch(() => null);
    if (!cached) {
      setCatalogStatus("unavailable");
      setError(
        "No saved catalogue is available on this device. Reconnect once to prepare offline lookup.",
      );
      return false;
    }

    const matches = searchOfflineCatalog(cached.products, search);
    setOfflineCatalog(cached);
    setCatalogStatus("ready");
    setProducts(matches);
    if (search.trim() && matches.length === 0) {
      setError(`No saved product found for “${search.trim()}”.`);
      return false;
    }
    if (matches.length === 1) chooseProduct(matches[0]);
    setMessage(
      `${liveFallback ? "Live lookup unavailable. " : ""}Using catalogue saved ${catalogDate.format(new Date(cached.asOf))}. Stock may have changed.`,
    );
    return true;
  }

  async function findProducts(search = query) {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      if (!navigator.onLine) return await findCachedProducts(search);

      const response = await fetch(`/api/v1/catalog?q=${encodeURIComponent(search)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Products could not be loaded.");
      setProducts(body.products);
      if (search.trim() && body.products.length === 0) {
        setError(`No product found for “${search.trim()}”. Check the label or search manually.`);
        return false;
      }
      if (body.products.length === 1) chooseProduct(body.products[0]);
      return true;
    } catch {
      if (await findCachedProducts(search, true)) return true;
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    setShowScanner(false);
    await findProducts();
  }

  async function useScannedBarcode(barcode: string) {
    setShowScanner(false);
    setQuery(barcode);
    if (await findProducts(barcode)) {
      setMessage(
        navigator.onLine
          ? `Barcode ${barcode} scanned.`
          : `Barcode ${barcode} found in the saved catalogue. Stock may have changed.`,
      );
    }
  }

  function saveCartLine(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    if (!navigator.onLine && saleType === "WHOLESALE") {
      setError("Reconnect before preparing a Wholesale sale.");
      return;
    }
    const cachedProduct = offlineCatalog?.products.find(
      (product) => product.id === selected.id,
    );
    const queuedQuantity = queuedQuantityForVariant(offlineSales, selected.id);
    const availableQuantity = navigator.onLine
      ? selected.stock
      : cachedProduct
        ? offlineAvailableQuantity(cachedProduct.stock, queuedQuantity)
        : 0;
    if (
      !navigator.onLine
      && (
        offlineDeviceState(offlineDevice) !== "ACTIVE"
        || !cachedProduct
      )
    ) {
      setError("Reconnect and validate this approved device before building an offline sale.");
      return;
    }
    if (quantity > availableQuantity) {
      setError("There is not enough stock for this quantity.");
      return;
    }
    if (
      !navigator.onLine
      && (
        exceptionMode
        || approval
        || unitPrice < cachedProduct!.minimumPricePaise
        || unitPrice > cachedProduct!.standardPricePaise
      )
    ) {
      setError("Offline prices must stay within the saved permitted range.");
      return;
    }
    if (approval?.status === "PENDING") {
      setError("Wait for the owner decision or cancel the lower-price request.");
      return;
    }
    if (exceptionMode && role !== "BUSINESS_OWNER" && approval?.status !== "APPROVED") {
      setError("Wait for owner approval before adding this lower price.");
      return;
    }
    if (role === "BUSINESS_OWNER" && exceptionMode && exceptionReason === "OTHER" && !exceptionNote.trim()) {
      setError("Add a note when the owner exception reason is Other.");
      return;
    }

    const line: CartLine = {
      product: selected,
      quantity,
      unitPricePaise: unitPrice,
      approval,
      exceptionMode,
      exceptionReason,
      exceptionNote: exceptionNote.trim(),
    };
    setCart((current) => {
      const index = current.findIndex((item) => item.product.id === selected.id);
      if (index < 0) return [...current, line];
      return current.map((item, itemIndex) => itemIndex === index ? line : item);
    });
    setMessage(`${selected.name} ${cart.some((item) => item.product.id === selected.id) ? "updated" : "added"}.`);
    setSelected(null);
    clearPriceException();
    resetGuestDecision();
    setCommandId(crypto.randomUUID());
  }

  function removeCartLine(variantId: string) {
    setCart((current) => current.filter((line) => line.product.id !== variantId));
    if (selected?.id === variantId) setSelected(null);
    resetGuestDecision();
    setCommandId(crypto.randomUUID());
  }

  function saleLines() {
    return cart.map((line) => ({
      variantId: line.product.id,
      quantity: line.quantity,
      unitPricePaise: line.unitPricePaise,
    }));
  }

  async function submitSale(event: FormEvent) {
    event.preventDefault();
    if (cart.length === 0) return;
    if (!navigator.onLine) {
      if (saleType === "WHOLESALE") {
        setError("Wholesale sales must be completed while connected.");
        return;
      }
      if (cart.some((line) => line.approval || line.exceptionMode)) {
        setError("Approved or exceptional prices cannot be queued offline.");
        return;
      }
      setSubmitting(true);
      setError("");
      try {
        const catalog = offlineCatalog ?? await readOfflineCatalog(cacheKey);
        if (!catalog) {
          throw new Error("No saved catalogue is available for this offline sale.");
        }
        const queuedCommands = await listOfflineSales(userId);
        const command = buildOfflineSaleCommand({
          commandId,
          userBinding: userId,
          catalog,
          device: offlineDevice,
          queuedCommands,
          lines: saleLines(),
          paymentMode: (
            ["CASH", "UPI"].includes(paymentMode) ? paymentMode : "UPI"
          ) as OfflineSalePaymentMode,
        });
        await saveOfflineSale(command);
        await refreshOfflineSales();
        setCart([]);
        setSelected(null);
        setSelectedCustomer(null);
        resetGuestDecision();
        setCommandId(crypto.randomUUID());
        setMessage(
          `Sale queued on this device · ${command.display.units} units · ${formatMoney(command.display.totalPaise)}. It is not synced yet.`,
        );
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Sale could not be queued.");
      } finally {
        setSubmitting(false);
      }
      return;
    }
    if (splitPayment && !splitPaymentValid) {
      setError("Enter a first payment amount above ₹0 and below the cart total.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/v1/sales", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": commandId,
        },
        body: JSON.stringify({
          saleType,
          lines: cart.map((line) => ({
            variantId: line.product.id,
            quantity: line.quantity,
            unitPricePaise: line.unitPricePaise,
            approvalId: line.approval?.status === "APPROVED" ? line.approval.id : undefined,
            ownerException: role === "BUSINESS_OWNER" && line.exceptionMode
              ? {
                  reason: line.exceptionReason,
                  note: line.exceptionNote || undefined,
                }
              : undefined,
          })),
          payments: splitPayment
            ? [
                { paymentMode, amountPaise: firstPaymentPaise },
                { paymentMode: secondPaymentMode, amountPaise: secondPaymentPaise },
              ]
            : [{ paymentMode, amountPaise: cartTotal }],
          customerId: selectedCustomer?.id,
          guestApprovalId: guestApproval?.status === "APPROVED"
            ? guestApproval.id
            : undefined,
          ownerGuestOverride: role === "BUSINESS_OWNER"
            ? ownerGuestOverride
            : undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Sale could not be completed.");

      const ownerResult = body.sale.grossProductProfitPaise === undefined
        ? ""
        : ` · Gross ${formatMoney(body.sale.grossProductProfitPaise)}`;
      setMessage(
        `Sale complete · ${body.sale.lines.length} products · ${formatMoney(body.sale.totalPaise)}${ownerResult}`,
      );
      setReceipt(body.sale);
      const results = new Map<string, {
        remainingStock: number;
        remainingInventoryValuePaise?: number;
        remainingWeightedAverageCostPaise?: number;
      }>(body.sale.lines.map((line: {
        variantId: string;
        remainingStock: number;
        remainingInventoryValuePaise?: number;
        remainingWeightedAverageCostPaise?: number;
      }) => [line.variantId, line]));
      setProducts((current) => current.map((product) => {
        const result = results.get(product.id);
        if (!result) return product;
        return {
          ...product,
          stock: result.remainingStock,
          ...(result.remainingInventoryValuePaise === undefined
            ? {}
            : {
                inventoryValuePaise: result.remainingInventoryValuePaise,
                weightedAverageCostPaise: result.remainingWeightedAverageCostPaise,
              }),
        };
      }));
      void refreshOfflineCatalog();
      setCart([]);
      setSelected(null);
      setSelectedCustomer(null);
      setCustomerResults([]);
      setCustomerQuery("");
      setCustomerName("");
      setCustomerPhone("");
      setCustomerLocality("");
      setCustomerEmail("");
      setShowCustomerFinder(false);
      setShowNewCustomer(false);
      setSplitPayment(false);
      setFirstPaymentRupees("");
      resetGuestDecision();
      setCommandId(crypto.randomUUID());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sale could not be completed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function shareReceipt() {
    if (!receipt) return;
    const text = shareText(receipt);
    if (navigator.share) {
      try {
        await navigator.share({
          title: `ItsMyToy ${receipt.saleNumber}`,
          text,
        });
        setMessage("Receipt shared.");
        return;
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
      }
    }
    try {
      await copyText(text);
      setMessage("Receipt copied. Paste it into WhatsApp or another app.");
    } catch {
      setError("Receipt could not be shared. Try again.");
    }
  }

  async function findCustomers() {
    setCustomerLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/v1/customers?q=${encodeURIComponent(customerQuery)}`,
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Customers could not be loaded.");
      setCustomerResults(body.customers);
      setShowNewCustomer(body.customers.length === 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Customers could not be loaded.");
    } finally {
      setCustomerLoading(false);
    }
  }

  async function createCustomer() {
    setCustomerLoading(true);
    setError("");
    try {
      const response = await fetch("/api/v1/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: customerName,
          phone: customerPhone,
          locality: customerLocality.trim() || undefined,
          email: customerEmail.trim() || undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Customer could not be saved.");
      setSelectedCustomer(body.customer);
      setShowCustomerFinder(false);
      setShowNewCustomer(false);
      resetGuestDecision();
      setMessage("Customer saved and selected for this sale.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Customer could not be saved.");
    } finally {
      setCustomerLoading(false);
    }
  }

  async function requestGuestApproval() {
    setGuestApprovalLoading(true);
    setError("");
    try {
      const response = await fetch("/api/v1/guest-sale-approvals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ saleCommandId: commandId, lines: saleLines() }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error?.message ?? "Guest sale approval could not be requested.");
      }
      setGuestApproval(body.approval);
      setMessage("Customer-declined Guest request sent to a business owner.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Guest sale approval could not be requested.",
      );
    } finally {
      setGuestApprovalLoading(false);
    }
  }

  async function checkGuestApproval() {
    if (!guestApproval) return;
    setGuestApprovalLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/guest-sale-approvals/${guestApproval.id}`);
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error?.message ?? "Guest sale approval could not be checked.");
      }
      setGuestApproval(body.approval);
      if (body.approval.status === "APPROVED") {
        setMessage("Owner approved this exact cart as a Guest sale for 30 minutes.");
      } else if (body.approval.status !== "PENDING") {
        setError(`This request is ${body.approval.status.toLowerCase()}.`);
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Guest sale approval could not be checked.",
      );
    } finally {
      setGuestApprovalLoading(false);
    }
  }

  async function requestLowerPrice() {
    if (!selected) return;
    const requestedUnitPricePaise = Math.round(Number(lowerPriceRupees) * 100);
    if (
      !Number.isInteger(requestedUnitPricePaise) ||
      requestedUnitPricePaise <= 0 ||
      requestedUnitPricePaise >= selected.minimumPricePaise
    ) {
      setError(`Enter a price below ${formatMoney(selected.minimumPricePaise)} and above ₹0.`);
      return;
    }
    setError("");
    if (role === "BUSINESS_OWNER") {
      setUnitPrice(requestedUnitPricePaise);
      setExceptionMode(true);
      setApproval(null);
      return;
    }

    setCheckingApproval(true);
    try {
      const response = await fetch("/api/v1/price-approvals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          variantId: selected.id,
          quantity,
          requestedUnitPricePaise,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Approval could not be requested.");
      setApproval(body.approval);
      setMessage("Lower-price request sent to a business owner.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Approval could not be requested.");
    } finally {
      setCheckingApproval(false);
    }
  }

  async function checkApproval() {
    if (!approval) return;
    setCheckingApproval(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/price-approvals/${approval.id}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Approval could not be checked.");
      setApproval(body.approval);
      if (body.approval.status === "APPROVED") {
        setUnitPrice(body.approval.requestedUnitPricePaise);
        setExceptionMode(true);
        setMessage("Owner approved this exact price for 30 minutes.");
      } else if (body.approval.status !== "PENDING") {
        setError(`This request is ${body.approval.status.toLowerCase()}. Request a new price.`);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Approval could not be checked.");
    } finally {
      setCheckingApproval(false);
    }
  }

  const selectedTotal = selected ? unitPrice * quantity : 0;
  const customerSaving = selected ? (selected.mrpPaise - unitPrice) * quantity : 0;
  const selectedListedPrice = selected ? listedPrice(selected, saleType) : 0;
  const maxExtraDiscount = selected
    ? selectedListedPrice - selected.minimumPricePaise
    : 0;
  const expectedAccountingCogs = selected?.inventoryValuePaise === undefined || selected.stock < 1
    ? undefined
    : quantity === selected.stock
      ? selected.inventoryValuePaise
      : Math.round(selected.inventoryValuePaise * quantity / selected.stock);
  const expectedGrossProfit = expectedAccountingCogs === undefined
    ? undefined
    : selectedTotal - expectedAccountingCogs;
  const expectedReplacementMargin = selected?.latestLandedCostPaise === undefined
    ? undefined
    : selectedTotal - selected.latestLandedCostPaise * quantity;
  const cartTotal = cart.reduce(
    (sum, line) => sum + line.quantity * line.unitPricePaise,
    0,
  );
  const cartUnits = cart.reduce((sum, line) => sum + line.quantity, 0);
  const firstPaymentPaise = Math.round(Number(firstPaymentRupees) * 100);
  const secondPaymentPaise = cartTotal - firstPaymentPaise;
  const splitPaymentValid = Number.isInteger(firstPaymentPaise)
    && firstPaymentPaise > 0
    && secondPaymentPaise > 0
    && paymentMode !== secondPaymentMode;
  const requiresCustomer = saleType === "WHOLESALE" || cartTotal >= 500_000;
  const guestCompletionReady = saleType === "WHOLESALE"
    ? Boolean(selectedCustomer)
    : !requiresCustomer
      || Boolean(selectedCustomer)
      || (role === "BUSINESS_OWNER"
        ? ownerGuestOverride
        : guestApproval?.status === "APPROVED");
  const offlineSellingReady = !online
    && saleType === "RETAIL"
    && Boolean(offlineCatalog)
    && offlineDeviceState(offlineDevice) === "ACTIVE";
  const selectedQueuedQuantity = selected
    ? queuedQuantityForVariant(offlineSales, selected.id)
    : 0;
  const selectedCachedProduct = selected
    ? offlineCatalog?.products.find((product) => product.id === selected.id)
    : null;
  const selectedAvailableQuantity = online
    ? selected?.stock ?? 0
    : selectedCachedProduct
      ? offlineAvailableQuantity(
          selectedCachedProduct.stock,
          selectedQueuedQuantity,
        )
      : 0;
  const needsReviewCount = offlineSales.filter(
    (command) => command.status === "NEEDS_REVIEW",
  ).length;
  const queuedSalesBlockOnlineCheckout = online && offlineSales.length > 0;

  return (
    <AppShell displayName={displayName} role={role}>
      <section className="sell-page sale-workspace-page" aria-labelledby="sell-heading">
        <PageHeader
          eyebrow={receipt
            ? `${receipt.saleType === "WHOLESALE" ? "Wholesale" : "Retail"} sale complete`
            : `${saleType === "WHOLESALE" ? "Wholesale" : "Retail"} sale`}
          headingId="sell-heading"
          title={receipt ? "Receipt ready" : "Create sale"}
          description={receipt
            ? "The sale, payments and stock deduction were saved together."
            : saleType === "WHOLESALE"
              ? "Select the shopkeeper, add products at their Wholesale prices and collect payment."
              : "Scan a product, apply the permitted Retail price and collect payment."}
        />

        {!receipt && !fixedSaleType && (
          <div className="sale-type-switch" aria-label="Choose Retail or Wholesale sale">
            <button
              type="button"
              className={saleType === "RETAIL" ? "active" : ""}
              onClick={() => chooseSaleType("RETAIL")}
              aria-pressed={saleType === "RETAIL"}
            >
              <strong>Retail</strong>
              <span>Walk-in or household customer</span>
            </button>
            <button
              type="button"
              className={saleType === "WHOLESALE" ? "active" : ""}
              onClick={() => chooseSaleType("WHOLESALE")}
              aria-pressed={saleType === "WHOLESALE"}
              disabled={!online}
            >
              <strong>Wholesale</strong>
              <span>Shopkeeper or business customer</span>
            </button>
          </div>
        )}

        {!receipt && <form className="search-bar" onSubmit={search}>
          <label htmlFor="product-search">Scan or enter SKU, barcode or product name</label>
          <div className="search-row">
            <input
              id="product-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Example: IMT-CAR-RC-0001-RED"
              autoComplete="off"
              enterKeyHint="search"
            />
            <button type="submit" disabled={loading}>
              {loading ? "Finding…" : online ? "Find" : "Find saved"}
            </button>
            <button
              type="button"
              className="scan-trigger"
              onClick={() => {
                setShowScanner(true);
                setMessage("");
                setError("");
              }}
            >
              Scan barcode
            </button>
          </div>
        </form>}

        {!receipt && (
          <details className="offline-readiness-disclosure">
            <summary>
              <span>
                <strong>{online ? "Online selling ready" : "Offline mode"}</strong>
                <small>Device, saved catalogue and pending sync status</small>
              </span>
              <b>{offlineSales.length ? `${offlineSales.length} waiting` : "No sales waiting"}</b>
            </summary>
          <div className="offline-readiness" role="status">
            <div
              className={`catalog-sync-state ${online ? catalogStatus : "offline"}`}
            >
              <span aria-hidden="true">{online ? "✓" : "!"}</span>
              <div>
                <strong>
                  {online
                    ? catalogStatus === "ready"
                      ? "Offline lookup ready"
                      : catalogStatus === "loading"
                        ? "Preparing offline lookup"
                        : "Offline lookup unavailable"
                    : offlineCatalog
                      ? "Saved catalogue — read only"
                      : "No saved catalogue on this device"}
                </strong>
                <small>
                  {offlineCatalog
                    ? `${offlineCatalog.products.length} products · ${savedAge(offlineCatalog.asOf)} · ${catalogDate.format(new Date(offlineCatalog.asOf))}${online ? "" : " · server stock may now be lower"}`
                    : online
                      ? "Keep this screen open while the catalogue is prepared."
                      : "Reconnect once before using offline product lookup."}
                </small>
              </div>
              {online && catalogStatus === "unavailable" && (
                <button type="button" onClick={() => void refreshOfflineCatalog()}>
                  Retry
                </button>
              )}
            </div>
            <div className={`device-readiness ${offlineDeviceState(offlineDevice).toLowerCase()}`}>
              <span aria-hidden="true">◉</span>
              <div>
                <strong>
                  {deviceStatus === "loading"
                    ? "Checking this device"
                    : deviceStateCopy(offlineDevice).title}
                </strong>
                <small>
                  {deviceStatus === "loading"
                    ? "This does not interrupt online selling."
                    : deviceStateCopy(offlineDevice).detail}
                </small>
              </div>
            </div>
            <div className={`offline-queue-state${needsReviewCount ? " review" : ""}`}>
              <span aria-hidden="true">{needsReviewCount ? "!" : "↻"}</span>
              <div>
                <strong>
                  {offlineSales.length === 0
                    ? "No sales waiting to sync"
                    : `${offlineSales.length} ${offlineSales.length === 1 ? "sale" : "sales"} saved on this device`}
                </strong>
                <small>
                  {syncingOfflineSales
                    ? "Syncing in sale order…"
                    : needsReviewCount
                      ? `${needsReviewCount} need owner review; they still count against offline stock.`
                      : offlineSales.length
                        ? online
                          ? "Ready to sync after device validation."
                          : "They will sync in order after reconnecting."
                        : "Offline sales will remain visible here until the server accepts them."}
                </small>
              </div>
              {online && offlineSales.length > 0 && (
                <button
                  type="button"
                  onClick={() => void syncOfflineSales(needsReviewCount > 0)}
                  disabled={syncingOfflineSales}
                >
                  {syncingOfflineSales
                    ? "Syncing…"
                    : needsReviewCount
                      ? "Retry review"
                      : "Sync now"}
                </button>
              )}
            </div>
            {offlineSales.length > 0 && (
              <div className="offline-queue-list">
                {offlineSales.map((command) => (
                  <div key={command.commandId}>
                    <span>
                      <strong>
                        {command.display.units} units · {formatMoney(command.display.totalPaise)}
                      </strong>
                      <small>
                        {catalogDate.format(new Date(command.createdAt))}
                        {" · "}
                        {command.display.paymentMode}
                      </small>
                    </span>
                    <b>{command.status === "QUEUED" ? "Waiting" : "Needs review"}</b>
                    {command.lastResult && <small>{command.lastResult.message}</small>}
                  </div>
                ))}
              </div>
            )}
          </div>
          </details>
        )}

        {showScanner && !receipt && (
          <BarcodeScanner
            onClose={() => setShowScanner(false)}
            onDetected={useScannedBarcode}
          />
        )}

        {error && <p className="alert error" role="alert">{error}</p>}
        {message && <p className="alert success" role="status">{message}</p>}

        {receipt ? (
          <section className="sale-success" aria-labelledby="receipt-heading">
            <div className="receipt-topline">
              <div>
                <p className="eyebrow">ItsMyToy sale receipt</p>
                <h2 id="receipt-heading">{receipt.saleNumber}</h2>
                <p>{receiptDate.format(new Date(receipt.completedAt))}</p>
              </div>
              <span className="success-mark" aria-hidden="true">✓</span>
            </div>
            <p className="receipt-sale-type">
              {receipt.saleType === "WHOLESALE" ? "Wholesale sale" : "Retail sale"}
            </p>

            {receipt.customerName && (
              <p className="receipt-customer">Customer: <strong>{receipt.customerName}</strong></p>
            )}

            <div className="receipt-lines">
              {receipt.lines.map((line) => (
                <div key={line.variantId}>
                  <span>
                    <strong>{line.productName}</strong>
                    <small>{line.sku} · {line.quantity} × {formatMoney(line.unitPricePaise)}</small>
                  </span>
                  <strong>{formatMoney(line.totalPaise)}</strong>
                </div>
              ))}
            </div>

            <div className="receipt-payments">
              {receipt.payments.map((payment) => (
                <div key={payment.paymentMode}>
                  <span>{paymentLabel(payment.paymentMode)}</span>
                  <strong>{formatMoney(payment.amountPaise)}</strong>
                </div>
              ))}
              <div className="receipt-grand-total">
                <span>Total</span>
                <strong>{formatMoney(receipt.totalPaise)}</strong>
              </div>
            </div>

            <p className="receipt-disclaimer">
              Operational sale receipt — not a GST tax invoice.
            </p>
            <div className="receipt-actions">
              <button type="button" className="share-receipt-button" onClick={shareReceipt}>
                Share receipt
              </button>
              <button
                type="button"
                className="new-sale-button"
                onClick={() => {
                  setReceipt(null);
                  setMessage("");
                  setError("");
                }}
              >
                New sale
              </button>
            </div>
          </section>
        ) : <div className="workspace-grid">
          <section className="results-panel" aria-labelledby="products-heading">
            <div className="section-title">
              <h2 id="products-heading">Products</h2>
              <span>{products.length} shown</span>
            </div>
            <div className="product-list">
              {products.map((product) => {
                const inCart = cart.find((line) => line.product.id === product.id);
                return (
                  <button
                    className={`product-row${selected?.id === product.id ? " selected" : ""}`}
                    type="button"
                    key={product.id}
                    onClick={() => chooseProduct(product)}
                  >
                    <span className="product-icon" aria-hidden="true">{product.name.slice(0, 1)}</span>
                    <span className="product-copy">
                      <strong>{product.name}</strong>
                      <small>{product.variantName} · {product.sku}</small>
                      <small>{product.rackLocation ?? "Rack not set"}</small>
                    </span>
                    <span className="product-price">
                      {formatMoney(listedPrice(product, saleType))}
                      <small>{saleType === "WHOLESALE" ? "Wholesale" : "Retail"}</small>
                    </span>
                    <span className={`stock-pill${product.stock === 0 ? " empty" : ""}`}>
                      {inCart
                        ? `${inCart.quantity} in cart`
                        : online
                          ? `${product.stock} in stock`
                          : `${offlineAvailableQuantity(
                              product.stock,
                              queuedQuantityForVariant(offlineSales, product.id),
                            )} offline available`}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="checkout-panel" aria-label="Cart builder and checkout">
            {!selected ? (
              <div className="empty-state cart-empty-state">
                <span aria-hidden="true">↖</span>
                <h2>Select a product</h2>
                <p>{cart.length ? "Choose another product or complete the cart below." : "Choose a toy to add it to this sale."}</p>
              </div>
            ) : (
              <form onSubmit={saveCartLine}>
                <div className="selected-product">
                  <div>
                    <p className="eyebrow">Selected product</p>
                    <h2>{selected.name}</h2>
                    <p>{selected.variantName} · {selected.rackLocation}</p>
                  </div>
                  <span className="stock-large">
                    {selected.stock}
                    <small>{online ? "available" : "last known"}</small>
                  </span>
                </div>

                {!online && (
                  <p className="offline-read-only">
                    {offlineSellingReady
                      ? `Last known ${selectedCachedProduct?.stock ?? 0} − ${selectedQueuedQuantity} already queued − 1 safety reserve = ${selectedAvailableQuantity} available offline. ${offlineCatalog ? savedAge(offlineCatalog.asOf) : ""}; server stock may now be lower.`
                      : "Saved product details only. Reconnect and validate this device before queuing a sale."}
                  </p>
                )}

                <div className="price-summary">
                  <div><span>MRP</span><strong>{formatMoney(selected.mrpPaise)}</strong></div>
                  <div><span>Retail price</span><strong>{formatMoney(selected.standardPricePaise)}</strong></div>
                  <div className={saleType === "WHOLESALE" ? "permitted" : ""}>
                    <span>Wholesale price</span>
                    <strong>{formatMoney(selected.wholesalePricePaise ?? selected.standardPricePaise)}</strong>
                  </div>
                  <div className="permitted"><span>Your lowest permitted price</span><strong>{formatMoney(selected.minimumPricePaise)}</strong></div>
                  {selected.weightedAverageCostPaise !== undefined && (
                    <div><span>Weighted-average cost</span><strong>{formatMoney(selected.weightedAverageCostPaise)}</strong></div>
                  )}
                  {selected.latestLandedCostPaise !== undefined && (
                    <div><span>Latest landed cost</span><strong>{formatMoney(selected.latestLandedCostPaise)}</strong></div>
                  )}
                </div>

                <fieldset>
                  <legend>Final unit price</legend>
                  <div className="preset-row">
                    <button disabled={!online && !offlineSellingReady} type="button" onClick={() => selectRegularPrice(selectedListedPrice)}>
                      {saleType === "WHOLESALE" ? "Wholesale" : "Retail"}
                    </button>
                    <button disabled={!online && !offlineSellingReady} type="button" onClick={() => selectRegularPrice(Math.max(selected.minimumPricePaise, Math.round(selectedListedPrice * 0.95)))}>5% off</button>
                    <button disabled={!online && !offlineSellingReady} type="button" onClick={() => selectRegularPrice(selected.minimumPricePaise)}>Maximum</button>
                  </div>
                  {!exceptionMode && (
                    <input
                      className="price-slider"
                      type="range"
                      min={selected.minimumPricePaise}
                      max={selectedListedPrice}
                      step="500"
                      value={unitPrice}
                      onChange={(event) => setUnitPrice(Number(event.target.value))}
                      aria-label="Final unit price"
                      disabled={!online && !offlineSellingReady}
                    />
                  )}
                  <div className="price-output">
                    <strong>{formatMoney(unitPrice)}</strong>
                    <span>{exceptionMode ? "Owner-authorized exception" : `Up to ${formatMoney(maxExtraDiscount)} extra discount allowed`}</span>
                  </div>
                </fieldset>

                <section className="exception-box" aria-label="Lower price approval">
                  {!showLowerPrice ? (
                    <button disabled={!online} type="button" className="text-button" onClick={() => setShowLowerPrice(true)}>
                      Customer needs a lower price
                    </button>
                  ) : (
                    <>
                      <div className="form-row two-columns compact-row">
                        <label>Requested unit price (₹)
                          <input
                            type="number"
                            min="0.01"
                            max={(selected.minimumPricePaise - 1) / 100}
                            step="0.01"
                            value={lowerPriceRupees}
                            onChange={(event) => {
                              setLowerPriceRupees(event.target.value);
                              setApproval(null);
                              setExceptionMode(false);
                              setUnitPrice(selectedListedPrice);
                            }}
                            inputMode="decimal"
                          />
                        </label>
                        <button type="button" onClick={requestLowerPrice} disabled={!online || checkingApproval}>
                          {checkingApproval ? "Please wait…" : role === "BUSINESS_OWNER" ? "Use owner exception" : "Request owner approval"}
                        </button>
                      </div>
                      {role === "BUSINESS_OWNER" && exceptionMode && (
                        <div className="form-row two-columns compact-row">
                          <label>Reason
                            <select value={exceptionReason} onChange={(event) => setExceptionReason(event.target.value)}>
                              {exceptionReasons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </select>
                          </label>
                          <label>{exceptionReason === "OTHER" ? "Required note" : "Optional note"}
                            <input value={exceptionNote} onChange={(event) => setExceptionNote(event.target.value)} maxLength={500} />
                          </label>
                        </div>
                      )}
                      {approval && (
                        <div className={`approval-status ${approval.status.toLowerCase()}`}>
                          <span>Request {approval.status.toLowerCase()} · {formatMoney(approval.requestedUnitPricePaise)}</span>
                          {approval.status === "PENDING" && (
                            <button type="button" onClick={checkApproval} disabled={checkingApproval}>{checkingApproval ? "Checking…" : "Check owner decision"}</button>
                          )}
                        </div>
                      )}
                      <button type="button" className="text-button muted" onClick={() => selectRegularPrice(selectedListedPrice)}>Cancel lower price</button>
                    </>
                  )}
                </section>

                <div className="form-row">
                  <label>Quantity
                    <input
                      type="number"
                      min="1"
                      max={Math.max(1, selectedAvailableQuantity)}
                      value={quantity}
                      onChange={(event) => changeQuantity(Number(event.target.value), selected)}
                      disabled={!online && !offlineSellingReady}
                      required
                    />
                  </label>
                </div>

                <div className="checkout-total line-preview">
                  <span>
                    <small>Customer saves {formatMoney(customerSaving)}</small>
                    {expectedGrossProfit !== undefined && <small>Expected gross result {formatMoney(expectedGrossProfit)}</small>}
                    {expectedReplacementMargin !== undefined && <small>Replacement margin {formatMoney(expectedReplacementMargin)}</small>}
                    Line total
                  </span>
                  <strong>{formatMoney(selectedTotal)}</strong>
                </div>
                <button
                  className="complete-button add-cart-button"
                  type="submit"
                  disabled={(!online && !offlineSellingReady)
                    || selectedAvailableQuantity < quantity
                    || queuedSalesBlockOnlineCheckout
                    || approval?.status === "PENDING"}
                >
                  {!online && !offlineSellingReady
                    ? "Reconnect to add to cart"
                    : queuedSalesBlockOnlineCheckout
                      ? "Sync queued sales first"
                    : cart.some((line) => line.product.id === selected.id)
                      ? "Update cart"
                      : "Add to cart"}
                </button>
              </form>
            )}

            <section className="cart-section" aria-labelledby="cart-heading">
              <div className="section-title">
                <h2 id="cart-heading">Cart</h2>
                <span>{cartUnits} units</span>
              </div>
              {cart.length === 0 ? (
                <p className="cart-empty">No products added yet.</p>
              ) : (
                <>
                  <div className="cart-lines">
                    {cart.map((line) => (
                      <article className="cart-row" key={line.product.id}>
                        <div>
                          <strong>{line.product.name}</strong>
                          <small>{line.quantity} × {formatMoney(line.unitPricePaise)}{line.exceptionMode ? " · approved exception" : ""}</small>
                        </div>
                        <strong>{formatMoney(line.quantity * line.unitPricePaise)}</strong>
                        <div className="cart-actions">
                          <button type="button" onClick={() => chooseProduct(line.product)}>Edit</button>
                          <button type="button" onClick={() => removeCartLine(line.product.id)}>Remove</button>
                        </div>
                      </article>
                    ))}
                  </div>

                  <form className="cart-checkout" onSubmit={submitSale}>
                    {!online && (
                      <p className="offline-read-only">
                        Retail Guest sale only. Cash or UPI. No customer details. The saved
                        permitted price and one-unit stock reserve are enforced.
                      </p>
                    )}
                    <fieldset className="online-only-checkout" hidden={!online}>
                    <section className="payment-section" aria-labelledby="payment-heading">
                      <div className="section-title">
                        <h3 id="payment-heading">Payment</h3>
                        <span>{splitPayment ? "Two methods" : "One method"}</span>
                      </div>
                      <div className="form-row two-columns">
                        <label>{splitPayment ? "First method" : "Payment method"}
                          <select
                            value={paymentMode}
                            onChange={(event) => {
                              const next = event.target.value;
                              setPaymentMode(next);
                              if (next === secondPaymentMode) {
                                setSecondPaymentMode(next === "UPI" ? "CASH" : "UPI");
                              }
                            }}
                          >
                            <option value="UPI">UPI</option>
                            <option value="CASH">Cash</option>
                            <option value="CARD">Card</option>
                            <option value="BANK_TRANSFER">Bank transfer</option>
                          </select>
                        </label>
                        {splitPayment && (
                          <label>First amount (₹)
                            <input
                              type="number"
                              min="0.01"
                              max={Math.max(0.01, (cartTotal - 1) / 100)}
                              step="0.01"
                              inputMode="decimal"
                              value={firstPaymentRupees}
                              onChange={(event) => setFirstPaymentRupees(event.target.value)}
                            />
                          </label>
                        )}
                      </div>
                      {splitPayment && (
                        <div className="split-remainder">
                          <label>Second method
                            <select
                              value={secondPaymentMode}
                              onChange={(event) => setSecondPaymentMode(event.target.value)}
                            >
                              {[
                                ["UPI", "UPI"],
                                ["CASH", "Cash"],
                                ["CARD", "Card"],
                                ["BANK_TRANSFER", "Bank transfer"],
                              ].filter(([value]) => value !== paymentMode).map(([value, label]) => (
                                <option key={value} value={value}>{label}</option>
                              ))}
                            </select>
                          </label>
                          <div>
                            <span>Remaining amount</span>
                            <strong>
                              {firstPaymentPaise > 0 && secondPaymentPaise > 0
                                ? formatMoney(secondPaymentPaise)
                                : "—"}
                            </strong>
                          </div>
                        </div>
                      )}
                      <label className="customer-toggle">
                        <input
                          type="checkbox"
                          checked={splitPayment}
                          onChange={(event) => {
                            setSplitPayment(event.target.checked);
                            setFirstPaymentRupees("");
                          }}
                        />
                        Split between two payment methods
                      </label>
                    </section>

                    <section className="customer-section" aria-labelledby="customer-heading">
                      <div className="section-title">
                        <h3 id="customer-heading">Customer</h3>
                        <span>
                          {saleType === "WHOLESALE"
                            ? "Required for Wholesale"
                            : requiresCustomer
                              ? "Ask for details"
                              : "Optional"}
                        </span>
                      </div>
                      {selectedCustomer ? (
                        <div className="selected-customer">
                          <span>
                            <strong>{selectedCustomer.name}</strong>
                            <small>
                              {selectedCustomer.phone} · {selectedCustomer.totalOrders} earlier orders
                            </small>
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedCustomer(null);
                              setShowCustomerFinder(true);
                            }}
                          >
                            Change
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="customer-finder-button"
                            onClick={() => setShowCustomerFinder((current) => !current)}
                          >
                            Find or add customer
                          </button>
                          <Modal
                            open={showCustomerFinder}
                            title="Find or add customer"
                            description={saleType === "WHOLESALE"
                              ? "Choose the shopkeeper for this Wholesale sale."
                              : "Search existing records before creating a new customer."}
                            onClose={() => setShowCustomerFinder(false)}
                          >
                            <div className="customer-finder customer-finder--modal">
                              <label>Phone number or name
                                <div className="inline-find">
                                  <input
                                    value={customerQuery}
                                    onChange={(event) => setCustomerQuery(event.target.value)}
                                    autoComplete="off"
                                  />
                                  <button type="button" onClick={findCustomers} disabled={customerLoading}>
                                    {customerLoading ? "Finding…" : "Find"}
                                  </button>
                                </div>
                              </label>
                              {customerResults.length > 0 && (
                                <div className="customer-results">
                                  {customerResults.map((customer) => (
                                    <button
                                      type="button"
                                      key={customer.id}
                                      onClick={() => {
                                        setSelectedCustomer(customer);
                                        setShowCustomerFinder(false);
                                        resetGuestDecision();
                                      }}
                                    >
                                      <span>
                                        <strong>{customer.name}</strong>
                                        <small>{customer.phone}{customer.locality ? ` · ${customer.locality}` : ""}</small>
                                      </span>
                                      <span>{customer.totalOrders} orders</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                              {!showNewCustomer ? (
                                <button
                                  type="button"
                                  className="text-button"
                                  onClick={() => setShowNewCustomer(true)}
                                >
                                  Customer not found — add new
                                </button>
                              ) : (
                                <div className="new-customer-fields">
                                  <div className="form-row two-columns">
                                    <label>Name
                                      <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
                                    </label>
                                    <label>Phone number
                                      <input value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} inputMode="tel" />
                                    </label>
                                    <label>Locality (optional)
                                      <input value={customerLocality} onChange={(event) => setCustomerLocality(event.target.value)} />
                                    </label>
                                    <label>Email (optional)
                                      <input value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} type="email" />
                                    </label>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={createCustomer}
                                    disabled={customerLoading || !customerName.trim() || !customerPhone.trim()}
                                  >
                                    {customerLoading ? "Saving…" : "Save and select customer"}
                                  </button>
                                </div>
                              )}
                            </div>
                          </Modal>
                        </>
                      )}
                    </section>

                    {saleType === "RETAIL" && requiresCustomer && !selectedCustomer && (
                      <section className="guest-policy" aria-label="High-value Guest sale control">
                        <strong>Customer information is requested for sales of ₹5,000 or more.</strong>
                        <p>If the customer declines, record an owner-approved Guest sale. Never invent details.</p>
                        {role === "BUSINESS_OWNER" ? (
                          <label className="customer-toggle">
                            <input
                              type="checkbox"
                              checked={ownerGuestOverride}
                              onChange={(event) => setOwnerGuestOverride(event.target.checked)}
                            />
                            Customer declined — approve this exact Guest cart
                          </label>
                        ) : guestApproval ? (
                          <div className={`approval-status ${guestApproval.status.toLowerCase()}`}>
                            <span>Guest request {guestApproval.status.toLowerCase()}</span>
                            {guestApproval.status === "PENDING" && (
                              <button
                                type="button"
                                onClick={checkGuestApproval}
                                disabled={guestApprovalLoading}
                              >
                                {guestApprovalLoading ? "Checking…" : "Check owner decision"}
                              </button>
                            )}
                            {["REJECTED", "EXPIRED"].includes(guestApproval.status) && (
                              <button
                                type="button"
                                onClick={() => {
                                  setGuestApproval(null);
                                  setCommandId(crypto.randomUUID());
                                }}
                              >
                                Start a new request
                              </button>
                            )}
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={requestGuestApproval}
                            disabled={guestApprovalLoading}
                          >
                            {guestApprovalLoading ? "Sending…" : "Customer declined — request owner approval"}
                          </button>
                        )}
                      </section>
                    )}

                    <div className="checkout-total cart-total">
                      <span><small>{cart.length} products · {cartUnits} units</small>Total</span>
                      <strong>{formatMoney(cartTotal)}</strong>
                    </div>
                    <button
                      className="complete-button"
                      type="submit"
                      disabled={!online || submitting || !guestCompletionReady
                        || queuedSalesBlockOnlineCheckout
                        || (splitPayment && !splitPaymentValid)}
                    >
                      {submitting ? "Completing all lines safely…" : "Complete sale"}
                    </button>
                    </fieldset>
                    {!online && (
                      <section className="offline-checkout" aria-label="Offline Guest checkout">
                        <div className="section-title">
                          <h3>Offline Guest sale</h3>
                          <span>Saved on this device first</span>
                        </div>
                        <label>Payment method
                          <select
                            value={["CASH", "UPI"].includes(paymentMode) ? paymentMode : "UPI"}
                            onChange={(event) => setPaymentMode(event.target.value)}
                            disabled={!offlineSellingReady}
                          >
                            <option value="UPI">UPI</option>
                            <option value="CASH">Cash</option>
                          </select>
                        </label>
                        {requiresCustomer && (
                          <p className="alert error" role="alert">
                            Reconnect for a Guest sale of ₹5,000 or more.
                          </p>
                        )}
                        <div className="checkout-total cart-total">
                          <span><small>{cart.length} products · {cartUnits} units</small>Total</span>
                          <strong>{formatMoney(cartTotal)}</strong>
                        </div>
                        <button
                          className="complete-button"
                          type="submit"
                          disabled={!offlineSellingReady || submitting || requiresCustomer}
                        >
                          {submitting ? "Saving safely…" : "Queue offline sale"}
                        </button>
                      </section>
                    )}
                  </form>
                </>
              )}
            </section>
          </section>
        </div>}
      </section>
    </AppShell>
  );
}
