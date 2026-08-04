"use client";

import { useState } from "react";
import AppShell from "@/components/AppShell";
import CustomSelect from "@/components/ui/CustomSelect";
import PageHeader from "@/components/ui/PageHeader";

type Approval = {
  id: string;
  productName: string;
  sku: string;
  requesterName: string;
  status: string;
  quantity: number;
  requestedUnitPricePaise: number;
  standardPricePaise: number;
  requesterFloorPaise: number;
  expectedGrossResultPaise?: number;
  expectedReplacementMarginPaise?: number;
  expiresAt: string;
  createdAt: string;
};

type GuestApproval = {
  id: string;
  requesterName: string;
  status: string;
  totalPaise: number;
  cartSummary: Array<{
    variantId: string;
    productName: string;
    sku: string;
    quantity: number;
    unitPricePaise: number;
    lineTotalPaise: number;
  }>;
  note: string | null;
  expiresAt: string;
  createdAt: string;
};

type StockAdjustment = {
  id: string;
  productName: string;
  sku: string;
  rackLocation: string | null;
  stockCondition: string;
  recordedQuantity: number;
  countedQuantity: number;
  quantityDelta: number;
  reason: string;
  note: string;
  requesterName: string;
  expectedValueDeltaPaise?: number;
  requestedAt: string;
};

type OfflineSaleConflict = {
  id: string;
  commandId: string;
  operatorName: string;
  deviceName: string;
  status: "PENDING" | "COMPLETED" | "DISMISSED";
  display: {
    totalPaise: number;
    units: number;
    paymentMode: "CASH" | "UPI";
    products: Array<{
      variantId: string;
      name: string;
      sku: string;
      quantity: number;
    }>;
  };
  errorCode: string;
  errorMessage: string;
  offlineCreatedAt: string;
  reportedAt: string;
};

type Props = {
  displayName: string;
  initialApprovals: Approval[];
  initialGuestApprovals: GuestApproval[];
  initialStockAdjustments: StockAdjustment[];
  initialOfflineSaleConflicts: OfflineSaleConflict[];
  mode?: "OFFLINE" | "STOCK" | "GUEST" | "PRICE" | "ALL";
};

