"use client";

import { FormEvent, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Image from "next/image";
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
import {
  copyReceiptImage,
  downloadReceiptImage,
  downloadReceiptPdf,
  receiptSavings,
} from "@/client/receipt-export";
import BarcodeScanner from "./BarcodeScanner";
import AppShell from "@/components/AppShell";
import CustomSelect from "@/components/ui/CustomSelect";
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
  wholesaleFifoLots?: Array<{
    quantity: number;
    unitCostPaise: number;
    suggestedUnitPricePaise: number;
  }>;
  minimumPricePaise: number;
  suggestedMinimumPricePaise?: number;
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
  phone: string | null;
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
  amountPaidPaise: number;
  balanceDuePaise: number;
  dueReason: "CUSTOMER_WILL_PAY_LATER" | "DIGITAL_PAYMENT_PENDING" | null;
  lines: Array<{
    variantId: string;
    productName: string;
    sku: string;
    quantity: number;
    mrpPaise?: number;
    listedPricePaise?: number;
    unitPricePaise: number;
    totalPaise: number;
  }>;
};

type CartLine = {
  product: Product;
  quantity: number;
  unitPricePaise: number;
  usesSuggestedPrice: boolean;
  approval: PriceApproval | null;
  exceptionMode: boolean;
  exceptionReason: string;
  exceptionNote: string;
};

type SaleType = "RETAIL" | "WHOLESALE";

