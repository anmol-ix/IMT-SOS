"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import CustomSelect from "@/components/ui/CustomSelect";
import Modal from "@/components/ui/Modal";
import { buildLabelCsv } from "@/shared/label-csv";

type Role = "BUSINESS_OWNER" | "TRUSTED_OPERATOR" | "STORE_OPERATOR";
type StockCondition = "SELLABLE" | "OPEN_BOX" | "DAMAGED";
type InventoryFilter = "ALL" | "LOW" | "OUT" | "MISSING_RACK";
type DetailTab = "OVERVIEW" | "PURCHASES" | "SALES" | "MOVEMENTS";
type ReorderPolicyStatus = "UNCONFIGURED" | "CONFIGURED" | "DISABLED";
export type InventoryWorkspaceMode = "LIST" | "DETAIL" | "COUNT" | "LABELS";

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
  fifoLots: Array<{
    id: string;
    sourceType: "OPENING_BALANCE" | "RECEIPT" | "ADJUSTMENT";
    sourceLabel: string;
    originalQuantity: number;
    remainingQuantity: number;
    unitCostPaise?: number;
    suggestedWholesalePricePaise: number;
    receivedAt: string;
  }>;
  movements: Array<{
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
  }>;
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

type Props = {
  displayName: string;
  role: Role;
  initialProducts: Product[];
  initialInventory?: Inventory;
  mode?: InventoryWorkspaceMode;
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
const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});
const dateTime = new Intl.DateTimeFormat("en-IN", {
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
    SALE: "Sale",
    ADJUSTMENT: "Approved stock count",
    REVERSAL: "Reversal",
  };
  return labels[type] ?? type.replaceAll("_", " ").toLowerCase();
}

function SalePriceTrend({ sales }: { sales: Inventory["sales"] }) {
  const points = [...sales].reverse().slice(-20);
  if (!points.length) return <p className="inventory-v2__empty">No completed sales yet.</p>;
  const values = points.map((sale) => sale.unitPricePaise);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const spread = Math.max(maximum - minimum, 1);
  const coordinates = points.map((sale, index) => {
    const x = points.length === 1 ? 150 : 8 + (index / (points.length - 1)) * 284;
    const y = 76 - ((sale.unitPricePaise - minimum) / spread) * 60;
    return `${x},${y}`;
  }).join(" ");
  return (
    <figure className="inventory-v2__trend">
      <div><span>Lowest {formatMoney(minimum)}</span><span>Highest {formatMoney(maximum)}</span></div>
      <svg viewBox="0 0 300 84" role="img" aria-label="Selling price trend">
        <path d="M8 76H292" />
        <polyline points={coordinates} />
      </svg>
    </figure>
  );
}

