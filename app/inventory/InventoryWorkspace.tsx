"use client";

import { FormEvent, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import { buildLabelCsv } from "@/shared/label-csv";

type Role = "BUSINESS_OWNER" | "TRUSTED_OPERATOR" | "STORE_OPERATOR";
type StockCondition = "SELLABLE" | "OPEN_BOX" | "DAMAGED";
type ReorderPolicyStatus = "UNCONFIGURED" | "CONFIGURED" | "DISABLED";

type Product = {
  id: string;
  name: string;
  category: string | null;
  variantName: string | null;
  sku: string;
  barcode: string;
  rackLocation: string | null;
  stock: number;
  openBoxStock?: number;
  damagedStock?: number;
  mrpPaise: number;
  standardPricePaise: number;
  wholesalePricePaise: number;
  minimumPricePaise: number;
  inventoryValuePaise?: number;
  weightedAverageCostPaise?: number;
  latestLandedCostPaise?: number;
  reorderPoint?: number | null;
  restockTarget?: number | null;
};

type Movement = {
  id: string;
  movementType: string;
  stockCondition: string;
  quantityDelta: number;
  referenceType: string;
  referenceLabel: string;
  actorName: string;
  happenedAt: string;
  reason: string | null;
  note: string | null;
};

type Inventory = {
  product: {
    id: string;
    name: string;
    category: string | null;
    variantName: string | null;
    sku: string;
    barcode: string;
    rackLocation: string | null;
    mrpPaise: number;
    standardPricePaise: number;
    wholesalePricePaise: number;
    minimumPricePaise: number;
    reorderPolicyStatus?: ReorderPolicyStatus;
    reorderPoint?: number | null;
    restockTarget?: number | null;
  };
  balances: Record<StockCondition, number>;
  ledgerBalances: Record<StockCondition, number>;
  reconciled: boolean;
  inventoryValuePaise?: number;
  weightedAverageCostPaise?: number;
  latestLandedCostPaise?: number;
  movementCount: number;
  movements: Movement[];
  purchases: Array<{
    id: string;
    receiptNumber: string;
    supplierName: string;
    supplierInvoiceReference: string | null;
    sellableQuantity: number;
    openBoxQuantity: number;
    damagedQuantity: number;
    invoiceUnitCostPaise?: number;
    happenedAt: string;
  }>;
  sales: Array<{
    id: string;
    saleNumber: string;
    customerName: string;
    salesChannel: string;
    saleType: "RETAIL" | "WHOLESALE";
    quantity: number;
    unitPricePaise: number;
    mrpPaise: number;
    standardPricePaise: number;
    wholesalePricePaise: number;
    accountingCogsPaise?: number;
    grossProductProfitPaise?: number;
    happenedAt: string;
  }>;
};

type InventoryFilter = "ALL" | "LOW" | "OUT" | "MISSING_RACK";
type DetailTab = "OVERVIEW" | "PURCHASES" | "SALES" | "MOVEMENTS";

type Props = {
  displayName: string;
  role: Role;
  initialProducts: Product[];
  initialInventory?: Inventory;
};

const conditions: Array<[StockCondition, string]> = [
  ["SELLABLE", "Sellable"],
  ["OPEN_BOX", "Open box"],
  ["DAMAGED", "Damaged"],
];

const reasons = [
  ["PHYSICAL_COUNT", "Routine physical count"],
  ["DAMAGE_OR_PACKAGING_FOUND", "Damage or packaging issue found"],
  ["LOSS_OR_MISSING", "Lost or missing stock"],
  ["FOUND_STOCK", "Stock found during checking"],
  ["DATA_CORRECTION", "Earlier data-entry correction"],
  ["OTHER", "Other"],
] as const;

const reorderReasons = [
  ["INITIAL_SETUP", "Initial setup"],
  ["SALES_VELOCITY", "Recent sales rate"],
  ["SUPPLIER_LEAD_TIME", "Supplier lead time"],
  ["SEASONALITY", "Seasonal demand"],
  ["STORAGE_CAPACITY", "Available storage"],
  ["DATA_CORRECTION", "Earlier data-entry correction"],
  ["OTHER", "Other"],
] as const;

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});
const happenedAt = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

