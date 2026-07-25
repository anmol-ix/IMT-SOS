"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";

type Role = "BUSINESS_OWNER" | "TRUSTED_OPERATOR" | "STORE_OPERATOR";
type StockCondition = "SELLABLE" | "OPEN_BOX" | "DAMAGED";
type ReorderPolicyStatus = "UNCONFIGURED" | "CONFIGURED" | "DISABLED";

type Product = {
  id: string;
  name: string;
  variantName: string | null;
  sku: string;
  rackLocation: string | null;
  stock: number;
  openBoxStock?: number;
  damagedStock?: number;
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
    variantName: string | null;
    sku: string;
    rackLocation: string | null;
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
};

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

function roleLabel(role: Role) {
  if (role === "BUSINESS_OWNER") return "Business owner";
  return role === "TRUSTED_OPERATOR" ? "Trusted operator" : "Store operator";
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

export default function InventoryWorkspace({
  displayName,
  role,
  initialProducts,
  initialInventory,
}: Props) {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState(initialProducts);
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

  async function search(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/v1/catalog?q=${encodeURIComponent(query.trim())}`);
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error?.message ?? "Products could not be loaded.");
      }
      setProducts(body.products);
      setSelectedId("");
      setInventory(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Products could not be loaded.");
    } finally {
      setLoading(false);
    }
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
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="brand">ItsMyToy</p>
          <p className="welcome">Hi, {displayName}</p>
        </div>
        <nav className="app-nav" aria-label="Operations">
          {role === "BUSINESS_OWNER" && <Link href="/dashboard">Home</Link>}
          <Link href="/">Sell</Link>
          {role !== "STORE_OPERATOR" && <Link href="/receive">Receive</Link>}
          <Link className="active" href="/inventory">Inventory</Link>
          <Link href="/activity">Activity</Link>
        </nav>
        <span className="role-chip">{roleLabel(role)}</span>
      </header>

      <section className="sell-page inventory-page" aria-labelledby="inventory-heading">
        <div className="page-heading">
          <p className="eyebrow">Stock truth</p>
          <h1 id="inventory-heading">Count. Explain. Correct.</h1>
          <p>
            Search a product, compare the physical count with the recorded balance,
            and trace every completed stock movement.
          </p>
        </div>

        {error && <p className="alert error" role="alert">{error}</p>}
        {message && <p className="alert success" role="status">{message}</p>}

        <form className="search-bar" onSubmit={search}>
          <label htmlFor="inventory-search">SKU, barcode or product name</label>
          <div className="search-row inventory-search-row">
            <input
              id="inventory-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search inventory"
            />
            <button type="submit" disabled={loading}>
              {loading ? "Loading…" : "Find"}
            </button>
          </div>
        </form>

        <div className="inventory-layout">
          <section className="inventory-products" aria-labelledby="inventory-products-heading">
            <div className="section-title">
              <h2 id="inventory-products-heading">Products</h2>
              <span>{products.length} shown</span>
            </div>
            <div className="product-list">
              {products.map((product) => (
                <button
                  type="button"
                  className={`product-row ${selectedId === product.id ? "selected" : ""}`}
                  key={product.id}
                  onClick={() => selectProduct(product)}
                >
                  <span className="product-letter">{product.name.charAt(0)}</span>
                  <span className="product-copy">
                    <strong>{product.name}</strong>
                    <small>
                      {product.variantName ? `${product.variantName} · ` : ""}
                      {product.sku}
                    </small>
                    <small>{product.rackLocation ?? "Rack not assigned"}</small>
                  </span>
                  <span className="stock-chip">{product.stock} sellable</span>
                </button>
              ))}
            </div>
          </section>

          <section className="inventory-detail" aria-live="polite">
            {!selectedProduct && !loading && (
              <div className="inventory-empty">
                <span>↗</span>
                <h2>Choose a product</h2>
                <p>Its balances, ledger check and movement history will appear here.</p>
              </div>
            )}
            {loading && selectedProduct && (
              <div className="inventory-empty"><p>Loading inventory truth…</p></div>
            )}
            {inventory && (
              <>
                <section className="inventory-summary">
                  <div className="inventory-product-heading">
                    <div>
                      <p className="eyebrow">{inventory.product.sku}</p>
                      <h2>{inventory.product.name}</h2>
                      <p>{inventory.product.rackLocation ?? "Rack not assigned"}</p>
                    </div>
                    <span className={inventory.reconciled ? "ledger-ok" : "ledger-warning"}>
                      {inventory.reconciled
                        ? "Ledger matches balances"
                        : "Balance needs investigation"}
                    </span>
                  </div>
                  <div className="balance-grid">
                    {conditions.map(([value, label]) => (
                      <div key={value}>
                        <small>{label}</small>
                        <strong>{inventory.balances[value]}</strong>
                        <span>ledger {inventory.ledgerBalances[value]}</span>
                      </div>
                    ))}
                  </div>
                  {inventory.inventoryValuePaise !== undefined && (
                    <div className="owner-cost-grid">
                      <div>
                        <small>Sellable inventory value</small>
                        <strong>{formatMoney(inventory.inventoryValuePaise)}</strong>
                      </div>
                      <div>
                        <small>Weighted average</small>
                        <strong>{formatMoney(inventory.weightedAverageCostPaise ?? 0)}</strong>
                      </div>
                      <div>
                        <small>Latest landed cost</small>
                        <strong>{formatMoney(inventory.latestLandedCostPaise ?? 0)}</strong>
                      </div>
                    </div>
                  )}
                </section>

                {role === "BUSINESS_OWNER" && (
                  <section className="reorder-panel" aria-labelledby="reorder-heading">
                    <div className="reorder-panel-heading">
                      <div>
                        <p className="eyebrow">Replenishment control</p>
                        <h2 id="reorder-heading">Set reorder policy</h2>
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
                        Use a reorder alert for this SKU
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
                        <label>Decision reason
                          <select
                            value={policyReason}
                            onChange={(event) => setPolicyReason(event.target.value)}
                          >
                            {reorderReasons.map(([value, label]) => (
                              <option value={value} key={value}>{label}</option>
                            ))}
                          </select>
                        </label>
                        <label>Policy note
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
                            ? "Save reorder policy"
                            : inventory.product.reorderPolicyStatus === "CONFIGURED"
                              ? "Disable reorder policy"
                              : "Reorder policy not configured"}
                      </button>
                    </form>
                  </section>
                )}

                <section className="count-panel" aria-labelledby="count-heading">
                  <p className="eyebrow">Physical verification</p>
                  <h2 id="count-heading">Submit a stock count</h2>
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

                <section className="movement-panel" aria-labelledby="movement-heading">
                  <div className="section-title">
                    <h2 id="movement-heading">Movement history</h2>
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
              </>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
