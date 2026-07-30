"use client";

import { FormEvent, useRef, useState } from "react";
import Link from "next/link";
import {
  normalizeSkuCode,
  priceFloorConflict,
  PRODUCT_UNITS,
  productPricingConflict,
  recommendedPriceFloors,
  RACK_CODES,
  type ProductUnit,
} from "@/shared/product-setup-policy";
import {
  PRODUCT_CHANGE_REASON_LABELS,
  PRODUCT_CHANGE_REASONS,
  productChangeNoteConflict,
  type ProductChangeReason,
} from "@/shared/product-change-policy";

type Product = {
  id: string;
  name: string;
  variantName: string | null;
  sku: string;
  rackLocation: string | null;
  stock: number;
  openBoxStock?: number;
  damagedStock?: number;
  mrpPaise: number;
  standardPricePaise: number;
  minimumPricePaise: number;
  ownerFloorPaise?: number;
  trustedOperatorFloorPaise?: number;
  storeOperatorFloorPaise?: number;
  inventoryValuePaise?: number;
  latestLandedCostPaise?: number;
  weightedAverageCostPaise?: number;
};

type Supplier = {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
};

type DraftLine = {
  variantId: string;
  productName: string;
  sku: string;
  quantity: number;
  sellableQuantity: number;
  openBoxQuantity: number;
  damagedQuantity: number;
  invoiceUnitCostPaise?: number;
};

type Draft = {
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
  lines: DraftLine[];
};

type ReceiptLine = {
  product: Product;
  sellableQuantity: number;
  openBoxQuantity: number;
  damagedQuantity: number;
  invoiceUnitCostPaise: number;
};

type NewProductForm = {
  productName: string;
  category: string;
  categoryCode: string;
  subcategory: string;
  subcategoryCode: string;
  brand: string;
  variantName: string;
  variantCode: string;
  supplierBarcode: string;
  unitOfMeasure: ProductUnit;
  packSize: string;
  rackLocation: string;
  purchaseCostRupees: string;
  standardPriceRupees: string;
  mrpRupees: string;
  ownerFloorRupees: string;
  trustedFloorRupees: string;
  storeFloorRupees: string;
};

type ProductChangeForm = {
  rackLocation: string;
  mrpRupees: string;
  standardPriceRupees: string;
  ownerFloorRupees: string;
  trustedFloorRupees: string;
  storeFloorRupees: string;
  reason: ProductChangeReason;
  note: string;
};

type Props = {
  displayName: string;
  role: "BUSINESS_OWNER" | "TRUSTED_OPERATOR";
  initialProducts: Product[];
  initialDrafts: Draft[];
  initialSuppliers: Supplier[];
};

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

function formatMoney(paise: number) {
  return money.format(paise / 100);
}

function emptyNewProduct(): NewProductForm {
  return {
    productName: "",
    category: "",
    categoryCode: "",
    subcategory: "",
    subcategoryCode: "",
    brand: "",
    variantName: "",
    variantCode: "",
    supplierBarcode: "",
    unitOfMeasure: "UNIT",
    packSize: "1",
    rackLocation: "",
    purchaseCostRupees: "",
    standardPriceRupees: "",
    mrpRupees: "",
    ownerFloorRupees: "",
    trustedFloorRupees: "",
    storeFloorRupees: "",
  };
}

function rupeesToPaise(value: string): number {
  return Math.round(Number(value) * 100);
}