const paymentOptions = [
  { value: "UPI", label: "UPI" },
  { value: "CASH", label: "Cash" },
  { value: "CARD", label: "Card" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
] as const;

const dueReasonOptions = [
  { value: "CUSTOMER_WILL_PAY_LATER", label: "Pay later" },
  { value: "DIGITAL_PAYMENT_PENDING", label: "Payment pending" },
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

function listedPrice(product: Product, saleType: SaleType, quantity = 1) {
  if (saleType !== "WHOLESALE") return product.standardPricePaise;
  const lots = product.wholesaleFifoLots ?? [];
  if (!lots.length || quantity < 1) {
    return product.wholesalePricePaise ?? product.standardPricePaise;
  }
  let remaining = quantity;
  let totalPaise = 0;
  for (const lot of lots) {
    if (remaining === 0) break;
    const fromLot = Math.min(remaining, lot.quantity);
    totalPaise += fromLot * lot.suggestedUnitPricePaise;
    remaining -= fromLot;
  }
  if (remaining > 0) {
    totalPaise += remaining * (
      product.wholesalePricePaise ?? product.standardPricePaise
    );
  }
  return Math.ceil(totalPaise / quantity);
}

function fifoCostPerUnit(product: Product, quantity: number) {
  const lots = product.wholesaleFifoLots ?? [];
  if (!lots.length || quantity < 1) return product.minimumPricePaise;
  let remaining = quantity;
  let totalPaise = 0;
  for (const lot of lots) {
    if (remaining === 0) break;
    const fromLot = Math.min(remaining, lot.quantity);
    totalPaise += fromLot * lot.unitCostPaise;
    remaining -= fromLot;
  }
  if (remaining > 0) return product.minimumPricePaise;
  return Math.ceil(totalPaise / quantity);
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
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [unitPrice, setUnitPrice] = useState(0);
  const [priceInputRupees, setPriceInputRupees] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [paymentMode, setPaymentMode] = useState("UPI");
  const [splitPayment, setSplitPayment] = useState(false);
  const [secondPaymentMode, setSecondPaymentMode] = useState("CASH");
  const [firstPaymentRupees, setFirstPaymentRupees] = useState("");
  const [recordDue, setRecordDue] = useState(false);
  const [amountReceivedRupees, setAmountReceivedRupees] = useState("");
  const [dueReason, setDueReason] = useState("CUSTOMER_WILL_PAY_LATER");
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [activeCustomerIndex, setActiveCustomerIndex] = useState(0);
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
  const [receiptExportOpen, setReceiptExportOpen] = useState(false);
  const [receiptExporting, setReceiptExporting] = useState<
    "copy" | "pdf" | "image" | null
  >(null);
  const [receiptExportStatus, setReceiptExportStatus] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [commandId, setCommandId] = useState(() => crypto.randomUUID());
  const [approval, setApproval] = useState<PriceApproval | null>(null);
  const [exceptionMode, setExceptionMode] = useState(false);
  const [exceptionReason, setExceptionReason] = useState("CUSTOMER_SERVICE_RECOVERY");
  const [exceptionNote, setExceptionNote] = useState("");
  const [offlineCatalog, setOfflineCatalog] =
    useState<OfflineCatalogSnapshot | null>(null);
  const [, setCatalogStatus] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [offlineDevice, setOfflineDevice] =
    useState<OfflineDeviceEnrollment | null>(null);
  const [, setDeviceStatus] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [offlineSales, setOfflineSales] = useState<OfflineSaleCommand[]>([]);
  const [, setSyncingOfflineSales] = useState(false);
  const syncingOfflineSalesRef = useRef(false);
  const customerSearchRef = useRef<HTMLInputElement>(null);
  const productSearchTimerRef = useRef<number | null>(null);
  const productSearchRequestRef = useRef(0);

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
        setCustomerResults([]);
        setGuestApproval(null);
        setOwnerGuestOverride(false);
      });
    }
  }, [online]);

  useEffect(() => {
    const search = customerQuery.trim();
    if (!online || selectedCustomer || search.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setCustomerLoading(true);
      try {
        const response = await fetch(
          `/api/v1/customers?q=${encodeURIComponent(search)}`,
          { signal: controller.signal },
        );
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message ?? "Customers could not be loaded.");
        setCustomerResults(body.customers);
        setActiveCustomerIndex(0);
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) {
          setError(reason instanceof Error ? reason.message : "Customers could not be loaded.");
        }
      } finally {
        if (!controller.signal.aborted) setCustomerLoading(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [customerQuery, online, selectedCustomer]);

  useEffect(() => () => {
    if (productSearchTimerRef.current !== null) {
      window.clearTimeout(productSearchTimerRef.current);
    }
    productSearchRequestRef.current += 1;
  }, []);

  function selectCustomer(customer: Customer) {
    setSelectedCustomer(customer);
    setCustomerQuery("");
    setCustomerResults([]);
    setActiveCustomerIndex(0);
    setError("");
    resetGuestDecision();
  }

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
    setApproval(null);
    setExceptionMode(false);
    setExceptionReason("CUSTOMER_SERVICE_RECOVERY");
    setExceptionNote("");
  }

  function selectRegularPrice(price: number) {
    setUnitPrice(price);
    setPriceInputRupees(String(price / 100));
    clearPriceException();
  }

  function chooseSaleType(nextSaleType: SaleType) {
    if (nextSaleType === saleType) return;
    if (cart.length && !window.confirm("Switching the sale type will clear the current cart. Continue?")) {
      return;
    }
    setSaleType(nextSaleType);
    setCart([]);
    setSelected(null);
    setMobileCartOpen(false);
    setCheckoutOpen(false);
    setSelectedCustomer(null);
    setCustomerResults([]);
    resetGuestDecision();
    clearPriceException();
    setCommandId(crypto.randomUUID());
    setMessage("");
    setError("");
  }

  function cancelSale() {
    if (!cart.length) return;
    if (!window.confirm("Cancel this sale and clear the cart, customer and payment details?")) {
      return;
    }

    if (productSearchTimerRef.current !== null) {
      window.clearTimeout(productSearchTimerRef.current);
      productSearchTimerRef.current = null;
    }
    productSearchRequestRef.current += 1;
    setCart([]);
    setSelected(null);
    setMobileCartOpen(false);
    setCheckoutOpen(false);
    setShowScanner(false);
    setQuery("");
    setProducts(initialProducts);
    setSelectedCustomer(null);
    setCustomerQuery("");
    setCustomerResults([]);
    setActiveCustomerIndex(0);
    setShowNewCustomer(false);
    setCustomerName("");
    setCustomerPhone("");
    setCustomerLocality("");
    setCustomerEmail("");
    setPaymentMode("UPI");
    setSplitPayment(false);
    setSecondPaymentMode("CASH");
    setFirstPaymentRupees("");
    setRecordDue(false);
    setAmountReceivedRupees("");
    setDueReason("CUSTOMER_WILL_PAY_LATER");
    resetGuestDecision();
    clearPriceException();
    setCommandId(crypto.randomUUID());
    setError("");
    setMessage("Sale cancelled. Ready for a new sale.");
  }

  function chooseProduct(product: Product) {
    const existing = cart.find((line) => line.product.id === product.id);
    const nextUnitPrice = existing?.unitPricePaise ?? listedPrice(product, saleType, 1);
    setShowScanner(false);
    setSelected(product);
    setUnitPrice(nextUnitPrice);
    setPriceInputRupees(String(nextUnitPrice / 100));
    setQuantity(existing?.quantity ?? 1);
    setApproval(existing?.approval ?? null);
    setExceptionMode(existing?.exceptionMode ?? false);
    setExceptionReason(existing?.exceptionReason ?? "CUSTOMER_SERVICE_RECOVERY");
    setExceptionNote(existing?.exceptionNote ?? "");
    setMessage("");
    setError("");
  }

  function quickAddProduct(product: Product) {
    const existing = cart.find((line) => line.product.id === product.id);
    if (existing?.approval || existing?.exceptionMode) {
      chooseProduct(product);
      return;
    }
    if (!navigator.onLine && saleType === "WHOLESALE") {
      setError("Reconnect before preparing a Wholesale sale.");
      return;
    }
    if (queuedSalesBlockOnlineCheckout) {
      setError("Sync the queued sales before starting another cart.");
      return;
    }

    const cachedProduct = offlineCatalog?.products.find(
      (item) => item.id === product.id,
    );
    const availableQuantity = navigator.onLine
      ? product.stock
      : cachedProduct
        ? offlineAvailableQuantity(
            cachedProduct.stock,
            queuedQuantityForVariant(offlineSales, product.id),
          )
        : 0;
    if (
      !navigator.onLine
      && (offlineDeviceState(offlineDevice) !== "ACTIVE" || !cachedProduct)
    ) {
      setError("Reconnect and validate this approved device before building an offline sale.");
      return;
    }

    const nextQuantity = (existing?.quantity ?? 0) + 1;
    if (nextQuantity > availableQuantity) {
      setError("There is not enough stock for another unit.");
      return;
    }

    const line: CartLine = existing
      ? {
          ...existing,
          quantity: nextQuantity,
          unitPricePaise:
            saleType === "WHOLESALE" && existing.usesSuggestedPrice
              ? listedPrice(product, saleType, nextQuantity)
              : existing.unitPricePaise,
        }
      : {
          product,
          quantity: 1,
          unitPricePaise: navigator.onLine
            ? listedPrice(product, saleType)
            : cachedProduct!.standardPricePaise,
          approval: null,
          usesSuggestedPrice: true,
          exceptionMode: false,
          exceptionReason: "CUSTOMER_SERVICE_RECOVERY",
          exceptionNote: "",
        };
    setCart((current) => existing
      ? current.map((item) => item.product.id === product.id ? line : item)
      : [...current, line]);
    setShowScanner(false);
    setMessage("");
    setError("");
    resetGuestDecision();
    setCommandId(crypto.randomUUID());
  }

  async function findCachedProducts(
    search: string,
    liveFallback = false,
    requestId = productSearchRequestRef.current,
    autoAddSingle = false,
  ) {
    const cached = offlineCatalog
      ?? await readOfflineCatalog(cacheKey).catch(() => null);
    if (requestId !== productSearchRequestRef.current) return false;
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
    if (autoAddSingle && matches.length === 1) quickAddProduct(matches[0]);
    setMessage(
      `${liveFallback ? "Live lookup unavailable. " : ""}Using catalogue saved ${catalogDate.format(new Date(cached.asOf))}. Stock may have changed.`,
    );
    return true;
  }

  async function findProducts(
    search = query,
    options: { autoAddSingle?: boolean; requestId?: number } = {},
  ) {
    const requestId = options.requestId ?? ++productSearchRequestRef.current;
    const autoAddSingle = options.autoAddSingle ?? false;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      if (!navigator.onLine) {
        return await findCachedProducts(search, false, requestId, autoAddSingle);
      }

      const response = await fetch(`/api/v1/catalog?q=${encodeURIComponent(search)}`);
      const body = await response.json();
      if (requestId !== productSearchRequestRef.current) return false;
      if (!response.ok) throw new Error(body.error?.message ?? "Products could not be loaded.");
      setProducts(body.products);
      if (search.trim() && body.products.length === 0) {
        setError(`No product found for “${search.trim()}”. Check the label or search manually.`);
        return false;
      }
      if (autoAddSingle && body.products.length === 1) quickAddProduct(body.products[0]);
      return true;
    } catch {
      if (requestId !== productSearchRequestRef.current) return false;
      if (await findCachedProducts(search, true, requestId, autoAddSingle)) return true;
      return false;
    } finally {
      if (requestId === productSearchRequestRef.current) setLoading(false);
    }
  }

  function updateProductQuery(nextQuery: string) {
    setQuery(nextQuery);
    setShowScanner(false);
    setError("");
    setMessage("");
    if (productSearchTimerRef.current !== null) {
      window.clearTimeout(productSearchTimerRef.current);
    }

    const requestId = ++productSearchRequestRef.current;
    if (!nextQuery.trim()) {
      setProducts(initialProducts);
      setLoading(false);
      return;
    }

    setLoading(true);
    productSearchTimerRef.current = window.setTimeout(() => {
      productSearchTimerRef.current = null;
      void findProducts(nextQuery, { requestId });
    }, 250);
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    setShowScanner(false);
    await findProducts();
  }

  async function useScannedBarcode(barcode: string) {
    setQuery(barcode);
    if (await findProducts(barcode, { autoAddSingle: true })) {
      setMessage(
        navigator.onLine
          ? `Barcode ${barcode} scanned.`
          : `Barcode ${barcode} found in the saved catalogue. Stock may have changed.`,
      );
      return {
        kind: "success" as const,
        message: navigator.onLine
          ? `${barcode} matched and the product was added to the cart.`
          : `${barcode} matched the saved catalogue and was added to the cart.`,
      };
    }
    return {
      kind: "warning" as const,
      message: `${barcode} was read, but it does not match a product. Check the label or search manually.`,
    };
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
    if (saleType === "WHOLESALE") {
      const minimumWholesalePrice = fifoCostPerUnit(selected, quantity);
      const maximumWholesalePrice = Math.max(
        listedPrice(selected, saleType, quantity),
        selected.standardPricePaise,
        selected.mrpPaise,
      );
      if (
        !Number.isInteger(unitPrice)
        || unitPrice < minimumWholesalePrice
        || unitPrice > maximumWholesalePrice
      ) {
        setError(
          `Enter a Wholesale price between ${formatMoney(minimumWholesalePrice)} and ${formatMoney(maximumWholesalePrice)} per item.`,
        );
        return;
      }
    }
    if (
      !navigator.onLine
      && (
        exceptionMode
        || approval
        || unitPrice < Math.min(
          cachedProduct!.standardPricePaise,
          cachedProduct!.minimumPricePaise,
        )
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
      usesSuggestedPrice: unitPrice === listedPrice(selected, saleType, quantity),
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
    setCart((current) => {
      const next = current.filter((line) => line.product.id !== variantId);
      if (next.length === 0) {
        setMobileCartOpen(false);
        setCheckoutOpen(false);
      }
      return next;
    });
    if (selected?.id === variantId) setSelected(null);
    resetGuestDecision();
    setCommandId(crypto.randomUUID());
  }

  function changeCartQuantity(line: CartLine, nextQuantity: number) {
    if (nextQuantity < 1) {
      removeCartLine(line.product.id);
      return;
    }
    const cachedProduct = offlineCatalog?.products.find(
      (product) => product.id === line.product.id,
    );
    const availableQuantity = navigator.onLine
      ? line.product.stock
      : cachedProduct
        ? offlineAvailableQuantity(
            cachedProduct.stock,
            queuedQuantityForVariant(offlineSales, line.product.id),
          )
        : 0;
    if (nextQuantity > availableQuantity) {
      setError(`Only ${availableQuantity} available for ${line.product.name}.`);
      return;
    }
    setCart((current) => current.map((item) =>
      item.product.id === line.product.id
        ? {
            ...item,
            quantity: nextQuantity,
            unitPricePaise:
              saleType === "WHOLESALE" && item.usesSuggestedPrice
                ? listedPrice(item.product, saleType, nextQuantity)
                : item.unitPricePaise,
          }
        : item
    ));
    setError("");
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
        setMobileCartOpen(false);
        setCheckoutOpen(false);
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
    if (recordDue && !selectedCustomer) {
      setError("Select a customer before recording an unpaid balance.");
      customerSearchRef.current?.focus();
      return;
    }
    if (recordDue && !duePaymentValid) {
      setError("Enter an amount received from ₹0 up to, but below, the sale total.");
      return;
    }
    if (!recordDue && splitPayment && !splitPaymentValid) {
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
          payments: recordDue
            ? amountReceivedPaise > 0
              ? [{ paymentMode, amountPaise: amountReceivedPaise }]
              : []
            : splitPayment
              ? [
                  { paymentMode, amountPaise: firstPaymentPaise },
                  { paymentMode: secondPaymentMode, amountPaise: secondPaymentPaise },
                ]
              : [{ paymentMode, amountPaise: cartTotal }],
          dueReason: recordDue ? dueReason : undefined,
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
      setReceiptExportOpen(false);
      setReceiptExporting(null);
      setReceiptExportStatus("");
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
      setMobileCartOpen(false);
      setCheckoutOpen(false);
      setSelectedCustomer(null);
      setCustomerResults([]);
      setCustomerQuery("");
      setCustomerName("");
      setCustomerPhone("");
      setCustomerLocality("");
      setCustomerEmail("");
      setShowNewCustomer(false);
      setSplitPayment(false);
      setFirstPaymentRupees("");
      setRecordDue(false);
      setAmountReceivedRupees("");
      setDueReason("CUSTOMER_WILL_PAY_LATER");
      resetGuestDecision();
      setCommandId(crypto.randomUUID());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sale could not be completed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function exportReceipt(action: "copy" | "pdf" | "image") {
    if (!receipt || receiptExporting) return;
    setReceiptExporting(action);
    setReceiptExportStatus("");
    try {
      if (action === "copy") {
        await copyReceiptImage(receipt);
        setReceiptExportStatus("Receipt image copied. Paste it into WhatsApp or another app.");
      } else if (action === "pdf") {
        await downloadReceiptPdf(receipt);
        setReceiptExportStatus("Receipt PDF downloaded.");
      } else {
        await downloadReceiptImage(receipt);
        setReceiptExportStatus("Receipt image downloaded.");
      }
    } catch (reason) {
      setReceiptExportStatus(
        reason instanceof Error ? reason.message : "Receipt could not be prepared. Try again.",
      );
    } finally {
      setReceiptExporting(null);
    }
  }

  function closeReceipt() {
    setReceipt(null);
    setReceiptExportOpen(false);
    setReceiptExportStatus("");
    setMessage("");
    setError("");
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
          phone: customerPhone.trim() || undefined,
          locality: customerLocality.trim() || undefined,
          email: customerEmail.trim() || undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Customer could not be saved.");
      selectCustomer(body.customer);
      setShowNewCustomer(false);
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

  const selectedTotal = selected ? unitPrice * quantity : 0;
  const customerSaving = selected ? (selected.mrpPaise - unitPrice) * quantity : 0;
  const selectedListedPrice = selected
    ? listedPrice(selected, saleType, quantity)
    : 0;
  const additionalDiscount = selected
    ? Math.max(0, selectedListedPrice - unitPrice)
    : 0;
  const additionalDiscountPercent = selectedListedPrice > 0
    ? Math.round(additionalDiscount * 100 / selectedListedPrice)
    : 0;
  const maxExtraDiscount = selected
    ? Math.max(0, selectedListedPrice - Math.min(
        selectedListedPrice,
        saleType === "WHOLESALE"
          ? fifoCostPerUnit(selected, quantity)
          : selected.minimumPricePaise,
      ))
    : 0;
  const suggestedDiscount = selected
    ? Math.max(0, selectedListedPrice - Math.min(
        selectedListedPrice,
        selected.suggestedMinimumPricePaise ?? selected.minimumPricePaise,
      ))
    : 0;
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
  const amountReceivedPaise = Math.round(Number(amountReceivedRupees || "0") * 100);
  const balanceDuePaise = cartTotal - amountReceivedPaise;
  const duePaymentValid = !recordDue || (
    Number.isInteger(amountReceivedPaise)
    && amountReceivedPaise >= 0
    && balanceDuePaise > 0
    && Boolean(selectedCustomer)
  );
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
  const queuedSalesBlockOnlineCheckout = online && offlineSales.length > 0;
  const receiptDiscounts = receipt ? receiptSavings(receipt) : null;

  return (
    <AppShell displayName={displayName} role={role}>
      <section
        className={`sell-page sale-workspace-page${mobileCartOpen ? " cart-view-open" : ""}${checkoutOpen ? " checkout-view-open" : ""}`}
        aria-labelledby="sell-heading"
      >
        <PageHeader
          eyebrow={`${saleType === "WHOLESALE" ? "Wholesale" : "Retail"} sale`}
          headingId="sell-heading"
          title="Create sale"
          description={saleType === "WHOLESALE"
            ? "Select the shopkeeper, add products at their Wholesale prices and collect payment."
            : "Scan a product, apply the permitted Retail price and collect payment."}
        />

        {!fixedSaleType && (
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

        <Modal
          open={showScanner}
          title="Scan a product"
          description="Place the complete barcode inside the guide."
          onClose={() => setShowScanner(false)}
          panelClassName="scanner-modal-panel"
        >
          <BarcodeScanner
            onComplete={() => setShowScanner(false)}
            onDetected={useScannedBarcode}
            labelCandidates={(offlineCatalog?.products ?? initialProducts).map((product) => ({
              code: product.barcode || product.sku,
              sku: product.sku,
              name: product.name,
              variantName: product.variantName,
            }))}
            onManualSearch={() => {
              setShowScanner(false);
              window.requestAnimationFrame(() => {
                document.getElementById("product-search")?.focus();
              });
            }}
          />
        </Modal>

        {(error || message) && (
          <p
            className={`alert sale-alert ${error ? "error" : "success"}`}
            role={error ? "alert" : "status"}
          >
            {error || message}
          </p>
        )}

        <div className="workspace-grid">
          <section className="results-panel" aria-labelledby="products-heading">
            <form className="search-bar product-search" onSubmit={search}>
              <label htmlFor="product-search">Search by product, SKU or barcode</label>
              <div className="search-row">
                <input
                  id="product-search"
                  value={query}
                  onChange={(event) => updateProductQuery(event.target.value)}
                  placeholder="Search product, SKU or barcode"
                  autoComplete="off"
                  enterKeyHint="search"
                  aria-busy={loading}
                />
                <button
                  type="button"
                  className="scan-trigger"
                  aria-label="Scan barcode"
                  title="Scan barcode"
                  onClick={() => {
                    setShowScanner(true);
                    setMessage("");
                    setError("");
                  }}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M7 9v6M10 9v6M14 9v6M17 9v6" />
                  </svg>
                </button>
              </div>
            </form>
            <div className="section-title">
              <h2 id="products-heading">Products</h2>
              <span>{products.length} shown</span>
            </div>
            <div className="product-list">
              {products.map((product) => {
                const inCart = cart.find((line) => line.product.id === product.id);
                const available = online
                  ? product.stock
                  : offlineAvailableQuantity(
                      product.stock,
                      queuedQuantityForVariant(offlineSales, product.id),
                    );
                return (
                  <article
                    className={`product-row${inCart ? " in-cart" : ""}`}
                    key={product.id}
                  >
                    <button
                      type="button"
                      className="product-main"
                      onClick={() => inCart ? chooseProduct(product) : quickAddProduct(product)}
                      disabled={available < 1 && !inCart}
                      aria-label={inCart
                        ? `Edit ${product.name} in cart`
                        : `Add ${product.name} to cart`}
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
                    <button
                      type="button"
                      className="product-add"
                      onClick={() => inCart
                        ? removeCartLine(product.id)
                        : quickAddProduct(product)}
                      disabled={available < 1 && !inCart}
                      aria-label={inCart
                        ? `Remove ${product.name} from cart`
                        : `Add ${product.name} to cart`}
                      title={inCart ? "Remove from cart" : "Add to cart"}
                    >
                      {inCart ? "×" : "+"}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="checkout-panel" aria-label="Cart builder and checkout">
            <button
              type="button"
              className="mobile-products-back"
              onClick={() => {
                if (checkoutOpen) {
                  setCheckoutOpen(false);
                  setMobileCartOpen(true);
                } else {
                  setMobileCartOpen(false);
                }
              }}
            >
              {checkoutOpen ? "← Back to cart" : "← Continue adding products"}
            </button>

            <Modal
              open={Boolean(selected)}
              title={saleType === "WHOLESALE" ? "Set wholesale price" : "Apply a discount"}
              description={selected?.name ?? "Cart item"}
              onClose={() => setSelected(null)}
              panelClassName="discount-modal-panel"
            >
              {selected && (
              <form className="sale-line-editor" onSubmit={saveCartLine}>
                <div className="line-editor-product">
                  <div>
                    <strong>SKU {selected.sku}</strong>
                    <small>
                      {selected.variantName ? `${selected.variantName} · ` : ""}
                      {selected.rackLocation ?? "Rack not set"}
                    </small>
                  </div>
                  <span
                    aria-label={`${selected.stock} ${online ? "available" : "last known"}`}
                    className="stock-large"
                  >
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
                  <div className="selling-price">
                    <span>{saleType === "WHOLESALE" ? "Suggested wholesale price" : "Selling price"}</span>
                    <strong>{formatMoney(selectedListedPrice)}</strong>
                  </div>
                  <div className="mrp-price"><span>MRP</span><strong>{formatMoney(selected.mrpPaise)}</strong></div>
                </div>

                {saleType === "WHOLESALE" ? (
                <fieldset className="wholesale-price-editor">
                  <legend>Agreed price per item</legend>
                  <div className="preset-row">
                    <button
                      type="button"
                      onClick={() => selectRegularPrice(selectedListedPrice)}
                    >
                      Suggested 10% · {formatMoney(selectedListedPrice)}
                    </button>
                    <button
                      type="button"
                      onClick={() => selectRegularPrice(fifoCostPerUnit(selected, quantity))}
                    >
                      At FIFO cost · {formatMoney(fifoCostPerUnit(selected, quantity))}
                    </button>
                    <button
                      type="button"
                      onClick={() => selectRegularPrice(selected.standardPricePaise)}
                    >
                      Retail price · {formatMoney(selected.standardPricePaise)}
                    </button>
                  </div>
                  <label className="negotiated-price-field">
                    <span>Enter negotiated price</span>
                    <span className="currency-input">
                      <b aria-hidden="true">₹</b>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={priceInputRupees}
                        onChange={(event) => {
                          const next = event.target.value;
                          if (!/^\d*(?:\.\d{0,2})?$/.test(next)) return;
                          setPriceInputRupees(next);
                          if (next) setUnitPrice(Math.round(Number(next) * 100));
                        }}
                        aria-label="Negotiated wholesale price per item"
                      />
                    </span>
                  </label>
                  <p className="wholesale-price-note">
                    Suggested includes 10% margin on the oldest stock being sold. Negotiable range: {formatMoney(fifoCostPerUnit(selected, quantity))}–{formatMoney(Math.max(selectedListedPrice, selected.standardPricePaise, selected.mrpPaise))} per item.
                  </p>
                </fieldset>
                ) : (
                <fieldset>
                  <legend>Extra discount per item</legend>
                  <div className="preset-row">
                    <button disabled={!online && !offlineSellingReady} type="button" onClick={() => selectRegularPrice(Math.max(selectedListedPrice - maxExtraDiscount, Math.round(selectedListedPrice * 0.95)))}>5% off</button>
                    <button disabled={!online && !offlineSellingReady} type="button" onClick={() => selectRegularPrice(selectedListedPrice - suggestedDiscount)}>Suggested · {formatMoney(suggestedDiscount)}</button>
                    <button disabled={!online && !offlineSellingReady} type="button" onClick={() => selectRegularPrice(selectedListedPrice - maxExtraDiscount)}>Maximum · {formatMoney(maxExtraDiscount)}</button>
                  </div>
                  {!exceptionMode && (
                    <input
                      className="price-slider"
                      type="range"
                      min="0"
                      max={maxExtraDiscount}
                      step="100"
                      value={additionalDiscount}
                      onChange={(event) => setUnitPrice(selectedListedPrice - Number(event.target.value))}
                      aria-label="Additional discount"
                      disabled={!online && !offlineSellingReady}
                    />
                  )}
                  <div className="price-output">
                    <span>
                      Discount per item
                      <strong>{formatMoney(additionalDiscount)}{additionalDiscount > 0 ? ` (${additionalDiscountPercent}%)` : ""}</strong>
                    </span>
                    <span>
                      Final price per item
                      <strong>{formatMoney(unitPrice)}</strong>
                    </span>
                  </div>
                  {customerSaving > 0 && (
                    <p className="discount-saving-note">
                      Customer saves {formatMoney(customerSaving)} from MRP on this cart line.
                    </p>
                  )}
                </fieldset>
                )}

                <div className="checkout-total line-preview">
                  <span>Cart total · {quantity} {quantity === 1 ? "item" : "items"}</span>
                  <strong>{formatMoney(selectedTotal)}</strong>
                </div>
                <div className="line-editor-actions">
                  <button
                    aria-label="Close without applying"
                    className="secondary-button"
                    type="button"
                    onClick={() => setSelected(null)}
                  >
                    Close
                  </button>
                  <button
                    className="complete-button"
                    type="submit"
                    disabled={(!online && !offlineSellingReady)
                      || selectedAvailableQuantity < quantity
                      || queuedSalesBlockOnlineCheckout
                      || approval?.status === "PENDING"}
                  >
                    {!online && !offlineSellingReady
                      ? "Reconnect to continue"
                      : queuedSalesBlockOnlineCheckout
                        ? "Sync queued sales first"
                        : saleType === "WHOLESALE"
                          ? `Use ${formatMoney(unitPrice)} wholesale price`
                        : additionalDiscount > 0
                          ? `Apply ${formatMoney(additionalDiscount)} discount`
                          : "Keep selling price"}
                  </button>
                </div>
              </form>
              )}
            </Modal>

            <section className="cart-section" aria-labelledby="cart-heading">
              <div className="section-title">
                <h2 id="cart-heading">Cart</h2>
                <div className="cart-heading-actions">
                  <span>{cartUnits} {cartUnits === 1 ? "unit" : "units"}</span>
                  {cart.length > 0 && (
                    <button type="button" className="cancel-sale-action" onClick={cancelSale}>
                      Cancel sale
                    </button>
                  )}
                </div>
              </div>
              {cart.length === 0 ? (
                <>
                  <p className="cart-empty">No products added yet.</p>
                  <div className="payment-empty">
                    <span>Checkout</span>
                    <strong>Waiting for the first product</strong>
                    <p>Customer and payment options will appear here.</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="cart-lines">
                    {cart.map((line) => (
                      <article className="cart-row" key={line.product.id}>
                        <div>
                          <strong>{line.product.name}</strong>
                          <small>
                            {formatMoney(line.unitPricePaise)} each
                            {listedPrice(line.product, saleType, line.quantity) > line.unitPricePaise
                              ? ` · ${formatMoney(listedPrice(line.product, saleType, line.quantity) - line.unitPricePaise)} discount each`
                              : ""}
                            {line.exceptionMode ? " · approved" : ""}
                          </small>
                        </div>
                        <strong>{formatMoney(line.quantity * line.unitPricePaise)}</strong>
                        <div className="cart-actions">
                          <div className="cart-quantity" aria-label={`Quantity for ${line.product.name}`}>
                            <button
                              type="button"
                              aria-label={`Decrease ${line.product.name} quantity`}
                              onClick={() => changeCartQuantity(line, line.quantity - 1)}
                            >
                              −
                            </button>
                            <strong aria-live="polite">{line.quantity}</strong>
                            <button
                              type="button"
                              aria-label={`Increase ${line.product.name} quantity`}
                              onClick={() => changeCartQuantity(line, line.quantity + 1)}
                            >
                              +
                            </button>
                          </div>
                          <button type="button" onClick={() => chooseProduct(line.product)}>Discount</button>
                          <button type="button" onClick={() => removeCartLine(line.product.id)}>Remove</button>
                        </div>
                      </article>
                    ))}
                  </div>

                  <button
                    type="button"
                    className="cart-review sale-action-bar"
                    onClick={() => setCheckoutOpen(true)}
                  >
                    <span>Review payment · {cartUnits} {cartUnits === 1 ? "unit" : "units"}</span>
                    <strong>{formatMoney(cartTotal)}</strong>
                  </button>

                  {cart.length > 0 && (
                  <section className="sale-checkout-step" aria-label="Checkout">
                  <div className="sale-checkout-modal">
                  <form className="cart-checkout" onSubmit={submitSale}>
                    {!online && (
                      <p className="offline-read-only">
                        Retail Guest sale only. Cash or UPI. No customer details. The saved
                        permitted price and one-unit stock reserve are enforced.
                      </p>
                    )}
                    <fieldset className="online-only-checkout" hidden={!online}>
                    <section className="customer-section" aria-labelledby="customer-heading">
                      <div className="section-title customer-section-title">
                        <h3 id="customer-heading">Customer</h3>
                        <div className="customer-heading-actions">
                          <span>
                            {saleType === "WHOLESALE"
                              ? "Required for Wholesale"
                              : requiresCustomer
                                ? "Ask for details"
                                : "Optional"}
                          </span>
                          <button
                            type="button"
                            className="customer-add-action"
                            onClick={() => setShowNewCustomer(true)}
                          >
                            <svg viewBox="0 0 20 20" aria-hidden="true">
                              <path d="M10 4v12M4 10h12" />
                            </svg>
                            Add customer
                          </button>
                        </div>
                      </div>
                      {selectedCustomer ? (
                        <div className="selected-customer">
                          <span>
                            <strong>{selectedCustomer.name}</strong>
                            <small>
                              {selectedCustomer.phone ?? "Phone not added"} · {selectedCustomer.totalOrders} earlier orders
                            </small>
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedCustomer(null);
                              setCustomerQuery("");
                              setCustomerResults([]);
                              setActiveCustomerIndex(0);
                              requestAnimationFrame(() => {
                                customerSearchRef.current?.focus();
                              });
                            }}
                          >
                            Change
                          </button>
                        </div>
                      ) : (
                        <>
                          <div
                            className={`customer-quick-search${
                              customerResults.length ? " has-results" : ""
                            }`}
                          >
                            <input
                              ref={customerSearchRef}
                              value={customerQuery}
                              aria-label="Search customer by phone number or name"
                              aria-autocomplete="list"
                              aria-controls="sale-customer-results"
                              aria-expanded={customerResults.length > 0}
                              aria-activedescendant={customerResults[activeCustomerIndex]
                                ? `sale-customer-${customerResults[activeCustomerIndex].id}`
                                : undefined}
                              role="combobox"
                              placeholder="Search name or phone"
                              autoComplete="off"
                              onChange={(event) => {
                                const next = event.target.value;
                                setCustomerQuery(next);
                                setActiveCustomerIndex(0);
                                if (next.trim().length < 2) {
                                  setCustomerResults([]);
                                  setCustomerLoading(false);
                                }
                              }}
                              onKeyDown={(event) => {
                                if (!customerResults.length) return;
                                if (event.key === "ArrowDown") {
                                  event.preventDefault();
                                  setActiveCustomerIndex((current) =>
                                    (current + 1) % customerResults.length);
                                } else if (event.key === "ArrowUp") {
                                  event.preventDefault();
                                  setActiveCustomerIndex((current) =>
                                    (current - 1 + customerResults.length)
                                    % customerResults.length);
                                } else if (event.key === "Enter") {
                                  event.preventDefault();
                                  selectCustomer(customerResults[activeCustomerIndex]);
                                } else if (event.key === "Escape") {
                                  event.preventDefault();
                                  setCustomerResults([]);
                                }
                              }}
                            />
                            {customerLoading && (
                              <p className="customer-search-status">Searching customers…</p>
                            )}
                            {!customerLoading && customerQuery.trim().length >= 2 && customerResults.length === 0 && (
                              <p className="customer-search-status">No matching customer found.</p>
                            )}
                            {customerResults.length > 0 && (
                              <div
                                className="customer-results"
                                id="sale-customer-results"
                                role="listbox"
                                aria-label="Customer search results"
                              >
                                {customerResults.map((customer, index) => (
                                  <button
                                    type="button"
                                    role="option"
                                    aria-selected={index === activeCustomerIndex}
                                    className={index === activeCustomerIndex ? "is-active" : ""}
                                    id={`sale-customer-${customer.id}`}
                                    key={customer.id}
                                    onMouseEnter={() => setActiveCustomerIndex(index)}
                                    onClick={() => selectCustomer(customer)}
                                  >
                                    <span>
                                      <strong>{customer.name}</strong>
                                      <small>{customer.phone ?? "Phone not added"}{customer.locality ? ` · ${customer.locality}` : ""}</small>
                                    </span>
                                    <span>{customer.totalOrders} orders</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <Modal
                            open={showNewCustomer}
                            title="Add customer"
                            description={saleType === "WHOLESALE"
                              ? "Create the shopkeeper record and use it for this Wholesale sale. Only the name is required."
                              : "Save the customer and attach them to this sale. Only the name is required."}
                            onClose={() => setShowNewCustomer(false)}
                            panelClassName="new-customer-modal-panel"
                          >
                            <form
                              className="new-customer-fields"
                              onSubmit={(event) => {
                                event.preventDefault();
                                void createCustomer();
                              }}
                            >
                              <div className="form-row two-columns">
                                <label>Name
                                  <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} autoFocus required />
                                </label>
                                <label>Phone number (optional)
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
                                className="button new-customer-submit"
                                type="submit"
                                disabled={customerLoading || !customerName.trim()}
                              >
                                {customerLoading ? "Saving…" : "Save and select customer"}
                              </button>
                            </form>
                          </Modal>
                        </>
                      )}
                    </section>

                    <section className="payment-section" aria-labelledby="payment-heading">
                      <div className="section-title">
                        <h3 id="payment-heading">Payment</h3>
                        <span>
                          {recordDue ? "Balance due" : splitPayment ? "Two methods" : "Paid in full"}
                        </span>
                      </div>
                      <div className="form-row two-columns payment-method-fields">
                        <label>{splitPayment ? "First method" : "Payment method"}
                          <CustomSelect
                            value={paymentMode}
                            ariaLabel={splitPayment ? "First payment method" : "Payment method"}
                            options={paymentOptions}
                            onChange={(next) => {
                              setPaymentMode(next);
                              if (next === secondPaymentMode) {
                                setSecondPaymentMode(next === "UPI" ? "CASH" : "UPI");
                              }
                            }}
                          />
                        </label>
                        {recordDue ? (
                          <label>Received now (₹)
                            <input
                              type="number"
                              min="0"
                              max={Math.max(0, (cartTotal - 1) / 100)}
                              step="0.01"
                              inputMode="decimal"
                              value={amountReceivedRupees}
                              onChange={(event) => setAmountReceivedRupees(event.target.value)}
                              placeholder="0"
                            />
                          </label>
                        ) : splitPayment && (
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
                            <CustomSelect
                              value={secondPaymentMode}
                              ariaLabel="Second payment method"
                              options={paymentOptions.filter((option) => option.value !== paymentMode)}
                              onChange={setSecondPaymentMode}
                            />
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
                            if (event.target.checked) {
                              setRecordDue(false);
                              setAmountReceivedRupees("");
                            }
                            setFirstPaymentRupees("");
                          }}
                          disabled={recordDue}
                        />
                        Split payment
                      </label>
                      <label className="customer-toggle due-toggle">
                        <input
                          type="checkbox"
                          checked={recordDue}
                          onChange={(event) => {
                            setRecordDue(event.target.checked);
                            if (event.target.checked) {
                              setSplitPayment(false);
                              setFirstPaymentRupees("");
                            } else {
                              setAmountReceivedRupees("");
                            }
                          }}
                        />
                        Keep balance due
                      </label>
                      {recordDue && (
                        <div className="due-payment-fields">
                          <label>Reason for balance
                            <CustomSelect
                              value={dueReason}
                              ariaLabel="Reason payment is pending"
                              options={dueReasonOptions}
                              onChange={setDueReason}
                            />
                          </label>
                          <div className="due-balance">
                            <span>Balance due</span>
                            <strong>
                              {balanceDuePaise > 0 ? formatMoney(balanceDuePaise) : "—"}
                            </strong>
                          </div>
                          {!selectedCustomer && (
                            <p>Select a customer to track this balance.</p>
                          )}
                        </div>
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
                      <span>
                        <small>
                          {cart.length} {cart.length === 1 ? "product" : "products"}
                          {" · "}
                          {cartUnits} {cartUnits === 1 ? "unit" : "units"}
                        </small>
                        {recordDue && balanceDuePaise > 0
                          ? `${formatMoney(balanceDuePaise)} due`
                          : "Total"}
                      </span>
                      <strong>{formatMoney(cartTotal)}</strong>
                    </div>
                    <button
                      className="complete-button sale-action-bar"
                      type="submit"
                      disabled={!online || submitting || !guestCompletionReady
                        || queuedSalesBlockOnlineCheckout
                        || (!recordDue && splitPayment && !splitPaymentValid)
                        || !duePaymentValid}
                    >
                      <span>
                        {submitting
                          ? "Completing safely…"
                          : recordDue && balanceDuePaise > 0
                            ? `Complete sale · ${formatMoney(balanceDuePaise)} due`
                            : "Complete sale"}
                      </span>
                      <strong>{formatMoney(cartTotal)}</strong>
                    </button>
                    </fieldset>
                    {!online && (
                      <section className="offline-checkout" aria-label="Offline Guest checkout">
                        <div className="section-title">
                          <h3>Offline Guest sale</h3>
                          <span>Saved on this device first</span>
                        </div>
                        <label>Payment method
                          <CustomSelect
                            value={["CASH", "UPI"].includes(paymentMode) ? paymentMode : "UPI"}
                            ariaLabel="Offline payment method"
                            options={paymentOptions.slice(0, 2)}
                            onChange={setPaymentMode}
                            disabled={!offlineSellingReady}
                          />
                        </label>
                        {requiresCustomer && (
                          <p className="alert error" role="alert">
                            Reconnect for a Guest sale of ₹5,000 or more.
                          </p>
                        )}
                        <div className="checkout-total cart-total">
                          <span>
                            <small>
                              {cart.length} {cart.length === 1 ? "product" : "products"}
                              {" · "}
                              {cartUnits} {cartUnits === 1 ? "unit" : "units"}
                            </small>
                            Total
                          </span>
                          <strong>{formatMoney(cartTotal)}</strong>
                        </div>
                        <button
                          className="complete-button sale-action-bar"
                          type="submit"
                          disabled={!offlineSellingReady || submitting || requiresCustomer}
                        >
                          <span>{submitting ? "Saving safely…" : "Queue offline sale"}</span>
                          <strong>{formatMoney(cartTotal)}</strong>
                        </button>
                      </section>
                    )}
                  </form>
                  </div>
                  </section>
                  )}
                </>
              )}
            </section>
          </section>
        </div>

        <Modal
          open={Boolean(receipt)}
          title="Sale complete"
          description="Payment, stock and customer account were updated together."
          onClose={closeReceipt}
          panelClassName="receipt-modal-panel"
          footer={receipt ? (
            <div className="receipt-modal-footer">
              <div className="receipt-actions">
                <div className="receipt-share">
                  <button
                    type="button"
                    className="share-receipt-button"
                    aria-expanded={receiptExportOpen}
                    onClick={() => {
                      setReceiptExportOpen((open) => !open);
                      setReceiptExportStatus("");
                    }}
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <path d="M10 13V3m0 0L6.5 6.5M10 3l3.5 3.5M4 10v5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-5" />
                    </svg>
                    Share receipt
                  </button>

                  {receiptExportOpen && (
                    <div className="receipt-export-menu" aria-label="Receipt sharing options">
                      <button
                        type="button"
                        onClick={() => void exportReceipt("copy")}
                        disabled={Boolean(receiptExporting)}
                      >
                        <svg viewBox="0 0 20 20" aria-hidden="true">
                          <rect x="6" y="6" width="10" height="10" rx="2" />
                          <path d="M4 13H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1" />
                        </svg>
                        {receiptExporting === "copy" ? "Copying…" : "Copy as image"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void exportReceipt("pdf")}
                        disabled={Boolean(receiptExporting)}
                      >
                        <svg viewBox="0 0 20 20" aria-hidden="true">
                          <path d="M5 2h7l3 3v13H5zM11 2v4h4M7 14h6M7 11h6" />
                        </svg>
                        {receiptExporting === "pdf" ? "Preparing…" : "Download PDF"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void exportReceipt("image")}
                        disabled={Boolean(receiptExporting)}
                      >
                        <svg viewBox="0 0 20 20" aria-hidden="true">
                          <path d="M10 2v10m0 0l-4-4m4 4l4-4M3 15v3h14v-3" />
                        </svg>
                        {receiptExporting === "image" ? "Preparing…" : "Download image"}
                      </button>
                    </div>
                  )}
                </div>
                <button type="button" className="new-sale-button" onClick={closeReceipt}>
                  New sale
                </button>
              </div>

              {receiptExportStatus && (
                <p className="receipt-export-status" role="status">
                  {receiptExportStatus}
                </p>
              )}
            </div>
          ) : undefined}
        >
          {receipt && (
            <div
              className="thermal-receipt-modal"
              style={{
                "--receipt-feed-duration": `${Math.min(5.6, 2.4 + receipt.lines.length * 0.28)}s`,
              } as CSSProperties}
            >
              <div className="receipt-printer" aria-hidden="true">
                <span className="receipt-printer-light" />
                <span className="receipt-printer-slot" />
              </div>

              <article
                className={`thermal-receipt-paper${
                  receipt.balanceDuePaise > 0 ? " has-balance-due" : " is-paid"
                }`}
                aria-labelledby="receipt-heading"
              >
                <header className="thermal-receipt-brand">
                  <Image src="/logo.png" alt="" width={44} height={44} unoptimized />
                  <strong>ItsMyToy</strong>
                  <span>Wholesale &amp; Retail</span>
                  <h2 id="receipt-heading">Sale Receipt</h2>
                  <span className="receipt-payment-status">
                    {receipt.balanceDuePaise > 0
                      ? receipt.amountPaidPaise > 0
                        ? "Partly paid"
                        : "Payment due"
                      : "Paid"}
                  </span>
                </header>

                <dl className="thermal-receipt-meta">
                  <div>
                    <dt>Sale receipt no.</dt>
                    <dd>{receipt.saleNumber}</dd>
                  </div>
                  <div>
                    <dt>Date &amp; time</dt>
                    <dd>{receiptDate.format(new Date(receipt.completedAt))}</dd>
                  </div>
                  <div>
                    <dt>Sale type</dt>
                    <dd>{receipt.saleType === "WHOLESALE" ? "Wholesale" : "Retail"}</dd>
                  </div>
                  <div>
                    <dt>Customer</dt>
                    <dd>{receipt.customerName ?? "Walk-in customer"}</dd>
                  </div>
                </dl>

                <section className="thermal-receipt-items" aria-label="Items sold">
                  <div className="thermal-receipt-table-head" aria-hidden="true">
                    <span>Item</span>
                    <span>Amount</span>
                  </div>
                  {receipt.lines.map((line) => (
                    <div className="thermal-receipt-line" key={line.variantId}>
                      <span>
                        <strong>{line.productName}</strong>
                        <small>
                          {line.quantity} × {formatMoney(line.unitPricePaise)}
                          {" · "}
                          {line.sku}
                        </small>
                      </span>
                      <strong>{formatMoney(line.totalPaise)}</strong>
                    </div>
                  ))}
                </section>

                <section className="thermal-receipt-payment" aria-label="Payment summary">
                  {receiptDiscounts && receiptDiscounts.additionalDiscountPaise > 0 && (
                    <div className="thermal-additional-discount">
                      <span>Additional discount</span>
                      <strong>-{formatMoney(receiptDiscounts.additionalDiscountPaise)}</strong>
                    </div>
                  )}

                  {receiptDiscounts && receiptDiscounts.totalSavingPaise > 0 && (
                    <div className="thermal-total-saving">
                      <span>Total saving vs MRP</span>
                      <strong>{formatMoney(receiptDiscounts.totalSavingPaise)}</strong>
                    </div>
                  )}

                  {receipt.payments.length ? receipt.payments.map((payment) => (
                    <div key={payment.paymentMode}>
                      <span>Received by {paymentLabel(payment.paymentMode)}</span>
                      <strong>{formatMoney(payment.amountPaise)}</strong>
                    </div>
                  )) : (
                    <div>
                      <span>Payment received</span>
                      <strong>{formatMoney(0)}</strong>
                    </div>
                  )}

                  {receipt.balanceDuePaise > 0 && (
                    <div className="thermal-balance-due">
                      <span>
                        <strong>Balance due</strong>
                        <small>
                          {receipt.dueReason === "DIGITAL_PAYMENT_PENDING"
                            ? "Digital payment pending"
                            : "Customer will pay later"}
                        </small>
                      </span>
                      <strong>{formatMoney(receipt.balanceDuePaise)}</strong>
                    </div>
                  )}

                  <div className="thermal-grand-total">
                    <span>Grand total</span>
                    <strong>{formatMoney(receipt.totalPaise)}</strong>
                  </div>
                </section>

                <footer className="thermal-receipt-footer">
                  <strong>Thank you for shopping with us</strong>
                  <span>Keep this receipt for payment and exchange reference.</span>
                  <small>This is a sale receipt, not a GST tax invoice.</small>
                </footer>
              </article>
              <div className="receipt-tear-edge" aria-hidden="true">
                {Array.from({ length: 18 }, (_, index) => <span key={index} />)}
              </div>

            </div>
          )}
        </Modal>

        {!receipt && cart.length > 0 && !mobileCartOpen && !checkoutOpen && (
          <button
            type="button"
            className="mobile-cart-bar sale-action-bar"
            onClick={() => {
              setCheckoutOpen(false);
              setMobileCartOpen(true);
            }}
          >
            <span>View cart · {cartUnits} {cartUnits === 1 ? "unit" : "units"}</span>
            <strong>{formatMoney(cartTotal)}</strong>
          </button>
        )}
      </section>
    </AppShell>
  );
}