const reasons = [
  ["CLEARANCE", "Clearance"],
  ["DAMAGED_PACKAGING", "Damaged packaging / open box"],
  ["CUSTOMER_SERVICE_RECOVERY", "Customer-service recovery"],
  ["PRICING_CORRECTION", "Pricing correction"],
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

function words(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

export default function ApprovalsWorkspace({
  displayName,
  initialApprovals,
  initialGuestApprovals,
  initialStockAdjustments,
  initialOfflineSaleConflicts,
  mode = "ALL",
}: Props) {
  const [approvals, setApprovals] = useState(initialApprovals);
  const [guestApprovals, setGuestApprovals] = useState(initialGuestApprovals);
  const [stockAdjustments, setStockAdjustments] = useState(initialStockAdjustments);
  const [offlineSaleConflicts, setOfflineSaleConflicts] = useState(
    initialOfflineSaleConflicts,
  );
  const [reason, setReason] = useState("CUSTOMER_SERVICE_RECOVERY");
  const [note, setNote] = useState("");
  const [guestNote, setGuestNote] = useState("");
  const [stockDecisionNote, setStockDecisionNote] = useState("");
  const [offlineDecisionNote, setOfflineDecisionNote] = useState("");
  const [workingId, setWorkingId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    setError("");
    const [
      priceResponse,
      guestResponse,
      stockResponse,
      offlineResponse,
    ] = await Promise.all([
      fetch("/api/v1/price-approvals"),
      fetch("/api/v1/guest-sale-approvals"),
      fetch("/api/v1/stock-adjustments"),
      fetch("/api/v1/offline-sale-conflicts"),
    ]);
    const [priceBody, guestBody, stockBody, offlineBody] = await Promise.all([
      priceResponse.json(),
      guestResponse.json(),
      stockResponse.json(),
      offlineResponse.json(),
    ]);
    if (
      !priceResponse.ok
      || !guestResponse.ok
      || !stockResponse.ok
      || !offlineResponse.ok
    ) {
      setError(
        priceBody.error?.message
          ?? guestBody.error?.message
          ?? stockBody.error?.message
          ?? offlineBody.error?.message
          ?? "Approvals could not be loaded.",
      );
      return;
    }
    setApprovals(priceBody.approvals);
    setGuestApprovals(guestBody.approvals);
    setStockAdjustments(stockBody.adjustments);
    setOfflineSaleConflicts(offlineBody.conflicts);
  }

  async function decideOfflineSale(
    id: string,
    action: "CONFIRM_SALE" | "NOT_SOLD",
  ) {
    if (offlineDecisionNote.trim().length < 3) {
      setError("Add a short owner note explaining what was physically verified.");
      return;
    }
    setWorkingId(id);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/v1/offline-sale-conflicts/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, note: offlineDecisionNote.trim() }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(
          body.error?.message ?? "The offline-sale decision could not be saved.",
        );
      }
      setOfflineSaleConflicts((current) => current.filter((item) => item.id !== id));
      setOfflineDecisionNote("");
      setMessage(
        action === "CONFIRM_SALE"
          ? `Physical sale recorded${body.saleNumber ? ` as ${body.saleNumber}` : ""}. Stock, payment and operator attribution were saved together.`
          : "Confirmed that no sale happened. The phone will release its local stock reservation when it reconnects.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The offline-sale decision could not be saved.",
      );
    } finally {
      setWorkingId("");
    }
  }

  async function decideStock(id: string, decision: "APPROVE" | "REJECT") {
    setWorkingId(id);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/v1/stock-adjustments/${id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          decision,
          note: stockDecisionNote.trim() || undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error?.message ?? "The stock decision could not be saved.");
      }
      setStockAdjustments((current) => current.filter((item) => item.id !== id));
      setMessage(
        decision === "APPROVE"
          ? "The approved difference was applied as a new inventory movement."
          : "The stock-count difference was rejected. Stock did not change.",
      );
      setStockDecisionNote("");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "The stock decision could not be saved.",
      );
    } finally {
      setWorkingId("");
    }
  }

  async function decideGuest(id: string, decision: "APPROVE" | "REJECT") {
    setWorkingId(id);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/v1/guest-sale-approvals/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, note: guestNote.trim() || undefined }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Decision could not be saved.");
      setGuestApprovals((current) => current.filter((approval) => approval.id !== id));
      setMessage(
        decision === "APPROVE"
          ? "Guest sale approved for this exact cart for 30 minutes."
          : "Guest sale request rejected.",
      );
      setGuestNote("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Decision could not be saved.");
    } finally {
      setWorkingId("");
    }
  }

  async function decide(id: string, decision: "APPROVE" | "REJECT") {
    if (decision === "APPROVE" && reason === "OTHER" && !note.trim()) {
      setError("Add a note when the reason is Other.");
      return;
    }
    setWorkingId(id);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/v1/price-approvals/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          decision === "APPROVE"
            ? { decision, reason, note: note.trim() || undefined }
            : { decision, note: note.trim() || undefined },
        ),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Decision could not be saved.");
      setApprovals((current) => current.filter((approval) => approval.id !== id));
      setMessage(
        decision === "APPROVE"
          ? "Approved for this operator and exact sale for 30 minutes."
          : "Request rejected.",
      );
      setNote("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Decision could not be saved.");
    } finally {
      setWorkingId("");
    }
  }

  return (
    <AppShell displayName={displayName} role="BUSINESS_OWNER">
      <section className="sell-page" aria-labelledby="approval-heading">
        <PageHeader
          eyebrow="Owner control"
          headingId="approval-heading"
          title="Approvals"
          description="Review offline conflicts, stock differences and price exceptions."
          actions={
            <button type="button" className="refresh-button" onClick={refresh}>
              Refresh
            </button>
          }
        />

        {error && <p className="alert error" role="alert">{error}</p>}
        {message && <p className="alert success" role="status">{message}</p>}

        {(mode === "ALL" || mode === "OFFLINE") && <section className="approval-group" aria-labelledby="offline-approval-heading">
          <div className="section-title">
            <h2 id="offline-approval-heading">Rejected offline sales</h2>
            <span>{offlineSaleConflicts.length} waiting</span>
          </div>
          <div className="approval-list">
            {offlineSaleConflicts.length === 0 ? (
              <section className="results-panel empty-approvals">
                <h2>No offline conflicts waiting</h2>
                <p>Rejected queued sales from enrolled phones will appear here.</p>
              </section>
            ) : offlineSaleConflicts.map((conflict) => (
              <article className="approval-card" key={conflict.id}>
                <div className="approval-product">
                  <div>
                    <p className="eyebrow">
                      {conflict.operatorName} · {conflict.deviceName}
                    </p>
                    <h2>
                      {conflict.display.units} units ·{" "}
                      {formatMoney(conflict.display.totalPaise)}
                    </h2>
                    <p>
                      {conflict.display.paymentMode} · physically created{" "}
                      {dateTime.format(new Date(conflict.offlineCreatedAt))}
                    </p>
                  </div>
                  <span className="pending-chip">Verify physically</span>
                </div>

                <div className="guest-cart-summary">
                  {conflict.display.products.map((product) => (
                    <div key={product.variantId}>
                      <span>
                        <strong>{product.name}</strong>
                        <small>{product.sku}</small>
                      </span>
                      <strong>{product.quantity} units</strong>
                    </div>
                  ))}
                </div>

                <p className="stock-approval-warning">
                  <strong>Why sync stopped:</strong> {conflict.errorMessage}
                </p>
                <p>
                  Check the product, payment and actual handover. “Record sale”
                  uses this exact offline amount and original operator, but stops
                  if current system stock is insufficient.
                </p>

                <div className="form-row">
                  <label>Required owner verification note
                    <input
                      value={offlineDecisionNote}
                      onChange={(event) => setOfflineDecisionNote(event.target.value)}
                      maxLength={500}
                      placeholder="Example: Checked UPI and product handover"
                    />
                  </label>
                </div>

                <div className="decision-buttons">
                  <button
                    type="button"
                    className="reject-button"
                    disabled={workingId === conflict.id}
                    onClick={() => decideOfflineSale(conflict.id, "NOT_SOLD")}
                  >
                    No sale happened
                  </button>
                  <button
                    type="button"
                    className="approve-button"
                    disabled={workingId === conflict.id}
                    onClick={() => decideOfflineSale(conflict.id, "CONFIRM_SALE")}
                  >
                    {workingId === conflict.id
                      ? "Recording…"
                      : "Confirm and record sale"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>}

        {(mode === "ALL" || mode === "STOCK") && <section className="approval-group" aria-labelledby="stock-approval-heading">
          <div className="section-title">
            <h2 id="stock-approval-heading">Stock-count differences</h2>
            <span>{stockAdjustments.length} waiting</span>
          </div>
          <div className="approval-list">
            {stockAdjustments.length === 0 ? (
              <section className="results-panel empty-approvals">
                <h2>No stock differences waiting</h2>
                <p>Physical counts submitted from Inventory will appear here.</p>
              </section>
            ) : stockAdjustments.map((adjustment) => (
              <article className="approval-card stock-approval-card" key={adjustment.id}>
                <div className="approval-product">
                  <div>
                    <p className="eyebrow">{adjustment.requesterName}</p>
                    <h2>{adjustment.productName}</h2>
                    <p>
                      {adjustment.sku} · {adjustment.rackLocation ?? "Rack not assigned"}
                    </p>
                  </div>
                  <span className="pending-chip">Waiting</span>
                </div>

                <div className="stock-count-comparison">
                  <div>
                    <small>Condition</small>
                    <strong>{words(adjustment.stockCondition)}</strong>
                  </div>
                  <div>
                    <small>Recorded</small>
                    <strong>{adjustment.recordedQuantity}</strong>
                  </div>
                  <div>
                    <small>Physically counted</small>
                    <strong>{adjustment.countedQuantity}</strong>
                  </div>
                  <div className={adjustment.quantityDelta < 0 ? "loss" : "found"}>
                    <small>Difference to apply</small>
                    <strong>
                      {adjustment.quantityDelta > 0 ? "+" : ""}
                      {adjustment.quantityDelta}
                    </strong>
                  </div>
                </div>

                <div className="stock-count-evidence">
                  <p><strong>Reason:</strong> {words(adjustment.reason)}</p>
                  <p><strong>Count note:</strong> {adjustment.note}</p>
                  {adjustment.expectedValueDeltaPaise !== undefined && (
                    <p>
                      <strong>Inventory-value effect:</strong>{" "}
                      {adjustment.expectedValueDeltaPaise > 0 ? "+" : ""}
                      {formatMoney(adjustment.expectedValueDeltaPaise)}
                    </p>
                  )}
                </div>

                <div className="form-row">
                  <label>Optional owner decision note
                    <input
                      value={stockDecisionNote}
                      onChange={(event) => setStockDecisionNote(event.target.value)}
                      maxLength={500}
                    />
                  </label>
                </div>

                <p className="stock-approval-warning">
                  Approval applies this exact count only. If stock moved after
                  counting, the application will stop and require a fresh count.
                </p>
                <div className="decision-buttons">
                  <button
                    type="button"
                    className="reject-button"
                    disabled={workingId === adjustment.id}
                    onClick={() => decideStock(adjustment.id, "REJECT")}
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    className="approve-button"
                    disabled={workingId === adjustment.id}
                    onClick={() => decideStock(adjustment.id, "APPROVE")}
                  >
                    {workingId === adjustment.id
                      ? "Applying…"
                      : "Approve and apply difference"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>}

        {(mode === "ALL" || mode === "GUEST") && <section className="approval-group" aria-labelledby="guest-approval-heading">
          <div className="section-title">
            <h2 id="guest-approval-heading">Customer-declined Guest sales</h2>
            <span>{guestApprovals.length} waiting</span>
          </div>
          <div className="approval-list">
            {guestApprovals.length === 0 ? (
              <section className="results-panel empty-approvals">
                <h2>No Guest requests waiting</h2>
                <p>Retail carts of ₹5,000 or more will appear here when a customer declines details.</p>
              </section>
            ) : guestApprovals.map((approval) => (
              <article className="approval-card guest-approval-card" key={approval.id}>
                <div className="approval-product">
                  <div>
                    <p className="eyebrow">{approval.requesterName}</p>
                    <h2>Customer declined name and phone</h2>
                    <p>{approval.cartSummary.length} products · exact cart shown below</p>
                  </div>
                  <span className="pending-chip">Waiting</span>
                </div>

                <div className="guest-cart-summary">
                  {approval.cartSummary.map((line) => (
                    <div key={line.variantId}>
                      <span>
                        <strong>{line.productName}</strong>
                        <small>{line.sku} · {line.quantity} × {formatMoney(line.unitPricePaise)}</small>
                      </span>
                      <strong>{formatMoney(line.lineTotalPaise)}</strong>
                    </div>
                  ))}
                  <div className="guest-cart-total">
                    <strong>Cart total</strong>
                    <strong>{formatMoney(approval.totalPaise)}</strong>
                  </div>
                </div>

                <div className="form-row">
                  <label>Optional owner note
                    <input
                      value={guestNote}
                      onChange={(event) => setGuestNote(event.target.value)}
                      maxLength={500}
                    />
                  </label>
                </div>

                <div className="decision-buttons">
                  <button
                    type="button"
                    className="reject-button"
                    disabled={workingId === approval.id}
                    onClick={() => decideGuest(approval.id, "REJECT")}
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    className="approve-button"
                    disabled={workingId === approval.id}
                    onClick={() => decideGuest(approval.id, "APPROVE")}
                  >
                    {workingId === approval.id ? "Saving…" : "Approve exact Guest cart"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>}

        {(mode === "ALL" || mode === "PRICE") && <section className="approval-group" aria-labelledby="price-approval-heading">
          <div className="section-title">
            <h2 id="price-approval-heading">Lower-price requests</h2>
            <span>{approvals.length} waiting</span>
          </div>
        <div className="approval-list">
          {approvals.length === 0 ? (
            <section className="results-panel empty-approvals">
              <h2>No requests waiting</h2>
              <p>New lower-price requests will appear here.</p>
            </section>
          ) : approvals.map((approval) => {
            const replacementLoss = Math.max(0, -(approval.expectedReplacementMarginPaise ?? 0));
            return (
              <article className="approval-card" key={approval.id}>
                <div className="approval-product">
                  <div>
                    <p className="eyebrow">{approval.requesterName}</p>
                    <h2>{approval.productName}</h2>
                    <p>{approval.sku} · Quantity {approval.quantity}</p>
                  </div>
                  <span className="pending-chip">Waiting</span>
                </div>

                <div className="approval-money-grid">
                  <div><span>Normal price</span><strong>{formatMoney(approval.standardPricePaise)}</strong></div>
                  <div><span>Operator floor</span><strong>{formatMoney(approval.requesterFloorPaise)}</strong></div>
                  <div className="requested"><span>Requested price</span><strong>{formatMoney(approval.requestedUnitPricePaise)}</strong></div>
                  <div className={replacementLoss > 0 ? "loss" : "safe"}>
                    <span>Expected replacement loss</span>
                    <strong>{replacementLoss > 0 ? formatMoney(replacementLoss) : "No loss"}</strong>
                    {replacementLoss > 0 && <small>{formatMoney(Math.round(replacementLoss / approval.quantity))} per unit</small>}
                  </div>
                </div>

                <p className="accounting-result">
                  Expected accounting result: {formatMoney(approval.expectedGrossResultPaise ?? 0)}
                </p>

                <div className="form-row two-columns">
                  <label>Reason for approval
                    <CustomSelect
                      value={reason}
                      ariaLabel="Reason for approval"
                      options={reasons.map(([value, label]) => ({ value, label }))}
                      onChange={setReason}
                    />
                  </label>
                  <label>{reason === "OTHER" ? "Required owner note" : "Optional owner note"}
                    <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} />
                  </label>
                </div>

                <div className="decision-buttons">
                  <button type="button" className="reject-button" disabled={workingId === approval.id} onClick={() => decide(approval.id, "REJECT")}>Reject</button>
                  <button type="button" className="approve-button" disabled={workingId === approval.id} onClick={() => decide(approval.id, "APPROVE")}>
                    {workingId === approval.id ? "Saving…" : "Approve exact price"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
        </section>}
      </section>
    </AppShell>
  );
}