export default function ReceiveWorkspace({
  displayName,
  role,
  initialProducts,
  initialDrafts,
  initialSuppliers,
}: Props) {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState(initialProducts);
  const [drafts, setDrafts] = useState(initialDrafts);
  const [suppliers, setSuppliers] = useState(initialSuppliers);
  const [supplierId, setSupplierId] = useState(initialSuppliers[0]?.id ?? "");
  const [showNewSupplier, setShowNewSupplier] = useState(initialSuppliers.length === 0);
  const [showNewProduct, setShowNewProduct] = useState(false);
  const [newProduct, setNewProduct] = useState<NewProductForm>(emptyNewProduct);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierPhone, setNewSupplierPhone] = useState("");
  const [selected, setSelected] = useState<Product | null>(null);
  const [managedProduct, setManagedProduct] = useState<Product | null>(null);
  const [productChange, setProductChange] = useState<ProductChangeForm | null>(
    null,
  );
  const [sellableQuantity, setSellableQuantity] = useState(1);
  const [openBoxQuantity, setOpenBoxQuantity] = useState(0);
  const [damagedQuantity, setDamagedQuantity] = useState(0);
  const [unitCostRupees, setUnitCostRupees] = useState("");
  const [receiptLines, setReceiptLines] = useState<ReceiptLine[]>([]);
  const [invoiceReference, setInvoiceReference] = useState("");
  const [note, setNote] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState("");
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [creatingSupplier, setCreatingSupplier] = useState(false);
  const [creatingProduct, setCreatingProduct] = useState(false);
  const [savingProductChange, setSavingProductChange] = useState(false);
  const [completingId, setCompletingId] = useState("");
  const completionCommands = useRef(new Map<string, string>());
  const [commandId, setCommandId] = useState(() => crypto.randomUUID());
  const [productCommandId, setProductCommandId] = useState(
    () => crypto.randomUUID(),
  );
  const [productChangeCommandId, setProductChangeCommandId] = useState(
    () => crypto.randomUUID(),
  );

  function resetDuplicateCheck() {
    setDuplicateWarning("");
    setDuplicateAcknowledged(false);
  }

  function chooseProduct(product: Product) {
    const existing = receiptLines.find((line) => line.product.id === product.id);
    setSelected(product);
    setSellableQuantity(existing?.sellableQuantity ?? 1);
    setOpenBoxQuantity(existing?.openBoxQuantity ?? 0);
    setDamagedQuantity(existing?.damagedQuantity ?? 0);
    setUnitCostRupees(
      existing
        ? (existing.invoiceUnitCostPaise / 100).toFixed(2)
        : role === "BUSINESS_OWNER"
          ? ((product.latestLandedCostPaise ?? 0) / 100).toFixed(2)
          : "",
    );
    setMessage("");
    setError("");
  }

  async function findProducts(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/catalog?q=${encodeURIComponent(query)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Products could not be loaded.");
      setProducts(body.products);
      if (body.products.length === 1) chooseProduct(body.products[0]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Products could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  async function createNewSupplier(event: FormEvent) {
    event.preventDefault();
    setCreatingSupplier(true);
    setError("");
    try {
      const response = await fetch("/api/v1/suppliers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: newSupplierName,
          phone: newSupplierPhone.trim() || undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Supplier could not be added.");
      setSuppliers((current) => [...current, body.supplier].sort((a, b) =>
        a.name.localeCompare(b.name),
      ));
      setSupplierId(body.supplier.id);
      setNewSupplierName("");
      setNewSupplierPhone("");
      setShowNewSupplier(false);
      setMessage(`${body.supplier.name} added and selected.`);
      resetDuplicateCheck();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Supplier could not be added.");
    } finally {
      setCreatingSupplier(false);
    }
  }

  function changeNewProduct<K extends keyof NewProductForm>(
    field: K,
    value: NewProductForm[K],
  ) {
    setNewProduct((current) => ({ ...current, [field]: value }));
  }

  function beginProductChange(product: Product) {
    if (
      product.ownerFloorPaise === undefined ||
      product.trustedOperatorFloorPaise === undefined ||
      product.storeOperatorFloorPaise === undefined ||
      product.latestLandedCostPaise === undefined ||
      !product.rackLocation
    ) {
      setError("Current owner pricing or rack details could not be loaded.");
      return;
    }
    setManagedProduct(product);
    setProductChange({
      rackLocation: product.rackLocation,
      mrpRupees: (product.mrpPaise / 100).toFixed(2),
      standardPriceRupees: (product.standardPricePaise / 100).toFixed(2),
      ownerFloorRupees: (product.ownerFloorPaise / 100).toFixed(2),
      trustedFloorRupees: (
        product.trustedOperatorFloorPaise / 100
      ).toFixed(2),
      storeFloorRupees: (product.storeOperatorFloorPaise / 100).toFixed(2),
      reason: "MARGIN_REVIEW",
      note: "",
    });
    setProductChangeCommandId(crypto.randomUUID());
    setError("");
    setMessage("");
  }

  function changeExistingProduct<K extends keyof ProductChangeForm>(
    field: K,
    value: ProductChangeForm[K],
  ) {
    setProductChange((current) =>
      current ? { ...current, [field]: value } : current,
    );
  }

  async function saveExistingProduct(event: FormEvent) {
    event.preventDefault();
    if (!managedProduct || !productChange) return;
    const payload = {
      rackLocation: productChange.rackLocation,
      mrpPaise: rupeesToPaise(productChange.mrpRupees),
      standardPricePaise: rupeesToPaise(productChange.standardPriceRupees),
      ownerFloorPaise: rupeesToPaise(productChange.ownerFloorRupees),
      trustedOperatorFloorPaise: rupeesToPaise(
        productChange.trustedFloorRupees,
      ),
      storeOperatorFloorPaise: rupeesToPaise(productChange.storeFloorRupees),
      reason: productChange.reason,
      note: productChange.note.trim() || undefined,
    };
    const pricingConflict = productPricingConflict(
      managedProduct.latestLandedCostPaise ?? 0,
      payload.standardPricePaise,
      payload.mrpPaise,
    );
    const floorConflict = priceFloorConflict(
      managedProduct.latestLandedCostPaise ?? 0,
      payload.standardPricePaise,
      {
        ownerFloorPaise: payload.ownerFloorPaise,
        trustedOperatorFloorPaise: payload.trustedOperatorFloorPaise,
        storeOperatorFloorPaise: payload.storeOperatorFloorPaise,
      },
    );
    const noteConflict = productChangeNoteConflict(
      payload.reason,
      payload.note,
    );
    if (pricingConflict || floorConflict || noteConflict) {
      setError(pricingConflict || floorConflict || noteConflict || "");
      return;
    }
    setSavingProductChange(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/products/${managedProduct.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "idempotency-key": productChangeCommandId,
        },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error?.message ?? "The product could not be updated.");
      }
      const updated = body.change.product as Product;
      setProducts((current) =>
        current.map((product) => product.id === updated.id ? updated : product),
      );
      setReceiptLines((current) =>
        current.map((line) =>
          line.product.id === updated.id
            ? { ...line, product: updated }
            : line,
        ),
      );
      if (selected?.id === updated.id) setSelected(updated);
      setManagedProduct(null);
      setProductChange(null);
      setProductChangeCommandId(crypto.randomUUID());
      setMessage(
        `${updated.sku} updated · ${body.change.priceChanged ? "new price version" : "prices unchanged"} · ${body.change.rackChanged ? `rack ${updated.rackLocation}` : "rack unchanged"}.`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The product could not be updated.");
    } finally {
      setSavingProductChange(false);
    }
  }

  async function createNewProduct(event: FormEvent) {
    event.preventDefault();
    const purchaseCostPaise = rupeesToPaise(newProduct.purchaseCostRupees);
    const standardPricePaise = rupeesToPaise(newProduct.standardPriceRupees);
    const mrpPaise = rupeesToPaise(newProduct.mrpRupees);
    const pricingConflict = productPricingConflict(
      purchaseCostPaise,
      standardPricePaise,
      mrpPaise,
    );
    if (pricingConflict) {
      setError(pricingConflict);
      return;
    }
    const recommendedFloors = recommendedPriceFloors(
      purchaseCostPaise,
      standardPricePaise,
    );
    const selectedFloors = {
      ownerFloorPaise: newProduct.ownerFloorRupees
        ? rupeesToPaise(newProduct.ownerFloorRupees)
        : recommendedFloors.ownerFloorPaise,
      trustedOperatorFloorPaise: newProduct.trustedFloorRupees
        ? rupeesToPaise(newProduct.trustedFloorRupees)
        : recommendedFloors.trustedOperatorFloorPaise,
      storeOperatorFloorPaise: newProduct.storeFloorRupees
        ? rupeesToPaise(newProduct.storeFloorRupees)
        : recommendedFloors.storeOperatorFloorPaise,
    };
    const floorConflict = priceFloorConflict(
      purchaseCostPaise,
      standardPricePaise,
      selectedFloors,
    );
    if (floorConflict) {
      setError(floorConflict);
      return;
    }
    setCreatingProduct(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/v1/products", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": productCommandId,
        },
        body: JSON.stringify({
          productName: newProduct.productName,
          category: newProduct.category,
          categoryCode: newProduct.categoryCode,
          subcategory: newProduct.subcategory,
          subcategoryCode: newProduct.subcategoryCode,
          brand: newProduct.brand.trim() || undefined,
          variantName: newProduct.variantName.trim() || undefined,
          variantCode: newProduct.variantCode.trim() || undefined,
          supplierBarcode: newProduct.supplierBarcode.trim() || undefined,
          unitOfMeasure: newProduct.unitOfMeasure,
          packSize: Number(newProduct.packSize),
          rackLocation: newProduct.rackLocation,
          purchaseCostPaise,
          standardPricePaise,
          mrpPaise,
          ...(newProduct.ownerFloorRupees
            ? { ownerFloorPaise: selectedFloors.ownerFloorPaise }
            : {}),
          ...(newProduct.trustedFloorRupees
            ? {
                trustedOperatorFloorPaise:
                  selectedFloors.trustedOperatorFloorPaise,
              }
            : {}),
          ...(newProduct.storeFloorRupees
            ? {
                storeOperatorFloorPaise:
                  selectedFloors.storeOperatorFloorPaise,
              }
            : {}),
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error?.message ?? "The product could not be created.");
      }
      setProducts((current) => [
        body.product,
        ...current.filter((product) => product.id !== body.product.id),
      ]);
      chooseProduct(body.product);
      setUnitCostRupees(newProduct.purchaseCostRupees);
      setNewProduct(emptyNewProduct());
      setProductCommandId(crypto.randomUUID());
      setShowNewProduct(false);
      setMessage(
        `${body.product.sku} created with zero stock. Add its quantities to this receipt to bring stock in.`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The product could not be created.");
    } finally {
      setCreatingProduct(false);
    }
  }

  function addReceiptLine(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    const invoiceUnitCostPaise = Math.round(Number(unitCostRupees) * 100);
    const totalQuantity = sellableQuantity + openBoxQuantity + damagedQuantity;
    if (totalQuantity < 1 || invoiceUnitCostPaise < 1) {
      setError("Enter at least one unit in a condition and a valid invoice cost.");
      return;
    }
    setReceiptLines((current) => [
      ...current.filter((line) => line.product.id !== selected.id),
      {
        product: selected,
        sellableQuantity,
        openBoxQuantity,
        damagedQuantity,
        invoiceUnitCostPaise,
      },
    ]);
    setMessage(
      `${selected.name} ${receiptLines.some((line) => line.product.id === selected.id) ? "updated" : "added"} on this receipt.`,
    );
    setError("");
    setSelected(null);
    setSellableQuantity(1);
    setOpenBoxQuantity(0);
    setDamagedQuantity(0);
    setUnitCostRupees("");
    setQuery("");
    resetDuplicateCheck();
  }

  function removeReceiptLine(variantId: string) {
    setReceiptLines((current) => current.filter((line) => line.product.id !== variantId));
    if (selected?.id === variantId) setSelected(null);
    resetDuplicateCheck();
  }

  function applyCompletedLines(lines: Array<{
    variantId: string;
    newStock: number;
    newOpenBoxStock: number;
    newDamagedStock: number;
    inventoryValuePaise: number;
    latestLandedCostPaise: number;
    weightedAverageCostPaise: number;
  }>) {
    const byVariant = new Map(lines.map((line) => [line.variantId, line]));
    setProducts((current) => current.map((product) => {
      const result = byVariant.get(product.id);
      return result ? {
        ...product,
        stock: result.newStock,
        openBoxStock: result.newOpenBoxStock,
        damagedStock: result.newDamagedStock,
        inventoryValuePaise: result.inventoryValuePaise,
        latestLandedCostPaise: result.latestLandedCostPaise,
        weightedAverageCostPaise: result.weightedAverageCostPaise,
      } : product;
    }));
  }

  async function saveReceipt() {
    if (!supplierId || receiptLines.length === 0) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/v1/stock-receipts", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": commandId },
        body: JSON.stringify({
          supplierId,
          supplierInvoiceReference: invoiceReference.trim() || undefined,
          note: note.trim() || undefined,
          duplicateAcknowledged,
          lines: receiptLines.map((line) => ({
            variantId: line.product.id,
            sellableQuantity: line.sellableQuantity,
            openBoxQuantity: line.openBoxQuantity,
            damagedQuantity: line.damagedQuantity,
            invoiceUnitCostPaise: line.invoiceUnitCostPaise,
          })),
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        if (body.error?.code === "POSSIBLE_DUPLICATE_SUPPLIER_INVOICE") {
          setDuplicateWarning(body.error.message);
          return;
        }
        throw new Error(body.error?.message ?? "The receipt could not be saved.");
      }

      if (role === "TRUSTED_OPERATOR") {
        setDrafts((current) => [
          body.draft,
          ...current.filter((draft) => draft.receiptId !== body.draft.receiptId),
        ]);
        setMessage(
          `${body.draft.receiptNumber} saved with ${body.draft.lines.length} product lines · stock unchanged.`,
        );
      } else {
        applyCompletedLines(body.receipt.lines);
        setMessage(
          `${body.receipt.receiptNumber} complete · ${body.receipt.totalReceivedQuantity} units across ${body.receipt.lines.length} products.`,
        );
      }
      setReceiptLines([]);
      setSelected(null);
      setInvoiceReference("");
      setNote("");
      setCommandId(crypto.randomUUID());
      resetDuplicateCheck();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The receipt could not be saved.");
    } finally {
      setSubmitting(false);
    }
  }

  async function completeDraft(draft: Draft) {
    let completionCommandId = completionCommands.current.get(draft.receiptId);
    if (!completionCommandId) {
      completionCommandId = crypto.randomUUID();
      completionCommands.current.set(draft.receiptId, completionCommandId);
    }
    setCompletingId(draft.receiptId);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/v1/stock-receipts/${draft.receiptId}/complete`, {
        method: "POST",
        headers: { "idempotency-key": completionCommandId },
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error?.message ?? "Receipt draft could not be completed.");
      }
      setDrafts((current) => current.filter((item) => item.receiptId !== draft.receiptId));
      completionCommands.current.delete(draft.receiptId);
      applyCompletedLines(body.receipt.lines);
      setMessage(
        `${draft.receiptNumber} complete · ${body.receipt.totalReceivedQuantity} units added across ${body.receipt.lines.length} products.`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Receipt draft could not be completed.");
    } finally {
      setCompletingId("");
    }
  }

  const receiptSellableQuantity = receiptLines.reduce(
    (sum, line) => sum + line.sellableQuantity,
    0,
  );
  const receiptOpenBoxQuantity = receiptLines.reduce(
    (sum, line) => sum + line.openBoxQuantity,
    0,
  );
  const receiptDamagedQuantity = receiptLines.reduce(
    (sum, line) => sum + line.damagedQuantity,
    0,
  );
  const receiptQuantity =
    receiptSellableQuantity + receiptOpenBoxQuantity + receiptDamagedQuantity;
  const receiptValuePaise = receiptLines.reduce(
    (sum, line) =>
      sum
      + (line.sellableQuantity + line.openBoxQuantity + line.damagedQuantity)
        * line.invoiceUnitCostPaise,
    0,
  );
  const invoiceUnitCostPaise = Math.round(Number(unitCostRupees || 0) * 100);
  const newPurchaseCostPaise = rupeesToPaise(newProduct.purchaseCostRupees);
  const newStandardPricePaise = rupeesToPaise(newProduct.standardPriceRupees);
  const newMrpPaise = rupeesToPaise(newProduct.mrpRupees);
  const newProductPricingConflict =
    newPurchaseCostPaise > 0 &&
    newStandardPricePaise > 0 &&
    newMrpPaise > 0
      ? productPricingConflict(
          newPurchaseCostPaise,
          newStandardPricePaise,
          newMrpPaise,
        )
      : null;
  const newProductFloors =
    newPurchaseCostPaise > 0 && newStandardPricePaise > 0
      ? recommendedPriceFloors(newPurchaseCostPaise, newStandardPricePaise)
      : null;
  const selectedNewProductFloors = newProductFloors
    ? {
        ownerFloorPaise: newProduct.ownerFloorRupees
          ? rupeesToPaise(newProduct.ownerFloorRupees)
          : newProductFloors.ownerFloorPaise,
        trustedOperatorFloorPaise: newProduct.trustedFloorRupees
          ? rupeesToPaise(newProduct.trustedFloorRupees)
          : newProductFloors.trustedOperatorFloorPaise,
        storeOperatorFloorPaise: newProduct.storeFloorRupees
          ? rupeesToPaise(newProduct.storeFloorRupees)
          : newProductFloors.storeOperatorFloorPaise,
      }
    : null;
  const newProductFloorConflict =
    selectedNewProductFloors && newProductPricingConflict === null
      ? priceFloorConflict(
          newPurchaseCostPaise,
          newStandardPricePaise,
          selectedNewProductFloors,
        )
      : null;
  const skuPreview = [
    "IMT",
    normalizeSkuCode(newProduct.categoryCode) || "CCC",
    normalizeSkuCode(newProduct.subcategoryCode) || "SS",
    "####",
    ...(normalizeSkuCode(newProduct.variantCode, 4)
      ? [normalizeSkuCode(newProduct.variantCode, 4)]
      : []),
  ].join("-");
  const changedMrpPaise = productChange
    ? rupeesToPaise(productChange.mrpRupees)
    : 0;
  const changedStandardPricePaise = productChange
    ? rupeesToPaise(productChange.standardPriceRupees)
    : 0;
  const changedFloors = productChange
    ? {
        ownerFloorPaise: rupeesToPaise(productChange.ownerFloorRupees),
        trustedOperatorFloorPaise: rupeesToPaise(
          productChange.trustedFloorRupees,
        ),
        storeOperatorFloorPaise: rupeesToPaise(productChange.storeFloorRupees),
      }
    : null;
  const existingProductPricingConflict =
    managedProduct && productChange
      ? productPricingConflict(
          managedProduct.latestLandedCostPaise ?? 0,
          changedStandardPricePaise,
          changedMrpPaise,
        )
      : null;
  const existingProductFloorConflict =
    managedProduct && changedFloors && !existingProductPricingConflict
      ? priceFloorConflict(
          managedProduct.latestLandedCostPaise ?? 0,
          changedStandardPricePaise,
          changedFloors,
        )
      : null;
  const existingProductNoteConflict = productChange
    ? productChangeNoteConflict(productChange.reason, productChange.note)
    : null;
  const existingProductHasChanges =
    Boolean(managedProduct && productChange && changedFloors) &&
    (
      managedProduct!.rackLocation !== productChange!.rackLocation ||
      managedProduct!.mrpPaise !== changedMrpPaise ||
      managedProduct!.standardPricePaise !== changedStandardPricePaise ||
      managedProduct!.ownerFloorPaise !== changedFloors!.ownerFloorPaise ||
      managedProduct!.trustedOperatorFloorPaise !==
        changedFloors!.trustedOperatorFloorPaise ||
      managedProduct!.storeOperatorFloorPaise !==
        changedFloors!.storeOperatorFloorPaise
    );

  return (
    <main className="app-shell">
      <header className="topbar">
        <div><p className="brand">ItsMyToy</p><p className="welcome">Hi, {displayName}</p></div>
        <nav className="app-nav" aria-label="Operations">
          {role === "BUSINESS_OWNER" && <Link href="/dashboard">Home</Link>}<Link href="/">Sell</Link><Link className="active" href="/receive">Receive</Link><Link href="/inventory">Inventory</Link><Link href="/activity">Activity</Link><Link href="/sign-out">Sign out</Link>
        </nav>
        <span className="role-chip">
          {role === "BUSINESS_OWNER" ? "Business owner" : "Trusted operator"}
        </span>
      </header>

      <section className="sell-page" aria-labelledby="receive-heading">
        <div className="page-heading">
          <p className="eyebrow">Incoming stock</p>
          <h1 id="receive-heading">
            {role === "BUSINESS_OWNER" ? "Build. Check. Receive." : "Build. Save. Owner checks."}
          </h1>
          <p>
            One supplier bill becomes one receipt with all its product lines.
            {role === "TRUSTED_OPERATOR" && " Stock stays unchanged until owner completion."}
          </p>
        </div>

        {error && <p className="alert error" role="alert">{error}</p>}
        {message && <p className="alert success" role="status">{message}</p>}

        <section className="receipt-header-card" aria-labelledby="supplier-bill-heading">
          <div className="section-title">
            <h2 id="supplier-bill-heading">1. Supplier bill</h2>
            <button
              type="button"
              className="text-button"
              onClick={() => setShowNewSupplier((current) => !current)}
            >
              {showNewSupplier ? "Cancel" : "Add supplier"}
            </button>
          </div>
          <div className="form-row two-columns">
            <label>
              Supplier
              <select
                value={supplierId}
                onChange={(event) => {
                  setSupplierId(event.target.value);
                  resetDuplicateCheck();
                }}
                required
              >
                <option value="">Select supplier</option>
                {suppliers.map((supplier) => (
                  <option value={supplier.id} key={supplier.id}>{supplier.name}</option>
                ))}
              </select>
            </label>
            <label>
              Bill / invoice reference
              <input
                value={invoiceReference}
                onChange={(event) => {
                  setInvoiceReference(event.target.value);
                  resetDuplicateCheck();
                }}
                maxLength={120}
                placeholder="Recommended"
              />
            </label>
          </div>
          <label>
            Note or discrepancy
            <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="Optional" />
          </label>
          {showNewSupplier && (
            <form className="new-supplier-form" onSubmit={createNewSupplier}>
              <label>Supplier name<input value={newSupplierName} onChange={(event) => setNewSupplierName(event.target.value)} maxLength={120} required /></label>
              <label>Phone, optional<input value={newSupplierPhone} onChange={(event) => setNewSupplierPhone(event.target.value)} inputMode="tel" maxLength={18} /></label>
              <button type="submit" disabled={creatingSupplier}>
                {creatingSupplier ? "Adding…" : "Add and select supplier"}
              </button>
            </form>
          )}
        </section>

        <form className="search-bar" onSubmit={findProducts}>
          <label htmlFor="product-search">2. Scan or find a product to add</label>
          <div className="search-row">
            <input id="product-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="SKU, barcode or product name" autoComplete="off" />
            <button type="submit" disabled={loading}>{loading ? "Finding…" : "Find"}</button>
          </div>
        </form>

        {role === "BUSINESS_OWNER" && (
          <section className="new-product-panel" aria-labelledby="new-product-heading">
            <div className="section-title">
              <div>
                <p className="eyebrow">Owner control</p>
                <h2 id="new-product-heading">Product not found?</h2>
              </div>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setShowNewProduct((current) => !current);
                  setError("");
                }}
              >
                {showNewProduct ? "Cancel" : "Create new product"}
              </button>
            </div>
            {!showNewProduct ? (
              <p>
                Create the SKU, internal barcode, prices and rack first. Stock remains
                zero until this receipt is completed.
              </p>
            ) : (
              <form className="new-product-form" onSubmit={createNewProduct}>
                <div className="new-product-guidance">
                  <strong>Identity first, then stock.</strong>
                  <span>
                    The app assigns the next number. Your printed barcode will contain
                    the generated SKU.
                  </span>
                </div>
                <div className="form-row two-columns">
                  <label>
                    Product name
                    <input
                      value={newProduct.productName}
                      onChange={(event) =>
                        changeNewProduct("productName", event.target.value)}
                      minLength={2}
                      maxLength={180}
                      required
                    />
                  </label>
                  <label>
                    Brand, optional
                    <input
                      value={newProduct.brand}
                      onChange={(event) => changeNewProduct("brand", event.target.value)}
                      maxLength={80}
                    />
                  </label>
                </div>
                <div className="product-code-grid">
                  <label>
                    Category
                    <input
                      value={newProduct.category}
                      onChange={(event) =>
                        changeNewProduct("category", event.target.value)}
                      minLength={2}
                      maxLength={80}
                      placeholder="Cars & Vehicles"
                      required
                    />
                  </label>
                  <label>
                    Category code
                    <input
                      value={newProduct.categoryCode}
                      onChange={(event) =>
                        changeNewProduct(
                          "categoryCode",
                          normalizeSkuCode(event.target.value),
                        )}
                      minLength={2}
                      maxLength={3}
                      placeholder="CAR"
                      required
                    />
                  </label>
                  <label>
                    Sub-category
                    <input
                      value={newProduct.subcategory}
                      onChange={(event) =>
                        changeNewProduct("subcategory", event.target.value)}
                      minLength={2}
                      maxLength={80}
                      placeholder="Remote Control"
                      required
                    />
                  </label>
                  <label>
                    Sub-category code
                    <input
                      value={newProduct.subcategoryCode}
                      onChange={(event) =>
                        changeNewProduct(
                          "subcategoryCode",
                          normalizeSkuCode(event.target.value),
                        )}
                      minLength={2}
                      maxLength={3}
                      placeholder="RC"
                      required
                    />
                  </label>
                </div>
                <div className="form-row two-columns">
                  <label>
                    Variant, optional
                    <input
                      value={newProduct.variantName}
                      onChange={(event) =>
                        changeNewProduct("variantName", event.target.value)}
                      maxLength={80}
                      placeholder="Red"
                    />
                  </label>
                  <label>
                    Variant code, optional
                    <input
                      value={newProduct.variantCode}
                      onChange={(event) =>
                        changeNewProduct(
                          "variantCode",
                          normalizeSkuCode(event.target.value, 4),
                        )}
                      minLength={2}
                      maxLength={4}
                      placeholder="RED"
                    />
                  </label>
                </div>
                <div className="sku-preview">
                  <span>Generated SKU preview</span>
                  <strong>{skuPreview}</strong>
                </div>
                <div className="form-row two-columns">
                  <label>
                    Supplier barcode, optional
                    <input
                      value={newProduct.supplierBarcode}
                      onChange={(event) =>
                        changeNewProduct("supplierBarcode", event.target.value)}
                      maxLength={120}
                      placeholder="Stored as alternate"
                    />
                  </label>
                  <label>
                    Primary rack · S1 bottom, S6 top
                    <select
                      value={newProduct.rackLocation}
                      onChange={(event) =>
                        changeNewProduct("rackLocation", event.target.value)}
                      required
                    >
                      <option value="">Choose rack and shelf</option>
                      {RACK_CODES.map((rack) => (
                        <option value={rack} key={rack}>{rack}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="form-row two-columns">
                  <label>
                    Unit
                    <select
                      value={newProduct.unitOfMeasure}
                      onChange={(event) =>
                        changeNewProduct(
                          "unitOfMeasure",
                          event.target.value as ProductUnit,
                        )}
                    >
                      {PRODUCT_UNITS.map((unit) => (
                        <option value={unit} key={unit}>{unit}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Pack size
                    <input
                      type="number"
                      min="1"
                      max="100000"
                      value={newProduct.packSize}
                      onChange={(event) =>
                        changeNewProduct("packSize", event.target.value)}
                      required
                    />
                  </label>
                </div>
                <div className="new-product-price-grid">
                  <label>
                    Purchase cost (₹)
                    <input
                      type="number"
                      min="0.01"
                      max="1000000"
                      step="0.01"
                      value={newProduct.purchaseCostRupees}
                      onChange={(event) =>
                        changeNewProduct("purchaseCostRupees", event.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Standard selling price (₹)
                    <input
                      type="number"
                      min="0.01"
                      max="1000000"
                      step="0.01"
                      value={newProduct.standardPriceRupees}
                      onChange={(event) =>
                        changeNewProduct("standardPriceRupees", event.target.value)}
                      required
                    />
                  </label>
                  <label>
                    MRP (₹)
                    <input
                      type="number"
                      min="0.01"
                      max="1000000"
                      step="0.01"
                      value={newProduct.mrpRupees}
                      onChange={(event) =>
                        changeNewProduct("mrpRupees", event.target.value)}
                      required
                    />
                  </label>
                </div>
                {newProductFloors && !newProductPricingConflict && (
                  <div className="price-floor-preview">
                    <span>
                      <small>Recommended owner floor</small>
                      <strong>{formatMoney(newProductFloors.ownerFloorPaise)}</strong>
                    </span>
                    <span>
                      <small>Recommended trusted floor</small>
                      <strong>
                        {formatMoney(newProductFloors.trustedOperatorFloorPaise)}
                      </strong>
                    </span>
                    <span>
                      <small>Recommended store floor</small>
                      <strong>
                        {formatMoney(newProductFloors.storeOperatorFloorPaise)}
                      </strong>
                    </span>
                  </div>
                )}
                {newProductFloors && !newProductPricingConflict && (
                  <div className="new-product-price-grid floor-overrides">
                    <label>
                      Owner floor override (₹)
                      <input
                        type="number"
                        min="0.01"
                        max="1000000"
                        step="0.01"
                        value={newProduct.ownerFloorRupees}
                        onChange={(event) =>
                          changeNewProduct("ownerFloorRupees", event.target.value)}
                        placeholder={(newProductFloors.ownerFloorPaise / 100).toFixed(2)}
                      />
                    </label>
                    <label>
                      Trusted floor override (₹)
                      <input
                        type="number"
                        min="0.01"
                        max="1000000"
                        step="0.01"
                        value={newProduct.trustedFloorRupees}
                        onChange={(event) =>
                          changeNewProduct("trustedFloorRupees", event.target.value)}
                        placeholder={
                          (newProductFloors.trustedOperatorFloorPaise / 100).toFixed(2)
                        }
                      />
                    </label>
                    <label>
                      Store floor override (₹)
                      <input
                        type="number"
                        min="0.01"
                        max="1000000"
                        step="0.01"
                        value={newProduct.storeFloorRupees}
                        onChange={(event) =>
                          changeNewProduct("storeFloorRupees", event.target.value)}
                        placeholder={
                          (newProductFloors.storeOperatorFloorPaise / 100).toFixed(2)
                        }
                      />
                    </label>
                    <p>
                      Leave blank to use the recommendation. Overrides still follow
                      purchase cost and role ordering.
                    </p>
                  </div>
                )}
                {(newProductPricingConflict || newProductFloorConflict) && (
                  <p className="inline-validation">
                    {newProductPricingConflict || newProductFloorConflict}
                  </p>
                )}
                <button
                  className="complete-button"
                  type="submit"
                  disabled={
                    creatingProduct ||
                    Boolean(newProductPricingConflict || newProductFloorConflict)
                  }
                >
                  {creatingProduct
                    ? "Creating safely…"
                    : "Create with zero stock and select"}
                </button>
              </form>
            )}
          </section>
        )}

        <div className="workspace-grid">
          <section className="results-panel" aria-labelledby="products-heading">
            <div className="section-title"><h2 id="products-heading">Existing products</h2><span>{products.length} shown</span></div>
            <div className="product-list">
              {products.map((product) => {
                const onReceipt = receiptLines.find((line) => line.product.id === product.id);
                return (
                  <button className={`product-row${selected?.id === product.id ? " selected" : ""}`} type="button" key={product.id} onClick={() => chooseProduct(product)}>
                    <span className="product-icon" aria-hidden="true">{product.name.slice(0, 1)}</span>
                    <span className="product-copy"><strong>{product.name}</strong><small>{product.variantName} · {product.sku}</small><small>{product.rackLocation ?? "Rack not set"}</small></span>
                    <span className="stock-pill">
                      {onReceipt
                        ? `${onReceipt.sellableQuantity + onReceipt.openBoxQuantity + onReceipt.damagedQuantity} added`
                        : `${product.stock} sellable`}
                    </span>
                    {(product.openBoxStock !== undefined || product.damagedStock !== undefined) && (
                      <span className="condition-stock-note">
                        {product.openBoxStock ?? 0} open box · {product.damagedStock ?? 0} damaged
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="checkout-panel" aria-labelledby="receipt-product-heading">
            {!selected ? (
              <div className="empty-state"><span aria-hidden="true">↖</span><h2>Select a product</h2><p>Choose each product from this supplier bill.</p></div>
            ) : (
              <form onSubmit={addReceiptLine}>
                <div className="selected-product">
                  <div><p className="eyebrow">Receipt line</p><h2 id="receipt-product-heading">{selected.name}</h2><p>{selected.sku} · {selected.rackLocation}</p></div>
                  <span className="stock-large">{selected.stock}<small>currently</small></span>
                </div>
                {role === "BUSINESS_OWNER" && (
                  <button
                    type="button"
                    className="manage-product-button"
                    onClick={() => beginProductChange(selected)}
                  >
                    Manage current prices and rack
                  </button>
                )}
                <div className="condition-quantity-grid">
                  <label>Sellable<input type="number" min="0" max="5000" value={sellableQuantity} onChange={(event) => setSellableQuantity(Number(event.target.value))} required /></label>
                  <label>Open box<input type="number" min="0" max="5000" value={openBoxQuantity} onChange={(event) => setOpenBoxQuantity(Number(event.target.value))} required /></label>
                  <label>Damaged<input type="number" min="0" max="5000" value={damagedQuantity} onChange={(event) => setDamagedQuantity(Number(event.target.value))} required /></label>
                </div>
                <label className="unit-cost-field">Invoice unit cost (₹)<input type="number" min="0.01" max="1000000" step="0.01" value={unitCostRupees} onChange={(event) => setUnitCostRupees(event.target.value)} required /></label>
                <p className="condition-guidance">
                  Open-box and damaged units never enter ordinary sellable stock.
                </p>
                <button
                  className="complete-button"
                  type="submit"
                  disabled={
                    sellableQuantity + openBoxQuantity + damagedQuantity < 1 ||
                    invoiceUnitCostPaise < 1
                  }
                >
                  {receiptLines.some((line) => line.product.id === selected.id)
                    ? "Update receipt line"
                    : "Add product to receipt"}
                </button>
              </form>
            )}
          </section>
        </div>

        {role === "BUSINESS_OWNER" && managedProduct && productChange && (
          <section
            className="product-change-panel"
            aria-labelledby="product-change-heading"
          >
            <div className="section-title">
              <div>
                <p className="eyebrow">Owner-only change</p>
                <h2 id="product-change-heading">
                  Manage {managedProduct.name}
                </h2>
                <p>{managedProduct.sku}</p>
              </div>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setManagedProduct(null);
                  setProductChange(null);
                  setError("");
                }}
              >
                Cancel
              </button>
            </div>
            <div className="change-safety-note">
              <strong>Stock quantities will not change.</strong>
              <span>
                Saving prices closes the old version and starts a new one.
                Historical sales keep their original snapshots.
              </span>
            </div>
            <form className="product-change-form" onSubmit={saveExistingProduct}>
              <div className="product-change-facts">
                <span>
                  <small>Sellable stock</small>
                  <strong>{managedProduct.stock}</strong>
                </span>
                <span>
                  <small>Replacement cost</small>
                  <strong>
                    {formatMoney(managedProduct.latestLandedCostPaise ?? 0)}
                  </strong>
                </span>
                <span>
                  <small>Current rack</small>
                  <strong>{managedProduct.rackLocation}</strong>
                </span>
              </div>
              <label>
                Primary rack · S1 bottom, S6 top
                <select
                  value={productChange.rackLocation}
                  onChange={(event) =>
                    changeExistingProduct("rackLocation", event.target.value)}
                  required
                >
                  {RACK_CODES.map((rack) => (
                    <option value={rack} key={rack}>{rack}</option>
                  ))}
                </select>
              </label>
              <div className="new-product-price-grid">
                <label>
                  Standard selling price (₹)
                  <input
                    type="number"
                    min="0.01"
                    max="1000000"
                    step="0.01"
                    value={productChange.standardPriceRupees}
                    onChange={(event) =>
                      changeExistingProduct(
                        "standardPriceRupees",
                        event.target.value,
                      )}
                    required
                  />
                </label>
                <label>
                  MRP (₹)
                  <input
                    type="number"
                    min="0.01"
                    max="1000000"
                    step="0.01"
                    value={productChange.mrpRupees}
                    onChange={(event) =>
                      changeExistingProduct("mrpRupees", event.target.value)}
                    required
                  />
                </label>
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => {
                    const floors = recommendedPriceFloors(
                      managedProduct.latestLandedCostPaise ?? 0,
                      changedStandardPricePaise,
                    );
                    setProductChange((current) => current ? {
                      ...current,
                      ownerFloorRupees:
                        (floors.ownerFloorPaise / 100).toFixed(2),
                      trustedFloorRupees:
                        (floors.trustedOperatorFloorPaise / 100).toFixed(2),
                      storeFloorRupees:
                        (floors.storeOperatorFloorPaise / 100).toFixed(2),
                    } : current);
                  }}
                >
                  Recalculate recommended floors
                </button>
              </div>
              <div className="new-product-price-grid">
                <label>
                  Owner floor (₹)
                  <input
                    type="number"
                    min="0.01"
                    max="1000000"
                    step="0.01"
                    value={productChange.ownerFloorRupees}
                    onChange={(event) =>
                      changeExistingProduct(
                        "ownerFloorRupees",
                        event.target.value,
                      )}
                    required
                  />
                </label>
                <label>
                  Trusted-operator floor (₹)
                  <input
                    type="number"
                    min="0.01"
                    max="1000000"
                    step="0.01"
                    value={productChange.trustedFloorRupees}
                    onChange={(event) =>
                      changeExistingProduct(
                        "trustedFloorRupees",
                        event.target.value,
                      )}
                    required
                  />
                </label>
                <label>
                  Store-operator floor (₹)
                  <input
                    type="number"
                    min="0.01"
                    max="1000000"
                    step="0.01"
                    value={productChange.storeFloorRupees}
                    onChange={(event) =>
                      changeExistingProduct(
                        "storeFloorRupees",
                        event.target.value,
                      )}
                    required
                  />
                </label>
              </div>
              <div className="form-row two-columns">
                <label>
                  Change reason
                  <select
                    value={productChange.reason}
                    onChange={(event) =>
                      changeExistingProduct(
                        "reason",
                        event.target.value as ProductChangeReason,
                      )}
                  >
                    {PRODUCT_CHANGE_REASONS.map((reason) => (
                      <option value={reason} key={reason}>
                        {PRODUCT_CHANGE_REASON_LABELS[reason]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {productChange.reason === "OTHER"
                    ? "Required explanation"
                    : "Change note, optional"}
                  <input
                    value={productChange.note}
                    onChange={(event) =>
                      changeExistingProduct("note", event.target.value)}
                    maxLength={500}
                    required={productChange.reason === "OTHER"}
                  />
                </label>
              </div>
              {(existingProductPricingConflict ||
                existingProductFloorConflict ||
                existingProductNoteConflict) && (
                <p className="inline-validation">
                  {existingProductPricingConflict ||
                    existingProductFloorConflict ||
                    existingProductNoteConflict}
                </p>
              )}
              {!existingProductHasChanges && (
                <p className="change-neutral-note">
                  Change a price or select a different rack before saving.
                </p>
              )}
              <button
                className="complete-button"
                type="submit"
                disabled={
                  savingProductChange ||
                  !existingProductHasChanges ||
                  Boolean(
                    existingProductPricingConflict ||
                    existingProductFloorConflict ||
                    existingProductNoteConflict,
                  )
                }
              >
                {savingProductChange
                  ? "Saving version safely…"
                  : "Save new price/rack version"}
              </button>
            </form>
          </section>
        )}

        <section className="receipt-builder" aria-labelledby="receipt-builder-heading">
          <div className="section-title">
            <h2 id="receipt-builder-heading">3. Check this receipt</h2>
            <span>{receiptLines.length} product lines · {receiptQuantity} units</span>
          </div>
          {receiptLines.length === 0 ? (
            <div className="draft-empty">Add every product shown on this supplier bill.</div>
          ) : (
            <div className="receipt-line-list">
              {receiptLines.map((line) => (
                <article className="receipt-line-card" key={line.product.id}>
                  <div>
                    <strong>{line.product.name}</strong>
                    <small>{line.product.sku} · {line.product.stock} currently</small>
                  </div>
                  <span className="condition-breakdown">
                    {line.sellableQuantity} sellable · {line.openBoxQuantity} open box · {line.damagedQuantity} damaged
                  </span>
                  <strong>
                    {formatMoney(
                      (line.sellableQuantity + line.openBoxQuantity + line.damagedQuantity)
                      * line.invoiceUnitCostPaise,
                    )}
                  </strong>
                  <div className="line-actions">
                    <button type="button" onClick={() => chooseProduct(line.product)}>Edit</button>
                    <button type="button" onClick={() => removeReceiptLine(line.product.id)}>Remove</button>
                  </div>
                </article>
              ))}
            </div>
          )}
          <div className="receipt-totals condition-totals">
            <span><small>Sellable</small><strong>{receiptSellableQuantity}</strong></span>
            <span><small>Open box</small><strong>{receiptOpenBoxQuantity}</strong></span>
            <span><small>Damaged</small><strong>{receiptDamagedQuantity}</strong></span>
            <span><small>Entered invoice value</small><strong>{formatMoney(receiptValuePaise)}</strong></span>
            <span className="stock-effect-total">
              <small>Stock effect now</small>
              <strong>
                {role === "BUSINESS_OWNER"
                  ? `+${receiptSellableQuantity} sellable`
                  : "0 (Draft)"}
              </strong>
            </span>
          </div>
          {duplicateWarning && (
            <div className="duplicate-warning" role="alert">
              <strong>Possible duplicate supplier bill</strong>
              <p>{duplicateWarning}</p>
              <label>
                <input
                  type="checkbox"
                  checked={duplicateAcknowledged}
                  onChange={(event) => setDuplicateAcknowledged(event.target.checked)}
                />
                I checked the earlier receipt and this entry is intentional.
              </label>
            </div>
          )}
          <button
            className="complete-button"
            type="button"
            disabled={
              submitting ||
              !supplierId ||
              receiptLines.length === 0 ||
              Boolean(duplicateWarning && !duplicateAcknowledged)
            }
            onClick={saveReceipt}
          >
            {submitting
              ? role === "BUSINESS_OWNER" ? "Completing safely…" : "Saving draft…"
              : role === "BUSINESS_OWNER"
                ? `Complete receipt · ${receiptQuantity} units`
                : "Save receipt draft for owner"}
          </button>
        </section>

        <section className="draft-receipts" aria-labelledby="draft-receipts-heading">
          <div className="section-title">
            <h2 id="draft-receipts-heading">
              {role === "BUSINESS_OWNER" ? "Receipts awaiting review" : "Your drafts awaiting owner"}
            </h2>
            <span>{drafts.length} waiting</span>
          </div>
          {drafts.length === 0 ? (
            <div className="draft-empty">
              {role === "BUSINESS_OWNER"
                ? "Trusted-operator drafts will appear here."
                : "Saved drafts remain here until an owner completes them."}
            </div>
          ) : (
            <div className="draft-receipt-list">
              {drafts.map((draft) => (
                <article className="draft-receipt-card" key={draft.receiptId}>
                  <div className="draft-receipt-heading">
                    <div>
                      <p className="eyebrow">{draft.receiptNumber}</p>
                      <h3>{draft.supplierName}</h3>
                      <p>{draft.lines.length} product lines · {draft.totalQuantity} total units</p>
                    </div>
                    <span className="pending-chip">Draft</span>
                  </div>
                  <div className="draft-line-list">
                    {draft.lines.map((line) => (
                      <div key={line.variantId}>
                        <span><strong>{line.productName}</strong><small>{line.sku}</small></span>
                        <span>
                          {line.sellableQuantity} sellable · {line.openBoxQuantity} open box · {line.damagedQuantity} damaged
                        </span>
                        {role === "BUSINESS_OWNER" && line.invoiceUnitCostPaise !== undefined && (
                          <strong>{formatMoney(line.invoiceUnitCostPaise)} each</strong>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="draft-receipt-facts">
                    <span><small>Bill reference</small><strong>{draft.supplierInvoiceReference ?? "Not entered"}</strong></span>
                    <span>
                      <small>Condition totals</small>
                      <strong>
                        {draft.totalSellableQuantity} sellable · {draft.totalOpenBoxQuantity} open box · {draft.totalDamagedQuantity} damaged
                      </strong>
                    </span>
                    {role === "BUSINESS_OWNER" && draft.totalInvoiceValuePaise !== undefined && (
                      <span><small>Entered invoice value</small><strong>{formatMoney(draft.totalInvoiceValuePaise)}</strong></span>
                    )}
                    <span><small>Prepared by</small><strong>{draft.createdByName}</strong></span>
                  </div>
                  {draft.note && <p className="draft-note">Note: {draft.note}</p>}
                  {role === "BUSINESS_OWNER" && (
                    <button
                      type="button"
                      className="complete-draft-button"
                      disabled={completingId === draft.receiptId}
                      onClick={() => completeDraft(draft)}
                    >
                      {completingId === draft.receiptId
                        ? "Completing all lines safely…"
                        : `Complete and add ${draft.totalQuantity} units`}
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