function formatMoney(paise: number) {
  return money.format(paise / 100);
}

function conditionLabel(condition: string) {
  return condition === "OPEN_BOX"
    ? "Open box"
    : condition.charAt(0) + condition.slice(1).toLowerCase();
}

function movementLabel(type: string) {
  const labels: Record<string, string> = {
    OPENING: "Opening balance",
    RECEIPT: "Supplier receipt",
    SALE: "Retail sale",
    ADJUSTMENT: "Approved stock count",
    REVERSAL: "Reversal",
  };
  return labels[type] ?? type.replaceAll("_", " ").toLowerCase();
}

function reasonLabel(reason: string) {
  return reasons.find(([value]) => value === reason)?.[1]
    ?? reason.replaceAll("_", " ").toLowerCase();
}

function SalePriceTrend({ sales }: { sales: Inventory["sales"] }) {
  const points = [...sales].reverse().slice(-20);
  if (!points.length) {
    return <p className="inventory-empty-copy">No completed sales for this SKU yet.</p>;
  }
  const values = points.map((sale) => sale.unitPricePaise);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const spread = Math.max(maximum - minimum, 1);
  const coordinates = points.map((sale, index) => {
    const x = points.length === 1 ? 150 : 8 + (index / (points.length - 1)) * 284;
    const y = 88 - ((sale.unitPricePaise - minimum) / spread) * 72;
    return `${x},${y}`;
  }).join(" ");

  return (
    <figure className="sale-price-trend">
      <div>
        <span>Lowest {formatMoney(minimum)}</span>
        <span>Highest {formatMoney(maximum)}</span>
      </div>
      <svg viewBox="0 0 300 96" role="img" aria-label="Selling price trend">
        <path d="M8 88H292" />
        <polyline points={coordinates} />
        {coordinates.split(" ").map((point) => {
          const [cx, cy] = point.split(",");
          return <circle cx={cx} cy={cy} r="3" key={point} />;
        })}
      </svg>
      <figcaption>Final unit price across the latest {points.length} sale lines</figcaption>
    </figure>
  );
}

