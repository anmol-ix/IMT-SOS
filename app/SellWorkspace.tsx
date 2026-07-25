"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import BarcodeScanner from "./BarcodeScanner";

type Product = {
  id: string;
  name: string;
  variantName: string | null;
  sku: string;
  barcode: string;
  rackLocation: string | null;
  stock: number;
  mrpPaise: number;
  standardPricePaise: number;
  minimumPricePaise: number;
  inventoryValuePaise?: number;
  latestLandedCostPaise?: number;
  weightedAverageCostPaise?: number;
};

type Props = {
  displayName: string;
  role: "BUSINESS_OWNER" | "TRUSTED_OPERATOR" | "STORE_OPERATOR";
  initialProducts: Product[];
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

function formatMoney(paise: number) {
  return money.format(paise / 100);
}

function paymentLabel(mode: SaleReceipt["payments"][number]["paymentMode"]) {
  if (mode === "UPI") return "UPI";
  return mode === "BANK_TRANSFER"
    ? "Bank transfer"
    : mode.charAt(0) + mode.slice(1).toLowerCase();
}

function shareText(receipt: SaleReceipt) {
  return [
    "ItsMyToy sale receipt",
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

function roleLabel(role: Props["role"]) {
  if (role === "BUSINESS_OWNER") return "Business owner";
  if (role === "TRUSTED_OPERATOR") return "Trusted operator";
  return "Store operator";
}

export default function SellWorkspace({ displayName, role, initialProducts }: Props) {
  const [query, setQuery] = useState("");
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
      setUnitPrice(product.standardPricePaise);
      clearPriceException();
    }
  }

  function chooseProduct(product: Product) {
    const existing = cart.find((line) => line.product.id === product.id);
    setShowScanner(false);
    setSelected(product);
    setUnitPrice(existing?.unitPricePaise ?? product.standardPricePaise);
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

  async function findProducts(search = query) {
    setLoading(true);
    setError("");
    try {
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Products could not be loaded.");
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
      setMessage(`Barcode ${barcode} scanned.`);
    }
  }

  function saveCartLine(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    if (quantity > selected.stock) {
      setError("There is not enough stock for this quantity.");
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
  const maxExtraDiscount = selected
    ? selected.standardPricePaise - selected.minimumPricePaise
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
  const requiresCustomer = cartTotal >= 500_000;
  const guestCompletionReady = !requiresCustomer
    || Boolean(selectedCustomer)
    || (role === "BUSINESS_OWNER"
      ? ownerGuestOverride
      : guestApproval?.status === "APPROVED");

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="brand">ItsMyToy</p>
          <p className="welcome">Hi, {displayName}</p>
        </div>
        <nav className="app-nav" aria-label="Operations">
          {role === "BUSINESS_OWNER" && <Link href="/dashboard">Home</Link>}
          <Link className="active" href="/">Sell</Link>
          {role !== "STORE_OPERATOR" && <Link href="/receive">Receive</Link>}
          <Link href="/inventory">Inventory</Link>
          <Link href="/activity">Activity</Link>
        </nav>
        <span className="role-chip">{roleLabel(role)}</span>
      </header>

      <section className="sell-page" aria-labelledby="sell-heading">
        <div className="page-heading">
          <p className="eyebrow">{receipt ? "Sale complete" : "New retail sale"}</p>
          <h1 id="sell-heading">{receipt ? "Receipt ready." : "Scan. Price. Cart."}</h1>
          <p>
            {receipt
              ? "The sale, payments and stock deduction were saved together."
              : "Every product, price and stock balance is checked again at checkout."}
          </p>
        </div>

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
            <button type="submit" disabled={loading}>{loading ? "Finding…" : "Find"}</button>
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
                    <span className={`stock-pill${product.stock === 0 ? " empty" : ""}`}>
                      {inCart ? `${inCart.quantity} in cart` : `${product.stock} in stock`}
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
                  <span className="stock-large">{selected.stock}<small>available</small></span>
                </div>

                <div className="price-summary">
                  <div><span>MRP</span><strong>{formatMoney(selected.mrpPaise)}</strong></div>
                  <div><span>Standard</span><strong>{formatMoney(selected.standardPricePaise)}</strong></div>
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
                    <button type="button" onClick={() => selectRegularPrice(selected.standardPricePaise)}>Standard</button>
                    <button type="button" onClick={() => selectRegularPrice(Math.max(selected.minimumPricePaise, Math.round(selected.standardPricePaise * 0.95)))}>5% off</button>
                    <button type="button" onClick={() => selectRegularPrice(selected.minimumPricePaise)}>Maximum</button>
                  </div>
                  {!exceptionMode && (
                    <input
                      className="price-slider"
                      type="range"
                      min={selected.minimumPricePaise}
                      max={selected.standardPricePaise}
                      step="500"
                      value={unitPrice}
                      onChange={(event) => setUnitPrice(Number(event.target.value))}
                      aria-label="Final unit price"
                    />
                  )}
                  <div className="price-output">
                    <strong>{formatMoney(unitPrice)}</strong>
                    <span>{exceptionMode ? "Owner-authorized exception" : `Up to ${formatMoney(maxExtraDiscount)} extra discount allowed`}</span>
                  </div>
                </fieldset>

                <section className="exception-box" aria-label="Lower price approval">
                  {!showLowerPrice ? (
                    <button type="button" className="text-button" onClick={() => setShowLowerPrice(true)}>
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
                              setUnitPrice(selected.standardPricePaise);
                            }}
                            inputMode="decimal"
                          />
                        </label>
                        <button type="button" onClick={requestLowerPrice} disabled={checkingApproval}>
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
                      <button type="button" className="text-button muted" onClick={() => selectRegularPrice(selected.standardPricePaise)}>Cancel lower price</button>
                    </>
                  )}
                </section>

                <div className="form-row">
                  <label>Quantity
                    <input
                      type="number"
                      min="1"
                      max={selected.stock}
                      value={quantity}
                      onChange={(event) => changeQuantity(Number(event.target.value), selected)}
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
                  disabled={selected.stock < quantity || approval?.status === "PENDING"}
                >
                  {cart.some((line) => line.product.id === selected.id) ? "Update cart" : "Add to cart"}
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
                        <span>{requiresCustomer ? "Ask for details" : "Optional"}</span>
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
                          {showCustomerFinder && (
                            <div className="customer-finder">
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
                          )}
                        </>
                      )}
                    </section>

                    {requiresCustomer && !selectedCustomer && (
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
                      disabled={submitting || !guestCompletionReady
                        || (splitPayment && !splitPaymentValid)}
                    >
                      {submitting ? "Completing all lines safely…" : "Complete sale"}
                    </button>
                  </form>
                </>
              )}
            </section>
          </section>
        </div>}
      </section>
    </main>
  );
}