export default function InventoryWorkspace({
  displayName,
  role,
  initialProducts,
  initialInventory,
  mode = "LIST",
}: Props) {
  const [products, setProducts] = useState(initialProducts);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<InventoryFilter>("ALL");
  const [selectedId, setSelectedId] = useState(initialInventory?.product.id ?? "");
  const [inventory, setInventory] = useState<Inventory | null>(initialInventory ?? null);
  const [activeTab, setActiveTab] = useState<DetailTab>("OVERVIEW");
  const [mobileDetailOpen, setMobileDetailOpen] = useState(Boolean(initialInventory));
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [counted, setCounted] = useState<Record<StockCondition, string>>({
    SELLABLE: "",
    OPEN_BOX: "",
    DAMAGED: "",
  });
  const [reason, setReason] = useState("PHYSICAL_COUNT");
  const [note, setNote] = useState("");
  const [showPolicy, setShowPolicy] = useState(false);
  const [policyEnabled, setPolicyEnabled] = useState(
    initialInventory?.product.reorderPolicyStatus === "CONFIGURED",
  );
  const [reorderPoint, setReorderPoint] = useState(
    initialInventory?.product.reorderPoint?.toString() ?? "",
  );
  const [restockTarget, setRestockTarget] = useState(
    initialInventory?.product.restockTarget?.toString() ?? "",
  );
  const [policyNote, setPolicyNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [policySaving, setPolicySaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const canCount = role !== "STORE_OPERATOR";
  const filteredProducts = useMemo(() => {
    const term = query.trim().toLowerCase();
    return products.filter((product) => {
      const searchable = [product.name, product.variantName, product.sku, product.barcode,
        product.rackLocation, product.category];
      const matchesSearch = !term || searchable.some((value) => value?.toLowerCase().includes(term));
      const matchesFilter = filter === "ALL"
        || (filter === "OUT" && product.stock === 0)
        || (filter === "LOW" && product.reorderPoint != null && product.stock <= product.reorderPoint)
        || (filter === "MISSING_RACK" && !product.rackLocation);
      return matchesSearch && matchesFilter;
    });
  }, [filter, products, query]);
  const summary = useMemo(() => ({
    units: products.reduce((sum, product) => sum + product.stock, 0),
    valuePaise: products.reduce((sum, product) => sum + (product.inventoryValuePaise ?? 0), 0),
    low: products.filter((product) => product.reorderPoint != null && product.stock <= product.reorderPoint).length,
    out: products.filter((product) => product.stock === 0).length,
  }), [products]);

  const countChanges = inventory
    ? conditions.flatMap(([condition]) => {
        const value = counted[condition];
        const quantity = Number(value);
        if (value === "" || !Number.isInteger(quantity) || quantity < 0) return [];
        const difference = quantity - inventory.balances[condition];
        return difference === 0 ? [] : [{ condition, quantity, difference }];
      })
    : [];

  async function selectProduct(product: Product) {
    setSelectedId(product.id);
    setMobileDetailOpen(true);
    setInventory(null);
    setLoading(true);
    setError("");
    setMessage("");
    setActiveTab("OVERVIEW");
    setCounted({ SELLABLE: "", OPEN_BOX: "", DAMAGED: "" });
    try {
      const response = await fetch(`/api/v1/inventory/${product.id}/history`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Product details could not be loaded.");
      setInventory(body.inventory);
      setPolicyEnabled(body.inventory.product.reorderPolicyStatus === "CONFIGURED");
      setReorderPoint(body.inventory.product.reorderPoint?.toString() ?? "");
      setRestockTarget(body.inventory.product.restockTarget?.toString() ?? "");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Product details could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

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
    setMessage(`${selected.length} SKU${selected.length === 1 ? "" : "s"} exported.`);
  }

  async function submitCount(event: FormEvent) {
    event.preventDefault();
    if (!inventory || !countChanges.length) {
      setError("Enter at least one physical quantity that differs from the recorded stock.");
      return;
    }
    if (note.trim().length < 3) {
      setError("Add a short note about where and when you counted this stock.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      for (const change of countChanges) {
        const response = await fetch("/api/v1/stock-adjustments", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({
            variantId: inventory.product.id,
            stockCondition: change.condition,
            countedQuantity: change.quantity,
            reason,
            note: note.trim(),
          }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message ?? "The count could not be submitted.");
      }
      setMessage(`${countChanges.length} stock difference${countChanges.length === 1 ? "" : "s"} sent for owner approval. Recorded stock has not changed yet.`);
      setCounted({ SELLABLE: "", OPEN_BOX: "", DAMAGED: "" });
      setNote("");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The count could not be submitted.");
    } finally {
      setSaving(false);
    }
  }

  async function saveReorderPolicy(enabled: boolean) {
    if (!inventory) return;
    const point = Number(reorderPoint);
    const target = Number(restockTarget);
    if (enabled && (!Number.isInteger(point) || point < 0 || !Number.isInteger(target) || target <= point)) {
      setError("Enter whole quantities, with the restock goal higher than the alert level.");
      return;
    }
    const auditNote = policyNote.trim()
      || (enabled ? "Low-stock alert set by the business owner." : "Low-stock alert turned off by the business owner.");
    setPolicySaving(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/inventory/${inventory.product.id}/reorder-policy`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          reorderPoint: enabled ? point : null,
          restockTarget: enabled ? target : null,
          reason: "INITIAL_SETUP",
          note: auditNote,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "The low-stock rule could not be saved.");
      setInventory((current) => current ? {
        ...current,
        product: {
          ...current.product,
          reorderPolicyStatus: body.change.policy.status,
          reorderPoint: body.change.policy.reorderPoint,
          restockTarget: body.change.policy.restockTarget,
        },
      } : current);
      setProducts((current) => current.map((product) => product.id === inventory.product.id ? {
        ...product,
        reorderPoint: body.change.policy.reorderPoint,
        restockTarget: body.change.policy.restockTarget,
      } : product));
      setPolicyEnabled(enabled);
      setShowPolicy(false);
      setPolicyNote("");
      setMessage(body.change.policy.status === "CONFIGURED" ? "Low-stock alert updated." : "Low-stock alert turned off.");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The low-stock rule could not be saved.");
    } finally {
      setPolicySaving(false);
    }
  }

  async function submitReorderPolicy(event: FormEvent) {
    event.preventDefault();
    await saveReorderPolicy(true);
  }

  function changePolicyQuantity(field: "POINT" | "TARGET", amount: number) {
    if (field === "POINT") {
      const current = Number.isInteger(Number(reorderPoint)) ? Number(reorderPoint) : 0;
      const nextPoint = Math.max(0, current + amount);
      setReorderPoint(String(nextPoint));
      if (!Number.isInteger(Number(restockTarget)) || Number(restockTarget) <= nextPoint) {
        setRestockTarget(String(nextPoint + 1));
      }
      return;
    }
    const minimum = Math.max(1, (Number.isInteger(Number(reorderPoint)) ? Number(reorderPoint) : 0) + 1);
    const current = Number.isInteger(Number(restockTarget)) ? Number(restockTarget) : minimum;
    setRestockTarget(String(Math.max(minimum, current + amount)));
  }

  function ProductList({ labels = false }: { labels?: boolean }) {
    return (
      <section className="inventory-v2__catalog" aria-label="Product catalogue">
        <div className="inventory-v2__find">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search product, SKU, barcode or rack"
            aria-label="Search inventory"
          />
          <CustomSelect
            value={filter}
            ariaLabel="Filter products"
            options={[
              { value: "ALL", label: "All stock" },
              { value: "LOW", label: "Low stock" },
              { value: "OUT", label: "Out of stock" },
              { value: "MISSING_RACK", label: "Rack missing" },
            ]}
            onChange={(value) => setFilter(value as InventoryFilter)}
          />
        </div>
        <div className="inventory-v2__list-heading">
          <strong>{labels ? "Choose products" : "Products"}</strong>
          <span>{filteredProducts.length} shown</span>
        </div>
        <div className="inventory-v2__product-list">
          {filteredProducts.map((product) => {
            const selected = labels ? selectedLabels.includes(product.id) : selectedId === product.id;
            return (
              <button
                type="button"
                className={`inventory-v2__product${selected ? " is-selected" : ""}`}
                onClick={() => labels ? toggleLabel(product.id) : selectProduct(product)}
                key={product.id}
              >
                {labels && <span className="inventory-v2__check" aria-hidden="true">{selected ? "✓" : ""}</span>}
                <span className="inventory-v2__product-copy">
                  <strong>{product.name}{product.variantName ? ` · ${product.variantName}` : ""}</strong>
                  <small>{product.sku} · {product.rackLocation ?? "Rack not set"}</small>
                </span>
                <span className="inventory-v2__product-price">
                  <strong>{formatMoney(product.standardPricePaise)}</strong><small>Retail</small>
                </span>
                <span className={`inventory-v2__stock ${product.stock === 0 ? "is-out" : ""}`}>
                  {product.stock} in stock
                </span>
                {!labels && <span className="inventory-v2__open" aria-hidden="true">›</span>}
              </button>
            );
          })}
          {!filteredProducts.length && <p className="inventory-v2__empty">No matching products.</p>}
        </div>
      </section>
    );
  }

  function ProductDetail() {
    if (loading) return <section className="inventory-v2__detail inventory-v2__loading">Loading product record…</section>;
    if (!inventory) {
      return (
        <section className="inventory-v2__detail inventory-v2__empty-state">
          <span aria-hidden="true">↖</span>
          <h2>{mode === "COUNT" ? "Choose a product to count" : "Choose a product"}</h2>
          <p>{mode === "COUNT" ? "Its recorded quantities will appear here for a physical check." : "Stock, pricing, purchase layers, sales and movements will appear here."}</p>
        </section>
      );
    }
    if (mode === "COUNT") return CountPanel();
    return (
      <section className="inventory-v2__detail">
        <header className="inventory-v2__record-header">
          <button type="button" className="inventory-v2__mobile-back" onClick={() => setMobileDetailOpen(false)}>← Products</button>
          <div>
            <p>{inventory.product.sku}</p>
            <h1>{inventory.product.name}{inventory.product.variantName ? ` · ${inventory.product.variantName}` : ""}</h1>
            <span>{inventory.product.rackLocation ?? "Rack not set"} · Barcode {inventory.product.barcode}</span>
          </div>
          {mode === "DETAIL" && <Link className="secondary-button" href="/inventory">All products</Link>}
        </header>
        <nav className="inventory-v2__tabs" aria-label="Product record sections">
          {(["OVERVIEW", "PURCHASES", "SALES", "MOVEMENTS"] as DetailTab[]).map((tab) => (
            <button type="button" className={activeTab === tab ? "is-active" : ""} onClick={() => setActiveTab(tab)} key={tab}>
              {tab === "OVERVIEW" ? "Overview" : tab === "PURCHASES" ? "Purchase & FIFO" : tab === "SALES" ? "Sold history" : "Movements"}
            </button>
          ))}
        </nav>
        <div className="inventory-v2__record-body">
          {activeTab === "OVERVIEW" && OverviewPanel()}
          {activeTab === "PURCHASES" && PurchasePanel()}
          {activeTab === "SALES" && SalesPanel()}
          {activeTab === "MOVEMENTS" && MovementPanel()}
        </div>
      </section>
    );
  }

  function OverviewPanel() {
    if (!inventory) return null;
    const p = inventory.product;
    return (
      <div className="inventory-v2__overview">
        <section className="inventory-v2__metric-grid">
          <article className="primary"><small>Sellable stock</small><strong>{inventory.balances.SELLABLE}</strong></article>
          <article><small>Open box</small><strong>{inventory.balances.OPEN_BOX}</strong></article>
          <article><small>Damaged</small><strong>{inventory.balances.DAMAGED}</strong></article>
          <article><small>MRP</small><strong>{formatMoney(p.mrpPaise)}</strong></article>
          <article><small>Retail price</small><strong>{formatMoney(p.standardPricePaise)}</strong></article>
          <article><small>Current wholesale guide</small><strong>{formatMoney(p.wholesalePricePaise)}</strong></article>
        </section>
        {role === "BUSINESS_OWNER" && (
          <section className="inventory-v2__cost-strip">
            <div><small>Stock cost value</small><strong>{formatMoney(inventory.inventoryValuePaise ?? 0)}</strong></div>
            <div><small>Weighted average</small><strong>{formatMoney(inventory.weightedAverageCostPaise ?? 0)}</strong></div>
            <div><small>Latest purchase cost</small><strong>{formatMoney(inventory.latestLandedCostPaise ?? 0)}</strong></div>
          </section>
        )}
        <section className="inventory-v2__health">
          <div>
            <small>Stock records</small>
            <strong className={inventory.reconciled ? "positive" : "negative"}>{inventory.reconciled ? "Matched" : "Needs review"}</strong>
            <span>{inventory.reconciled ? "Recorded balances match the movement ledger." : "A balance differs from its movement history."}</span>
          </div>
          <div>
            <small>Low-stock alert</small>
            <strong>{p.reorderPolicyStatus === "CONFIGURED" ? `Alert at ${p.reorderPoint} units` : "Not set"}</strong>
            <span>{p.reorderPolicyStatus === "CONFIGURED" ? `Restock goal: ${p.restockTarget} units` : "Set a reminder when you know the right stock levels."}</span>
          </div>
          {role === "BUSINESS_OWNER" && <button type="button" className="secondary-button" onClick={() => setShowPolicy(true)}>Change alert</button>}
        </section>
      </div>
    );
  }

  function PurchasePanel() {
    if (!inventory) return null;
    return (
      <div className="inventory-v2__history-stack">
        <section className="inventory-v2__fifo">
          <div className="inventory-v2__section-heading">
            <div><h2>Stock available by purchase batch</h2><p>Oldest stock sells first. The wholesale guide is purchase cost + 10%.</p></div>
            <span>{inventory.fifoLots.reduce((sum, lot) => sum + lot.remainingQuantity, 0)} units</span>
          </div>
          <div className="inventory-v2__fifo-list">
            {inventory.fifoLots.map((lot, index) => (
              <article key={lot.id} className={index === 0 ? "is-next" : ""}>
                <span className="inventory-v2__lot-order">{index === 0 ? "SELL NEXT" : `#${index + 1}`}</span>
                <div><strong>{lot.remainingQuantity} of {lot.originalQuantity} left</strong><small>{lot.sourceLabel} · {dateTime.format(new Date(lot.receivedAt))}</small></div>
                {lot.unitCostPaise !== undefined && <div><small>Purchase cost</small><strong>{formatMoney(lot.unitCostPaise)}</strong></div>}
                <div><small>Wholesale guide</small><strong>{formatMoney(lot.suggestedWholesalePricePaise)}</strong></div>
              </article>
            ))}
            {!inventory.fifoLots.length && <p className="inventory-v2__empty">No sellable FIFO stock layers remain.</p>}
          </div>
        </section>
        <section>
          <div className="inventory-v2__section-heading"><div><h2>Completed receipts</h2><p>Every time this SKU was received.</p></div><span>{inventory.purchases.length}</span></div>
          <div className="inventory-v2__history-list">
            {inventory.purchases.map((purchase) => (
              <article key={purchase.id}>
                <div><strong>{purchase.supplierName}</strong><small>{purchase.receiptNumber}{purchase.supplierInvoiceReference ? ` · Bill ${purchase.supplierInvoiceReference}` : ""}</small></div>
                <div><strong>{purchase.sellableQuantity} sellable</strong><small>{purchase.openBoxQuantity} open box · {purchase.damagedQuantity} damaged</small></div>
                {purchase.invoiceUnitCostPaise !== undefined && <div><small>Purchase cost</small><strong>{formatMoney(purchase.invoiceUnitCostPaise)}</strong></div>}
                <time>{dateTime.format(new Date(purchase.happenedAt))}</time>
              </article>
            ))}
            {!inventory.purchases.length && <p className="inventory-v2__empty">No completed receipts yet.</p>}
          </div>
        </section>
      </div>
    );
  }

  function SalesPanel() {
    if (!inventory) return null;
    return (
      <section>
        <div className="inventory-v2__section-heading"><div><h2>Sold history</h2><p>Final price, channel and result for every completed sale.</p></div><span>{inventory.sales.reduce((sum, sale) => sum + sale.quantity, 0)} units</span></div>
        <SalePriceTrend sales={inventory.sales} />
        <div className="inventory-v2__history-list">
          {inventory.sales.map((sale) => (
            <article key={sale.id}>
              <div><strong>{sale.saleNumber}</strong><small>{sale.saleType === "WHOLESALE" ? "Wholesale" : "Retail"} · {sale.customerName}</small></div>
              <div><strong>{sale.quantity} × {formatMoney(sale.unitPricePaise)}</strong><small>Final unit price</small></div>
              {sale.grossProductProfitPaise !== undefined && <div><small>Gross product result</small><strong className={sale.grossProductProfitPaise < 0 ? "negative" : "positive"}>{formatMoney(sale.grossProductProfitPaise)}</strong></div>}
              <time>{dateTime.format(new Date(sale.happenedAt))}</time>
            </article>
          ))}
          {!inventory.sales.length && <p className="inventory-v2__empty">No completed sales yet.</p>}
        </div>
      </section>
    );
  }

  function MovementPanel() {
    if (!inventory) return null;
    return (
      <section>
        <div className="inventory-v2__section-heading"><div><h2>Stock timeline</h2><p>Every receipt, sale and approved correction.</p></div><span>{inventory.movementCount} records</span></div>
        <div className="inventory-v2__movement-list">
          {inventory.movements.map((movement) => (
            <article key={movement.id}>
              <span className={movement.quantityDelta >= 0 ? "positive" : "negative"}>{movement.quantityDelta > 0 ? "+" : ""}{movement.quantityDelta}</span>
              <div><strong>{movementLabel(movement.movementType)}</strong><small>{movement.referenceLabel} · {conditionLabel(movement.stockCondition)}</small>{movement.note && <small>{movement.note}</small>}</div>
              <time>{dateTime.format(new Date(movement.happenedAt))}<small>{movement.actorName}</small></time>
            </article>
          ))}
          {!inventory.movements.length && <p className="inventory-v2__empty">No stock movements yet.</p>}
        </div>
      </section>
    );
  }

  function CountPanel() {
    if (!inventory) return null;
    return (
      <section className="inventory-v2__detail inventory-v2__count">
        <header className="inventory-v2__record-header">
          <button type="button" className="inventory-v2__mobile-back" onClick={() => setMobileDetailOpen(false)}>← Products</button>
          <div><p>{inventory.product.sku}</p><h1>{inventory.product.name}</h1><span>{inventory.product.rackLocation ?? "Rack not set"}</span></div>
        </header>
        {canCount ? (
          <form className="inventory-v2__count-form" onSubmit={submitCount}>
            <div className="inventory-v2__count-intro"><div><h2>Enter what is physically present</h2><p>Count all conditions together. Only differences are sent for approval.</p></div><strong>{countChanges.length} differences</strong></div>
            <div className="inventory-v2__condition-grid">
              {conditions.map(([condition, label]) => {
                const value = counted[condition];
                const numeric = Number(value);
                const valid = value !== "" && Number.isInteger(numeric) && numeric >= 0;
                const delta = valid ? numeric - inventory.balances[condition] : 0;
                return (
                  <label key={condition}>
                    <span>{label}</span>
                    <small>Recorded: {inventory.balances[condition]}</small>
                    <input type="number" min="0" max="100000" step="1" value={value} onChange={(event) => setCounted((current) => ({ ...current, [condition]: event.target.value }))} placeholder="Physical count" />
                    <strong className={delta < 0 ? "negative" : delta > 0 ? "positive" : ""}>Difference: {valid ? `${delta > 0 ? "+" : ""}${delta}` : "—"}</strong>
                  </label>
                );
              })}
            </div>
            <div className="inventory-v2__count-notes">
              <label>Reason<CustomSelect value={reason} ariaLabel="Stock count reason" options={reasons.map(([value, label]) => ({ value, label }))} onChange={setReason} /></label>
              <label>Count note<textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="Example: Counted rack C2 at closing" /></label>
            </div>
            <div className="inventory-v2__sticky-action"><span><strong>{countChanges.length}</strong> differences ready</span><button type="submit" disabled={saving || !countChanges.length || note.trim().length < 3}>{saving ? "Submitting…" : "Send for approval"}</button></div>
          </form>
        ) : <p className="inventory-v2__empty">A trusted operator or owner must submit physical counts.</p>}
      </section>
    );
  }

  const isLabels = mode === "LABELS";
  const title = mode === "COUNT" ? "Stock count" : mode === "LABELS" ? "Label export" : mode === "DETAIL" ? "Product record" : "Inventory";
  return (
    <AppShell displayName={displayName} role={role}>
      <section className={`inventory-v2 inventory-v2--${mode.toLowerCase()}${mobileDetailOpen ? " is-mobile-detail" : ""}`}>
        <header className="inventory-v2__module-bar">
          <div><h1>{title}</h1><p>{mode === "COUNT" ? "Compare physical stock with the system." : mode === "LABELS" ? "Choose SKUs and download one simple CSV." : "Current stock, value, buying and selling history."}</p></div>
          <div className="inventory-v2__quick-actions">
            {role !== "STORE_OPERATOR" && <Link href="/inventory/receive">Receive stock</Link>}
            {mode !== "COUNT" && role !== "STORE_OPERATOR" && <Link href="/inventory/counts">Count stock</Link>}
            {mode !== "LABELS" && <Link href="/inventory/labels">Export labels</Link>}
          </div>
        </header>
        {(error || message) && <div className={`inventory-v2__notice ${error ? "error" : "success"}`} role={error ? "alert" : "status"}>{error || message}<button type="button" aria-label="Dismiss message" onClick={() => { setError(""); setMessage(""); }}>×</button></div>}

        {mode === "LIST" && (
          <section className="inventory-v2__summary" aria-label="Inventory summary">
            <article><small>Active SKUs</small><strong>{products.length}</strong></article>
            <article><small>Sellable units</small><strong>{summary.units}</strong></article>
            {role === "BUSINESS_OWNER" && <article><small>Stock cost value</small><strong>{formatMoney(summary.valuePaise)}</strong></article>}
            <article className={summary.low ? "watch" : ""}><small>Low stock</small><strong>{summary.low}</strong></article>
            <article className={summary.out ? "risk" : ""}><small>Out of stock</small><strong>{summary.out}</strong></article>
          </section>
        )}

        {isLabels ? (
          <div className="inventory-v2__workspace inventory-v2__workspace--labels">
            {ProductList({ labels: true })}
            <aside className="inventory-v2__label-summary" data-selection={`${selectedLabels.length} selected`}>
              <div><small>Selected</small><strong>{selectedLabels.length}</strong><p>CSV includes SKU, barcode, product, variant, MRP, selling price and rack.</p></div>
              <button type="button" className="secondary-button" onClick={() => setSelectedLabels(filteredProducts.map((product) => product.id))} disabled={!filteredProducts.length}>Select shown</button>
              <button type="button" className="text-button" onClick={() => setSelectedLabels([])} disabled={!selectedLabels.length}>Clear selection</button>
              <button type="button" className="complete-button" onClick={exportLabels} disabled={!selectedLabels.length}>Download label CSV</button>
            </aside>
          </div>
        ) : mode === "DETAIL" ? (
          <div className="inventory-v2__workspace inventory-v2__workspace--record">{ProductDetail()}</div>
        ) : (
          <div className="inventory-v2__workspace">
            {ProductList({})}
            {ProductDetail()}
          </div>
        )}

        <Modal
          open={showPolicy}
          title="Set low-stock alert"
          description={inventory ? `Choose when ${inventory.product.name} should be added to your reorder list.` : undefined}
          onClose={() => setShowPolicy(false)}
          panelClassName="inventory-v2__policy-modal"
          footer={
            <div className="inventory-v2__policy-actions">
              {policyEnabled && (
                <button type="button" className="inventory-v2__disable-policy" onClick={() => saveReorderPolicy(false)} disabled={policySaving}>
                  Turn off alert
                </button>
              )}
              <div>
                <button type="button" className="secondary-button" onClick={() => setShowPolicy(false)}>Cancel</button>
                <button type="submit" form="inventory-reorder-form" className="complete-button" disabled={policySaving}>{policySaving ? "Saving…" : "Save low-stock alert"}</button>
              </div>
            </div>
          }
        >
          <form id="inventory-reorder-form" className="inventory-v2__policy-form" onSubmit={submitReorderPolicy}>
            {inventory && (
              <section className="inventory-v2__policy-product">
                <div><strong>{inventory.product.name}</strong><span>{inventory.product.sku}</span></div>
                <div><small>Sellable now</small><strong>{inventory.balances.SELLABLE} units</strong></div>
              </section>
            )}

            <section className="inventory-v2__policy-decision">
              <div>
                <span className="inventory-v2__policy-step">1</span>
                <div><strong>When should we remind you?</strong><p>Add this product to the reorder list when sellable stock reaches this quantity.</p></div>
              </div>
              <div className="inventory-v2__quantity-control">
                <button type="button" aria-label="Decrease alert quantity" onClick={() => changePolicyQuantity("POINT", -1)}>−</button>
                <label>
                  <span>Alert at</span>
                  <input type="number" min="0" step="1" value={reorderPoint} onChange={(event) => setReorderPoint(event.target.value)} inputMode="numeric" placeholder="0" />
                  <small>units remaining</small>
                </label>
                <button type="button" aria-label="Increase alert quantity" onClick={() => changePolicyQuantity("POINT", 1)}>+</button>
              </div>
            </section>

            <section className="inventory-v2__policy-decision">
              <div>
                <span className="inventory-v2__policy-step">2</span>
                <div><strong>What stock level should you restore?</strong><p>This becomes the suggested stock level after the next purchase.</p></div>
              </div>
              <div className="inventory-v2__quantity-control">
                <button type="button" aria-label="Decrease restock goal" onClick={() => changePolicyQuantity("TARGET", -1)}>−</button>
                <label>
                  <span>Restock goal</span>
                  <input type="number" min="1" step="1" value={restockTarget} onChange={(event) => setRestockTarget(event.target.value)} inputMode="numeric" placeholder="1" />
                  <small>units in stock</small>
                </label>
                <button type="button" aria-label="Increase restock goal" onClick={() => changePolicyQuantity("TARGET", 1)}>+</button>
              </div>
            </section>

            {inventory && Number.isInteger(Number(reorderPoint)) && Number.isInteger(Number(restockTarget)) && Number(restockTarget) > Number(reorderPoint) && (
              <section className={`inventory-v2__policy-preview${inventory.balances.SELLABLE <= Number(reorderPoint) ? " is-due" : ""}`}>
                <strong>{inventory.balances.SELLABLE <= Number(reorderPoint) ? "This product needs attention now" : "Your reminder is ready"}</strong>
                <p>
                  {inventory.balances.SELLABLE <= Number(reorderPoint)
                    ? `It will appear in the reorder list now, with ${Math.max(0, Number(restockTarget) - inventory.balances.SELLABLE)} units suggested to reach your goal.`
                    : `It will appear after ${inventory.balances.SELLABLE - Number(reorderPoint)} more units are sold. At that point, order about ${Number(restockTarget) - Number(reorderPoint)} units.`}
                </p>
              </section>
            )}

            <label className="inventory-v2__policy-note">Note <span>(optional)</span><input value={policyNote} onChange={(event) => setPolicyNote(event.target.value)} placeholder="Example: Supplier usually needs 10 days" maxLength={120} /></label>
          </form>
        </Modal>
      </section>
    </AppShell>
  );
}