export default function InventoryWorkspace({
  displayName,
  role,
  initialProducts,
  initialInventory,
}: Props) {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState(initialProducts);
  const [filter, setFilter] = useState<InventoryFilter>("ALL");
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<DetailTab>("OVERVIEW");
  const [selectedId, setSelectedId] = useState(initialInventory?.product.id ?? "");
  const [inventory, setInventory] = useState<Inventory | null>(initialInventory ?? null);
  const [condition, setCondition] = useState<StockCondition>("SELLABLE");
  const [countedQuantity, setCountedQuantity] = useState("");
  const [reason, setReason] = useState("PHYSICAL_COUNT");
  const [note, setNote] = useState("");
  const [policyEnabled, setPolicyEnabled] = useState(
    initialInventory?.product.reorderPolicyStatus === "CONFIGURED",
  );
  const [reorderPoint, setReorderPoint] = useState(
    initialInventory?.product.reorderPoint?.toString() ?? "",
  );
  const [restockTarget, setRestockTarget] = useState(
    initialInventory?.product.restockTarget?.toString() ?? "",
  );
  const [policyReason, setPolicyReason] = useState("INITIAL_SETUP");
  const [policyNote, setPolicyNote] = useState("");
  const [policySaving, setPolicySaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const recordedQuantity = inventory?.balances[condition] ?? 0;
  const parsedCount = Number(countedQuantity);
  const validCount = countedQuantity !== ""
    && Number.isInteger(parsedCount)
    && parsedCount >= 0;
  const difference = validCount ? parsedCount - recordedQuantity : 0;
  const canRequest = role !== "STORE_OPERATOR";
  const parsedReorderPoint = Number(reorderPoint);
  const parsedRestockTarget = Number(restockTarget);
  const validConfiguredPolicy = policyEnabled
    && reorderPoint !== ""
    && restockTarget !== ""
    && Number.isInteger(parsedReorderPoint)
    && Number.isInteger(parsedRestockTarget)
    && parsedReorderPoint >= 0
    && parsedReorderPoint <= 100_000
    && parsedRestockTarget > parsedReorderPoint
    && parsedRestockTarget <= 100_000;
  const policyChanged = inventory
    ? policyEnabled
      ? inventory.product.reorderPoint !== parsedReorderPoint
        || inventory.product.restockTarget !== parsedRestockTarget
      : inventory.product.reorderPolicyStatus === "CONFIGURED"
    : false;
  const canSavePolicy = role === "BUSINESS_OWNER"
    && (policyEnabled ? validConfiguredPolicy : policyChanged)
    && policyChanged
    && policyNote.trim().length >= 3;

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedId),
    [products, selectedId],
  );

  const filteredProducts = useMemo(() => {
    const term = query.trim().toLowerCase();
    return products.filter((product) => {
      const matchesSearch = !term || [
        product.name,
        product.variantName,
        product.sku,
        product.barcode,
        product.rackLocation,
        product.category,
      ].some((value) => value?.toLowerCase().includes(term));
      const matchesFilter =
        filter === "ALL"
        || (filter === "OUT" && product.stock === 0)
        || (
          filter === "LOW"
          && product.reorderPoint !== null
          && product.reorderPoint !== undefined
          && product.stock <= product.reorderPoint
        )
        || (filter === "MISSING_RACK" && !product.rackLocation);
      return matchesSearch && matchesFilter;
    });
  }, [filter, products, query]);
  const selectedShownCount = filteredProducts.filter(
    (product) => selectedLabels.includes(product.id),
  ).length;

  const inventorySummary = useMemo(() => ({
    units: products.reduce((sum, product) => sum + product.stock, 0),
    valuePaise: products.reduce(
      (sum, product) => sum + (product.inventoryValuePaise ?? 0),
      0,
    ),
    outOfStock: products.filter((product) => product.stock === 0).length,
    lowStock: products.filter(
      (product) => product.reorderPoint !== null
        && product.reorderPoint !== undefined
        && product.stock <= product.reorderPoint,
    ).length,
  }), [products]);

  function toggleLabel(id: string) {
    setSelectedLabels((current) => current.includes(id)
      ? current.filter((selected) => selected !== id)
      : [...current, id]);
  }

  function exportLabels() {
    const selected = products.filter((product) => selectedLabels.includes(product.id));
    if (!selected.length) return;
    const csv = buildLabelCsv(selected.map((product) => ({
      sku: product.sku,
      barcode: product.barcode,
      productName: product.name,
      variantName: product.variantName,
      mrpPaise: product.mrpPaise,
      standardPricePaise: product.standardPricePaise,
      rackLocation: product.rackLocation,
    })));
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `ItsMyToy-labels-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage(`${selected.length} SKU${selected.length === 1 ? "" : "s"} exported for labels.`);
  }

  async function selectProduct(product: Product) {
    setSelectedId(product.id);
    setInventory(null);
    setLoading(true);
    setError("");
    setMessage("");
    setCountedQuantity("");
    setNote("");
    setPolicyEnabled(false);
    setReorderPoint("");
    setRestockTarget("");
    setPolicyReason("INITIAL_SETUP");
    setPolicyNote("");
    setActiveTab("OVERVIEW");
    try {
      const response = await fetch(`/api/v1/inventory/${product.id}/history`);
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error?.message ?? "Inventory history could not be loaded.");
      }
      setInventory(body.inventory);
      setPolicyEnabled(body.inventory.product.reorderPolicyStatus === "CONFIGURED");
      setReorderPoint(body.inventory.product.reorderPoint?.toString() ?? "");
      setRestockTarget(body.inventory.product.restockTarget?.toString() ?? "");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Inventory history could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function submitReorderPolicy(event: FormEvent) {
    event.preventDefault();
    if (!inventory) return;
    if (policyEnabled && !validConfiguredPolicy) {
      setError(
        "Enter whole numbers and keep the restock target above the reorder point.",
      );
      return;
    }
    if (!policyChanged) {
      setError("Change the reorder settings before saving.");
      return;
    }
    if (policyNote.trim().length < 3) {
      setError("Add a short note explaining this replenishment decision.");
      return;
    }

    setPolicySaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `/api/v1/inventory/${inventory.product.id}/reorder-policy`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            reorderPoint: policyEnabled ? parsedReorderPoint : null,
            restockTarget: policyEnabled ? parsedRestockTarget : null,
            reason: policyReason,
            note: policyNote.trim(),
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error?.message ?? "The reorder policy could not be saved.");
      }
      setInventory((current) => current
        ? {
            ...current,
            product: {
              ...current.product,
              reorderPolicyStatus: body.change.policy.status,
              reorderPoint: body.change.policy.reorderPoint,
              restockTarget: body.change.policy.restockTarget,
            },
          }
        : current);
      setProducts((current) => current.map((product) => product.id === inventory.product.id
        ? {
            ...product,
            reorderPoint: body.change.policy.reorderPoint,
            restockTarget: body.change.policy.restockTarget,
          }
        : product));
      setPolicyNote("");
      setMessage(
        body.change.policy.status === "CONFIGURED"
          ? `Reorder policy saved: alert at ${body.change.policy.reorderPoint}, `
            + `restock to ${body.change.policy.restockTarget}. Stock did not change.`
          : "Reorder policy disabled. Stock did not change.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The reorder policy could not be saved.",
      );
    } finally {
      setPolicySaving(false);
    }
  }

  async function submitCount(event: FormEvent) {
    event.preventDefault();
    if (!inventory || !validCount) {
      setError("Enter the whole quantity physically present.");
      return;
    }
    if (difference === 0) {
      setError("The physical count already matches the recorded quantity.");
      return;
    }
    if (note.trim().length < 3) {
      setError("Add a short note explaining when and how the stock was counted.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/v1/stock-adjustments", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          variantId: inventory.product.id,
          stockCondition: condition,
          countedQuantity: parsedCount,
          reason,
          note: note.trim(),
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error?.message ?? "The count could not be submitted.");
      }
      setMessage(
        `Count submitted: ${conditionLabel(condition)} ${recordedQuantity} → ${parsedCount}. `
        + "Stock has not changed; a business owner must approve the difference.",
      );
      setCountedQuantity("");
      setNote("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The count could not be submitted.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell displayName={displayName} role={role}>
      <section className="sell-page inventory-page" aria-labelledby="inventory-heading">
        <PageHeader
          eyebrow="Stock in hand"
          headingId="inventory-heading"
          title="Inventory"
          description="Know what is available, what it cost and how every SKU moved."
        />

        {error && <p className="alert error" role="alert">{error}</p>}
        {message && <p className="alert success" role="status">{message}</p>}

        <section className="inventory-kpis" aria-label="Inventory summary">
          <article>
            <small>Active SKUs</small>
            <strong>{products.length}</strong>
          </article>
          <article>
            <small>Units in stock</small>
            <strong>{inventorySummary.units}</strong>
          </article>
          {role === "BUSINESS_OWNER" && (
            <article>
              <small>Stock cost value</small>
              <strong>{formatMoney(inventorySummary.valuePaise)}</strong>
            </article>
          )}
          <article className={inventorySummary.lowStock ? "watch" : ""}>
            <small>Low stock</small>
            <strong>{inventorySummary.lowStock}</strong>
          </article>
          <article className={inventorySummary.outOfStock ? "risk" : ""}>
            <small>Out of stock</small>
            <strong>{inventorySummary.outOfStock}</strong>
          </article>
        </section>

        <section className="inventory-toolbar" aria-label="Find and filter inventory">
          <label className="inventory-search-field">
            <span>Find a SKU</span>
            <input
              id="inventory-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Product, SKU, barcode or rack"
            />
          </label>
          <label>
            <span>Show</span>
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as InventoryFilter)}
            >
              <option value="ALL">All stock</option>
              <option value="LOW">Low stock</option>
              <option value="OUT">Out of stock</option>
              <option value="MISSING_RACK">Rack missing</option>
            </select>
          </label>
          <div className="inventory-label-actions" aria-label="Label CSV selection">
            <span aria-live="polite">
              <strong>{selectedLabels.length}</strong>
              <small>SKUs selected for labels</small>
            </span>
            <button
              className="button secondary"
              type="button"
              onClick={() => setSelectedLabels((current) => [
                ...new Set([
                  ...current,
                  ...filteredProducts.map((product) => product.id),
                ]),
              ])}
              disabled={
                !filteredProducts.length
                || selectedShownCount === filteredProducts.length
              }
            >
              Add shown
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => setSelectedLabels([])}
              disabled={!selectedLabels.length}
            >
              Clear
            </button>
            <button
              className="button"
              type="button"
              onClick={exportLabels}
              disabled={!selectedLabels.length}
            >
              Download CSV
            </button>
          </div>
        </section>

        <div className="inventory-layout inventory-command-center">
          <section className="inventory-products" aria-labelledby="inventory-products-heading">
            <div className="section-title">
              <h2 id="inventory-products-heading">Stock list</h2>
              <span>{filteredProducts.length} shown</span>
            </div>
            {filteredProducts.length ? (
              <div className="inventory-table-wrap">
                <table className="inventory-table">
                  <thead>
                    <tr>
                      <th aria-label="Select for labels" />
                      <th>Product</th>
                      <th>Rack</th>
                      <th>In stock</th>
                      <th>Retail price</th>
                      {role === "BUSINESS_OWNER" && <th>Avg. cost</th>}
                      {role === "BUSINESS_OWNER" && <th>Stock value</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.map((product) => {
                      const low = product.reorderPoint !== null
                        && product.reorderPoint !== undefined
                        && product.stock <= product.reorderPoint;
                      return (
                        <tr
                          className={selectedId === product.id ? "selected" : ""}
                          key={product.id}
                        >
                          <td data-label="Label">
                            <input
                              type="checkbox"
                              checked={selectedLabels.includes(product.id)}
                              onChange={() => toggleLabel(product.id)}
                              aria-label={`Select ${product.name} for label export`}
                            />
                          </td>
                          <td data-label="Product">
                            <button
                              type="button"
                              className="inventory-product-link"
                              onClick={() => selectProduct(product)}
                            >
                              <strong>{product.name}</strong>
                              <small>
                                {product.variantName ? `${product.variantName} · ` : ""}
                                {product.sku}
                              </small>
                            </button>
                          </td>
                          <td data-label="Rack">{product.rackLocation ?? "Not set"}</td>
                          <td data-label="In stock">
                            <strong>{product.stock}</strong>
                            <small className={product.stock === 0 ? "stock-state out" : low ? "stock-state low" : "stock-state"}>
                              {product.stock === 0 ? "Out" : low ? "Low" : "Available"}
                            </small>
                          </td>
                          <td data-label="Retail price">{formatMoney(product.standardPricePaise)}</td>
                          {role === "BUSINESS_OWNER" && (
                            <td data-label="Avg. cost">
                              {formatMoney(product.weightedAverageCostPaise ?? 0)}
                            </td>
                          )}
                          {role === "BUSINESS_OWNER" && (
                            <td data-label="Stock value">
                              {formatMoney(product.inventoryValuePaise ?? 0)}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="inventory-empty-copy">No SKUs match this search or filter.</p>
            )}
          </section>

          <section className="inventory-detail" aria-live="polite">
            {!selectedProduct && !loading && (
              <div className="inventory-empty">
                <span>↗</span>
                <h2>Select a SKU</h2>
                <p>Its stock, purchases, sales and movement history will appear here.</p>
              </div>
            )}
            {loading && selectedProduct && (
              <div className="inventory-empty"><p>Loading SKU details…</p></div>
            )}
            {inventory && (
              <>
                <div className="inventory-detail-heading">
                  <div>
                    <p className="eyebrow">{inventory.product.sku}</p>
                    <h2>{inventory.product.name}</h2>
                    <p>
                      {inventory.product.variantName
                        ? `${inventory.product.variantName} · `
                        : ""}
                      {inventory.product.rackLocation ?? "Rack not assigned"}
                    </p>
                  </div>
                  <span className={inventory.reconciled ? "ledger-ok" : "ledger-warning"}>
                    {inventory.reconciled
                      ? "Stock records match"
                      : "Stock needs checking"}
                  </span>
                </div>
                <nav className="inventory-tabs" aria-label="SKU information">
                  {([
                    ["OVERVIEW", "Overview"],
                    ["PURCHASES", `Purchases (${inventory.purchases.length})`],
                    ["SALES", `Sales (${inventory.sales.length})`],
                    ["MOVEMENTS", `Movements (${inventory.movementCount})`],
                  ] as Array<[DetailTab, string]>).map(([value, label]) => (
                    <button
                      type="button"
                      className={activeTab === value ? "active" : ""}
                      onClick={() => setActiveTab(value)}
                      key={value}
                    >
                      {label}
                    </button>
                  ))}
                </nav>

                {activeTab === "OVERVIEW" && (
                  <>
                <section className="inventory-summary">
                  <div className="balance-grid">
                    {conditions.map(([value, label]) => (
                      <div key={value}>
                        <small>{label}</small>
                        <strong>{inventory.balances[value]}</strong>
                        <span>Recorded total {inventory.ledgerBalances[value]}</span>
                      </div>
                    ))}
                  </div>
                  <div className="inventory-price-grid">
                    <div>
                      <small>MRP</small>
                      <strong>{formatMoney(inventory.product.mrpPaise)}</strong>
                    </div>
                    <div>
                      <small>Retail price</small>
                      <strong>{formatMoney(inventory.product.standardPricePaise)}</strong>
                    </div>
                    <div>
                      <small>Wholesale price</small>
                      <strong>{formatMoney(inventory.product.wholesalePricePaise)}</strong>
                    </div>
                    <div>
                      <small>Your lowest price</small>
                      <strong>{formatMoney(inventory.product.minimumPricePaise)}</strong>
                    </div>
                  </div>
                  {inventory.inventoryValuePaise !== undefined && (
                    <div className="owner-cost-grid">
                      <div>
                        <small>Stock cost value</small>
                        <strong>{formatMoney(inventory.inventoryValuePaise)}</strong>
                      </div>
                      <div>
                        <small>Average cost</small>
                        <strong>{formatMoney(inventory.weightedAverageCostPaise ?? 0)}</strong>
                      </div>
                      <div>
                        <small>Last purchase cost</small>
                        <strong>{formatMoney(inventory.latestLandedCostPaise ?? 0)}</strong>
                      </div>
                    </div>
                  )}
                </section>

                {role === "BUSINESS_OWNER" && (
                  <section className="reorder-panel" aria-labelledby="reorder-heading">
                    <div className="reorder-panel-heading">
                      <div>
                        <p className="eyebrow">Low-stock alert</p>
                        <h2 id="reorder-heading">When should we buy more?</h2>
                      </div>
                      <span
                        className={`reorder-status ${
                          inventory.product.reorderPolicyStatus?.toLowerCase() ?? ""
                        }`}
                      >
                        {inventory.product.reorderPolicyStatus ?? "Unconfigured"}
                      </span>
                    </div>
                    <form onSubmit={submitReorderPolicy}>
                      <label className="reorder-toggle">
                        <input
                          type="checkbox"
                          checked={policyEnabled}
                          onChange={(event) => setPolicyEnabled(event.target.checked)}
                        />
                        Warn me when this SKU is running low
                      </label>
                      {policyEnabled && (
                        <>
                          <div className="form-row two-columns">
                            <label>Alert when sellable stock reaches
                              <input
                                type="number"
                                min="0"
                                max="100000"
                                step="1"
                                value={reorderPoint}
                                onChange={(event) => setReorderPoint(event.target.value)}
                                placeholder="Example: 2"
                              />
                            </label>
                            <label>Restock up to
                              <input
                                type="number"
                                min="1"
                                max="100000"
                                step="1"
                                value={restockTarget}
                                onChange={(event) => setRestockTarget(event.target.value)}
                                placeholder="Example: 8"
                              />
                            </label>
                          </div>
                          {validConfiguredPolicy && (
                            <div className="reorder-preview">
                              <strong>
                                {inventory.balances.SELLABLE <= parsedReorderPoint
                                  ? `Order ${Math.max(
                                    parsedRestockTarget - inventory.balances.SELLABLE,
                                    0,
                                  )} now`
                                  : `Alert after ${
                                    inventory.balances.SELLABLE - parsedReorderPoint
                                  } more unit${
                                    inventory.balances.SELLABLE - parsedReorderPoint === 1
                                      ? ""
                                      : "s"
                                  } sell`}
                              </strong>
                              <span>
                                Current sellable stock is {inventory.balances.SELLABLE}.
                                Saving this policy never changes stock.
                              </span>
                            </div>
                          )}
                        </>
                      )}
                      <div className="form-row two-columns">
                        <label>Why these quantities?
                          <select
                            value={policyReason}
                            onChange={(event) => setPolicyReason(event.target.value)}
                          >
                            {reorderReasons.map(([value, label]) => (
                              <option value={value} key={value}>{label}</option>
                            ))}
                          </select>
                        </label>
                        <label>Short note
                          <textarea
                            value={policyNote}
                            onChange={(event) => setPolicyNote(event.target.value)}
                            maxLength={500}
                            placeholder="Example: Two-week supplier lead time"
                          />
                        </label>
                      </div>
                      <button
                        type="submit"
                        className="complete-button"
                        disabled={policySaving || !canSavePolicy}
                      >
                        {policySaving
                          ? "Saving…"
                          : policyEnabled
                            ? "Save low-stock alert"
                            : inventory.product.reorderPolicyStatus === "CONFIGURED"
                              ? "Turn off low-stock alert"
                              : "Low-stock alert not set"}
                      </button>
                    </form>
                  </section>
                )}

                <section className="count-panel" aria-labelledby="count-heading">
                  <p className="eyebrow">Stock check</p>
                  <h2 id="count-heading">Count what is physically present</h2>
                  {canRequest ? (
                    <form onSubmit={submitCount}>
                      <div className="form-row two-columns">
                        <label>Condition
                          <select
                            value={condition}
                            onChange={(event) => {
                              setCondition(event.target.value as StockCondition);
                              setCountedQuantity("");
                            }}
                          >
                            {conditions.map(([value, label]) => (
                              <option value={value} key={value}>{label}</option>
                            ))}
                          </select>
                        </label>
                        <label>Recorded quantity
                          <input value={recordedQuantity} readOnly />
                        </label>
                      </div>
                      <div className="count-entry">
                        <label>Quantity physically present
                          <input
                            type="number"
                            min="0"
                            max="100000"
                            step="1"
                            value={countedQuantity}
                            onChange={(event) => setCountedQuantity(event.target.value)}
                            placeholder="Enter the count"
                          />
                        </label>
                        <div className={`count-difference ${
                          difference < 0 ? "negative" : difference > 0 ? "positive" : ""
                        }`}>
                          <small>Difference</small>
                          <strong>
                            {validCount
                              ? `${difference > 0 ? "+" : ""}${difference}`
                              : "—"}
                          </strong>
                        </div>
                      </div>
                      <div className="form-row two-columns">
                        <label>Reason
                          <select value={reason} onChange={(event) => setReason(event.target.value)}>
                            {reasons.map(([value, label]) => (
                              <option value={value} key={value}>{label}</option>
                            ))}
                          </select>
                        </label>
                        <label>Count note
                          <textarea
                            value={note}
                            onChange={(event) => setNote(event.target.value)}
                            maxLength={500}
                            placeholder="Example: Counted rack C2-S4 at closing"
                          />
                        </label>
                      </div>
                      <div className="count-safety">
                        <strong>Submitting does not change stock.</strong>
                        <span>
                          An owner reviews the exact recorded and counted quantities.
                          If stock changes first, this request cannot be applied.
                        </span>
                      </div>
                      <button
                        type="submit"
                        className="complete-button"
                        disabled={saving || !validCount || difference === 0 || note.trim().length < 3}
                      >
                        {saving ? "Submitting…" : "Submit difference for approval"}
                      </button>
                    </form>
                  ) : (
                    <p className="view-only-note">
                      Store operators can view balances and history. A trusted operator
                      or business owner must perform and submit physical counts.
                    </p>
                  )}
                </section>
                  </>
                )}

                {activeTab === "PURCHASES" && (
                  <section className="inventory-history-panel" aria-labelledby="purchase-history-heading">
                    <div className="section-title">
                      <div>
                        <h2 id="purchase-history-heading">Purchase history</h2>
                        <p>When this SKU arrived, from whom and at what cost.</p>
                      </div>
                      <span>{inventory.purchases.length} receipts</span>
                    </div>
                    {inventory.purchases.length ? (
                      <div className="inventory-history-list">
                        {inventory.purchases.map((purchase) => (
                          <article key={purchase.id}>
                            <div>
                              <strong>{purchase.supplierName}</strong>
                              <small>
                                {purchase.receiptNumber}
                                {purchase.supplierInvoiceReference
                                  ? ` · Bill ${purchase.supplierInvoiceReference}`
                                  : ""}
                              </small>
                            </div>
                            <div>
                              <strong>
                                {purchase.sellableQuantity + purchase.openBoxQuantity + purchase.damagedQuantity}
                                {" "}received
                              </strong>
                              <small>
                                {purchase.openBoxQuantity
                                  ? `${purchase.openBoxQuantity} open box · `
                                  : ""}
                                {purchase.damagedQuantity
                                  ? `${purchase.damagedQuantity} damaged`
                                  : "Sellable stock"}
                              </small>
                            </div>
                            {purchase.invoiceUnitCostPaise !== undefined && (
                              <div>
                                <strong>{formatMoney(purchase.invoiceUnitCostPaise)} each</strong>
                                <small>Purchase cost</small>
                              </div>
                            )}
                            <time>{happenedAt.format(new Date(purchase.happenedAt))}</time>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="inventory-empty-copy">No completed stock receipts for this SKU yet.</p>
                    )}
                  </section>
                )}

                {activeTab === "SALES" && (
                  <section className="inventory-history-panel" aria-labelledby="sales-history-heading">
                    <div className="section-title">
                      <div>
                        <h2 id="sales-history-heading">Sold history</h2>
                        <p>Final selling price and margin for each completed sale.</p>
                      </div>
                      <span>
                        {inventory.sales.reduce((sum, sale) => sum + sale.quantity, 0)} units sold
                      </span>
                    </div>
                    {inventory.sales.length ? (
                      <>
                      <SalePriceTrend sales={inventory.sales} />
                      <div className="inventory-history-list sales">
                        {inventory.sales.map((sale) => (
                          <article key={sale.id}>
                            <div>
                              <strong>{sale.saleNumber}</strong>
                              <small>
                                {sale.saleType === "WHOLESALE" ? "Wholesale" : "Retail"} · {sale.customerName}
                              </small>
                            </div>
                            <div>
                              <strong>{sale.quantity} × {formatMoney(sale.unitPricePaise)}</strong>
                              <small>
                                List {formatMoney(
                                  sale.saleType === "WHOLESALE"
                                    ? sale.wholesalePricePaise
                                    : sale.standardPricePaise
                                )}
                              </small>
                            </div>
                            {sale.grossProductProfitPaise !== undefined && (
                              <div>
                                <strong className={sale.grossProductProfitPaise < 0 ? "negative" : "positive"}>
                                  {formatMoney(sale.grossProductProfitPaise)}
                                </strong>
                                <small>Product profit</small>
                              </div>
                            )}
                            <time>{happenedAt.format(new Date(sale.happenedAt))}</time>
                          </article>
                        ))}
                      </div>
                      </>
                    ) : (
                      <p className="inventory-empty-copy">No completed sales for this SKU yet.</p>
                    )}
                  </section>
                )}

                {activeTab === "MOVEMENTS" && (
                <section className="movement-panel" aria-labelledby="movement-heading">
                  <div className="section-title">
                    <div>
                      <h2 id="movement-heading">Stock timeline</h2>
                      <p>Every stock-in, sale and approved correction.</p>
                    </div>
                    <span>{inventory.movementCount} records</span>
                  </div>
                  <div className="movement-list">
                    {inventory.movements.map((movement) => (
                      <article className="movement-card" key={movement.id}>
                        <div className="movement-sign">
                          <strong className={movement.quantityDelta > 0 ? "positive" : "negative"}>
                            {movement.quantityDelta > 0 ? "+" : ""}
                            {movement.quantityDelta}
                          </strong>
                          <small>{conditionLabel(movement.stockCondition)}</small>
                        </div>
                        <div className="movement-copy">
                          <strong>{movementLabel(movement.movementType)}</strong>
                          <span>{movement.referenceLabel}</span>
                          <small>
                            {happenedAt.format(new Date(movement.happenedAt))}
                            {" · "}{movement.actorName}
                          </small>
                          {movement.reason && (
                            <small>{reasonLabel(movement.reason)} · {movement.note}</small>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
                )}
              </>
            )}
          </section>
        </div>
      </section>
    </AppShell>
  );
}
