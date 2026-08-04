"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import CreatableCombobox, {
  type CreatableOption,
} from "@/components/ui/CreatableCombobox";
import CustomSelect from "@/components/ui/CustomSelect";
import Modal from "@/components/ui/Modal";
import {
  normalizeSkuCode,
  priceFloorConflict,
  PRODUCT_UNITS,
  productPricingConflict,
  recommendedPriceFloors,
  suggestSkuCode,
  type ProductUnit,
} from "@/shared/product-setup-policy";

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
  wholesalePricePaise: number;
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

type ReceiveStep = "BILL" | "PRODUCTS" | "CONFIRM";

type LockedBill = {
  supplierId: string;
  supplierName: string;
  invoiceReference: string;
  note: string;
};

type NewProductForm = {
  productName: string;
  category: string;
  categoryCode: string;
  subcategory: string;
  subcategoryCode: string;
  brand: string;
  hasVariants: boolean;
  variants: Array<{ id: string; name: string; code: string }>;
  unitOfMeasure: ProductUnit;
  purchaseCostRupees: string;
  standardPriceRupees: string;
  wholesalePriceRupees: string;
  mrpRupees: string;
  ownerFloorRupees: string;
  trustedFloorRupees: string;
  storeFloorRupees: string;
};

type Props = {
  displayName: string;
  role: "BUSINESS_OWNER" | "TRUSTED_OPERATOR";
  initialProducts: Product[];
  initialDrafts: Draft[];
  initialSuppliers: Supplier[];
  initialMetadata: {
    categories: Array<{ name: string; code: string }>;
    subcategories: Array<{ name: string; code: string; category: string }>;
    brands: string[];
  };
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
    hasVariants: false,
    variants: [{ id: "variant-1", name: "", code: "" }],
    unitOfMeasure: "UNIT",
    purchaseCostRupees: "",
    standardPriceRupees: "",
    wholesalePriceRupees: "",
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
  initialMetadata,
}: Props) {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState(initialProducts);
  const [drafts, setDrafts] = useState(initialDrafts);
  const [suppliers, setSuppliers] = useState(initialSuppliers);
  const [metadata, setMetadata] = useState(initialMetadata);
  const [step, setStep] = useState<ReceiveStep>("BILL");
  const [supplierId, setSupplierId] = useState("");
  const [lockedBill, setLockedBill] = useState<LockedBill | null>(null);
  const [showCancelReceipt, setShowCancelReceipt] = useState(false);
  const [showNewSupplier, setShowNewSupplier] = useState(initialSuppliers.length === 0);
  const [showNewProduct, setShowNewProduct] = useState(false);
  const [showCloseProductDraft, setShowCloseProductDraft] = useState(false);
  const [showDrafts, setShowDrafts] = useState(false);
  const [newProduct, setNewProduct] = useState<NewProductForm>(emptyNewProduct);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierPhone, setNewSupplierPhone] = useState("");
  const [selected, setSelected] = useState<Product | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);
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
  const [mrpManuallyEdited, setMrpManuallyEdited] = useState(false);
  const [completingId, setCompletingId] = useState("");
  const completionCommands = useRef(new Map<string, string>());
  const productSearchSequence = useRef(0);
  const productSearchRef = useRef<HTMLFormElement>(null);
  const [commandId, setCommandId] = useState(() => crypto.randomUUID());
  const [productCommandId, setProductCommandId] = useState(
    () => crypto.randomUUID(),
  );

  function resetDuplicateCheck() {
    setDuplicateWarning("");
    setDuplicateAcknowledged(false);
  }

  function startReceipt(event?: FormEvent) {
    event?.preventDefault();
    const supplier = suppliers.find((item) => item.id === supplierId);
    if (!supplier) {
      setError("Select the supplier whose delivery you are receiving.");
      return;
    }
    setLockedBill({
      supplierId: supplier.id,
      supplierName: supplier.name,
      invoiceReference: invoiceReference.trim(),
      note: note.trim(),
    });
    setStep("PRODUCTS");
    setError("");
    setMessage("");
    resetDuplicateCheck();
  }

  function clearReceiptTransaction() {
    setStep("BILL");
    setLockedBill(null);
    setSupplierId("");
    setInvoiceReference("");
    setNote("");
    setReceiptLines([]);
    setSelected(null);
    setSellableQuantity(1);
    setOpenBoxQuantity(0);
    setDamagedQuantity(0);
    setUnitCostRupees("");
    setQuery("");
    setShowNewProduct(false);
    setShowNewSupplier(initialSuppliers.length === 0);
    setCommandId(crypto.randomUUID());
    setError("");
    setMessage("");
    resetDuplicateCheck();
  }

  function cancelReceipt() {
    clearReceiptTransaction();
    setShowCancelReceipt(false);
    setMessage("Receipt cancelled. No stock was changed.");
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
    setSearchOpen(false);
    setSearchActiveIndex(0);
    setMessage("");
    setError("");
  }

  async function loadProducts(searchQuery: string, selectSingle = false) {
    const requestNumber = ++productSearchSequence.current;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/catalog?q=${encodeURIComponent(searchQuery)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Products could not be loaded.");
      if (requestNumber !== productSearchSequence.current) return;
      setProducts(body.products);
      if (selectSingle && body.products.length === 1) chooseProduct(body.products[0]);
    } catch (reason) {
      if (requestNumber !== productSearchSequence.current) return;
      setError(reason instanceof Error ? reason.message : "Products could not be loaded.");
    } finally {
      if (requestNumber === productSearchSequence.current) setLoading(false);
    }
  }

  async function findProducts(event: FormEvent) {
    event.preventDefault();
    await loadProducts(query, true);
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadProducts(query);
    }, 180);

    return () => window.clearTimeout(timeoutId);
    // The product chooser intentionally follows the search text only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    if (!searchOpen) return;
    const close = (event: PointerEvent) => {
      if (!productSearchRef.current?.contains(event.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [searchOpen]);

  async function createNewSupplier(event?: FormEvent) {
    event?.preventDefault();
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

  function requestCloseNewProduct() {
    const blank = emptyNewProduct();
    if (JSON.stringify(newProduct) !== JSON.stringify(blank)) {
      setShowCloseProductDraft(true);
      return;
    }
    setShowNewProduct(false);
    setError("");
  }

  function chooseCategory(value: string, option?: CreatableOption) {
    setNewProduct((current) => {
      const changed = current.category !== value;
      const code = option?.detail ?? suggestSkuCode(
        value,
        metadata.categories.map((item) => item.code),
        3,
      );
      return {
        ...current,
        category: value,
        categoryCode: code,
        ...(changed
          ? { subcategory: "", subcategoryCode: "" }
          : {}),
      };
    });
  }

  function chooseSubcategory(value: string, option?: CreatableOption) {
    setNewProduct((current) => ({
      ...current,
      subcategory: value,
      subcategoryCode: option?.detail ?? suggestSkuCode(
        value,
        metadata.subcategories
          .filter((item) => item.category.toLocaleLowerCase("en-IN") === current.category.toLocaleLowerCase("en-IN"))
          .map((item) => item.code),
        3,
      ),
    }));
  }

  function setHasVariants(checked: boolean) {
    setNewProduct((current) => ({
      ...current,
      hasVariants: checked,
      variants: current.variants.length > 0
        ? current.variants
        : [{ id: crypto.randomUUID(), name: "", code: "" }],
    }));
  }

  function changeVariant(id: string, field: "name" | "code", value: string) {
    setNewProduct((current) => ({
      ...current,
      variants: current.variants.map((variant) => {
        if (variant.id !== id) return variant;
        if (field === "code") return { ...variant, code: normalizeSkuCode(value, 4) };
        const previousSuggestion = suggestSkuCode(variant.name, [], 4);
        return {
          ...variant,
          name: value,
          code: !variant.code || variant.code === previousSuggestion
            ? suggestSkuCode(value, [], 4)
            : variant.code,
        };
      }),
    }));
  }

  function addVariant() {
    setNewProduct((current) => ({
      ...current,
      variants: [
        ...current.variants,
        { id: crypto.randomUUID(), name: "", code: "" },
      ],
    }));
  }

  function removeVariant(id: string) {
    setNewProduct((current) => ({
      ...current,
      variants: current.variants.length === 1
        ? current.variants
        : current.variants.filter((variant) => variant.id !== id),
    }));
  }

  function changePurchaseCost(value: string) {
    setNewProduct((current) => {
      const amount = Number(value);
      return {
        ...current,
        purchaseCostRupees: value,
        ...(!mrpManuallyEdited
          ? { mrpRupees: Number.isFinite(amount) && amount > 0 ? String(Math.round(amount * 250) / 100) : "" }
          : {}),
      };
    });
  }

  async function createNewProduct(event: FormEvent) {
    event.preventDefault();
    const purchaseCostPaise = rupeesToPaise(newProduct.purchaseCostRupees);
    const standardPricePaise = rupeesToPaise(newProduct.standardPriceRupees);
    const wholesalePricePaise = rupeesToPaise(newProduct.wholesalePriceRupees);
    const mrpPaise = rupeesToPaise(newProduct.mrpRupees);
    const pricingConflict = productPricingConflict(
      purchaseCostPaise,
      standardPricePaise,
      mrpPaise,
      wholesalePricePaise,
    );
    if (pricingConflict) {
      setError(pricingConflict);
      return;
    }
    const activeVariants = newProduct.hasVariants
      ? newProduct.variants.map((variant) => ({
          name: variant.name.trim(),
          code: normalizeSkuCode(variant.code, 4),
        }))
      : [];
    if (
      newProduct.hasVariants &&
      (activeVariants.some((variant) => !variant.name || variant.code.length < 2) ||
        new Set(activeVariants.map((variant) => variant.code)).size !== activeVariants.length)
    ) {
      setError("Every variant needs a name and a unique 2–4 character code.");
      return;
    }
    const recommendedFloors = recommendedPriceFloors(
      purchaseCostPaise,
      wholesalePricePaise,
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
      wholesalePricePaise,
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
          ...(newProduct.hasVariants ? { variants: activeVariants } : {}),
          unitOfMeasure: newProduct.unitOfMeasure,
          packSize: 1,
          rackLocation: null,
          purchaseCostPaise,
          standardPricePaise,
          wholesalePricePaise,
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
      const createdMetadata = {
        category: newProduct.category.trim(),
        categoryCode: newProduct.categoryCode.trim(),
        subcategory: newProduct.subcategory.trim(),
        subcategoryCode: newProduct.subcategoryCode.trim(),
        brand: newProduct.brand.trim(),
      };
      const createdProducts: Product[] = body.products ?? [body.product];
      setProducts((current) => [
        ...createdProducts,
        ...current.filter((product) => !createdProducts.some((created) => created.id === product.id)),
      ]);
      setMetadata((current) => ({
        categories: current.categories.some(
          (item) => item.name.toLocaleLowerCase("en-IN") ===
            createdMetadata.category.toLocaleLowerCase("en-IN"),
        )
          ? current.categories
          : [
              ...current.categories,
              { name: createdMetadata.category, code: createdMetadata.categoryCode },
            ].sort((left, right) => left.name.localeCompare(right.name)),
        subcategories: current.subcategories.some(
          (item) =>
            item.category.toLocaleLowerCase("en-IN") ===
              createdMetadata.category.toLocaleLowerCase("en-IN") &&
            item.name.toLocaleLowerCase("en-IN") ===
              createdMetadata.subcategory.toLocaleLowerCase("en-IN"),
        )
          ? current.subcategories
          : [
              ...current.subcategories,
              {
                name: createdMetadata.subcategory,
                code: createdMetadata.subcategoryCode,
                category: createdMetadata.category,
              },
            ].sort((left, right) => left.name.localeCompare(right.name)),
        brands:
          !createdMetadata.brand ||
          current.brands.some(
            (brand) =>
              brand.toLocaleLowerCase("en-IN") ===
              createdMetadata.brand.toLocaleLowerCase("en-IN"),
          )
            ? current.brands
            : [...current.brands, createdMetadata.brand].sort((left, right) =>
                left.localeCompare(right),
              ),
      }));
      chooseProduct(body.product);
      setUnitCostRupees(newProduct.purchaseCostRupees);
      setNewProduct(emptyNewProduct());
      setMrpManuallyEdited(false);
      setProductCommandId(crypto.randomUUID());
      setShowNewProduct(false);
      setMessage(
        `${createdProducts.length === 1 ? body.product.sku : `${createdProducts.length} variants`} created. Add the delivered quantity to this receipt.`,
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
    if (!lockedBill || receiptLines.length === 0) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/v1/stock-receipts", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": commandId },
        body: JSON.stringify({
          supplierId: lockedBill.supplierId,
          supplierInvoiceReference: lockedBill.invoiceReference || undefined,
          note: lockedBill.note || undefined,
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
        const successMessage = `${body.draft.receiptNumber} saved with ${body.draft.lines.length} product lines · stock unchanged.`;
        clearReceiptTransaction();
        setMessage(successMessage);
      } else {
        applyCompletedLines(body.receipt.lines);
        const successMessage = `${body.receipt.receiptNumber} complete · ${body.receipt.totalReceivedQuantity} units across ${body.receipt.lines.length} products.`;
        clearReceiptTransaction();
        setMessage(successMessage);
      }
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
  const newWholesalePricePaise = rupeesToPaise(newProduct.wholesalePriceRupees);
  const newMrpPaise = rupeesToPaise(newProduct.mrpRupees);
  const newProductPricingConflict =
    newPurchaseCostPaise > 0 &&
    newStandardPricePaise > 0 &&
    newWholesalePricePaise > 0 &&
    newMrpPaise > 0
      ? productPricingConflict(
          newPurchaseCostPaise,
          newStandardPricePaise,
          newMrpPaise,
          newWholesalePricePaise,
        )
      : null;
  const newProductFloors =
    newPurchaseCostPaise > 0 && newWholesalePricePaise > 0
      ? recommendedPriceFloors(newPurchaseCostPaise, newWholesalePricePaise)
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
          newWholesalePricePaise,
          selectedNewProductFloors,
        )
      : null;
  const skuBasePreview = [
    "IMT",
    normalizeSkuCode(newProduct.categoryCode) || "CCC",
    normalizeSkuCode(newProduct.subcategoryCode) || "SS",
    "####",
  ].join("-");
  const variantCodes = newProduct.variants.map((variant) => normalizeSkuCode(variant.code, 4));
  const newProductVariantConflict = newProduct.hasVariants && (
    newProduct.variants.some((variant) => !variant.name.trim() || normalizeSkuCode(variant.code, 4).length < 2) ||
    new Set(variantCodes).size !== variantCodes.length
  );
  const categoryOptions: CreatableOption[] = metadata.categories.map((item) => ({
    value: item.name,
    label: item.name,
    detail: item.code,
  }));
  const subcategoryOptions: CreatableOption[] = metadata.subcategories
    .filter(
      (item) =>
        !newProduct.category ||
        item.category.toLocaleLowerCase("en-IN") ===
          newProduct.category.toLocaleLowerCase("en-IN"),
    )
    .map((item) => ({
      value: item.name,
      label: item.name,
      detail: item.code,
    }));
  const brandOptions: CreatableOption[] = metadata.brands.map((brand) => ({
    value: brand,
    label: brand,
  }));

  return (
    <AppShell displayName={displayName} role={role}>
      <section className="receive-v2" aria-labelledby="receive-heading">
        <header className="receive-v2__module-bar">
          <div>
            <p className="eyebrow">Incoming stock</p>
            <h1 id="receive-heading">
              {role === "BUSINESS_OWNER" ? "Receive stock" : "Prepare receipt"}
            </h1>
            <p>
              {role === "BUSINESS_OWNER"
                ? "Match one supplier bill, add its products, then post the stock once."
                : "Prepare the supplier bill for owner review; stock stays unchanged."}
            </p>
          </div>
          <div className="receive-v2__header-actions">
            {drafts.length > 0 && (
              <button type="button" onClick={() => setShowDrafts(true)}>
                Review drafts <span>{drafts.length}</span>
              </button>
            )}
            <strong>
              {step === "BILL"
                ? "Step 1 of 3"
                : step === "PRODUCTS"
                  ? `${receiptQuantity} units on receipt`
                  : "Ready for final check"}
            </strong>
            {lockedBill && (
              <button
                type="button"
                className="receive-v2__cancel-action"
                onClick={() => setShowCancelReceipt(true)}
              >
                Cancel receipt
              </button>
            )}
          </div>
        </header>

        {(error || message) && (
          <div className={`receive-v2__notice ${error ? "is-error" : "is-success"}`}>
            <p role={error ? "alert" : "status"}>{error || message}</p>
            <button
              type="button"
              aria-label="Dismiss message"
              onClick={() => {
                setError("");
                setMessage("");
              }}
            >
              ×
            </button>
          </div>
        )}

        <ol className="receive-steps" aria-label="Receiving progress">
          <li className={step === "BILL" ? "active" : "done"}>
            <span>1</span>
            <div><strong>Bill</strong><small>Supplier and bill details</small></div>
          </li>
          <li className={step === "PRODUCTS" ? "active" : step === "CONFIRM" ? "done" : ""}>
            <span>2</span>
            <div><strong>Products</strong><small>Quantity and bill cost</small></div>
          </li>
          <li className={step === "CONFIRM" ? "active" : ""}>
            <span>3</span>
            <div>
              <strong>{role === "BUSINESS_OWNER" ? "Confirm" : "Review"}</strong>
              <small>One final confirmation</small>
            </div>
          </li>
        </ol>

        {step === "BILL" && (
        <section className="receipt-header-card receive-v2__bill" aria-labelledby="supplier-bill-heading">
          <div className="section-title">
            <div>
              <h2 id="supplier-bill-heading">Supplier bill</h2>
              <p>One receipt should match one supplier delivery.</p>
            </div>
            <button
              type="button"
              className="text-button"
              onClick={() => setShowNewSupplier((current) => !current)}
            >
              {showNewSupplier ? "Cancel" : "Add supplier"}
            </button>
          </div>
          <div className="receive-bill-fields">
            <label>
              Supplier
              <CustomSelect
                value={supplierId}
                ariaLabel="Supplier"
                options={[
                  { value: "", label: "Select supplier" },
                  ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name })),
                ]}
                onChange={(value) => {
                  setSupplierId(value);
                  resetDuplicateCheck();
                }}
                required
              />
            </label>
            <label>
              Bill number
              <input
                value={invoiceReference}
                onChange={(event) => {
                  setInvoiceReference(event.target.value);
                  resetDuplicateCheck();
                }}
                maxLength={120}
                placeholder="Recommended for duplicate checks"
              />
            </label>
            <label>
              Note or discrepancy
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={500}
                placeholder="Optional"
              />
            </label>
          </div>
          {showNewSupplier && (
            <form className="new-supplier-form" onSubmit={createNewSupplier}>
              <label>Supplier name<input value={newSupplierName} onChange={(event) => setNewSupplierName(event.target.value)} maxLength={120} required /></label>
              <label>Phone, optional<input value={newSupplierPhone} onChange={(event) => setNewSupplierPhone(event.target.value)} inputMode="tel" maxLength={18} /></label>
              <button type="submit" disabled={creatingSupplier || newSupplierName.trim().length < 1}>
                {creatingSupplier ? "Adding…" : "Add and select supplier"}
              </button>
            </form>
          )}
          <div className="receive-v2__bill-footer">
            <p>
              The supplier and bill are locked after this step. Nothing changes stock yet.
            </p>
            <button type="button" className="complete-button" disabled={!supplierId} onClick={() => startReceipt()}>
              Continue to products
            </button>
          </div>
        </section>
        )}

        {lockedBill && step !== "BILL" && (
          <section className="receive-v2__locked-context" aria-label="Locked receipt details">
            <div>
              <span>Supplier</span>
              <strong>{lockedBill.supplierName}</strong>
            </div>
            <div>
              <span>Bill number</span>
              <strong>{lockedBill.invoiceReference || "Not entered"}</strong>
            </div>
            {lockedBill.note && (
              <div className="receive-v2__locked-note">
                <span>Receipt note</span>
                <strong>{lockedBill.note}</strong>
              </div>
            )}
            <p>Locked for this receipt</p>
          </section>
        )}

        {step === "PRODUCTS" && (
          <div className="receive-v2__product-step">
            <section className="receive-v2__product-entry" aria-labelledby="product-entry-heading">
              <header className="receive-v2__product-entry-heading">
                <div>
                  <h2 id="product-entry-heading">Add delivered products</h2>
                  <p>Search, enter the delivered quantities and save each receipt line.</p>
                </div>
                {role === "BUSINESS_OWNER" && (
                  <button
                    type="button"
                    onClick={() => {
                      setNewProduct((current) => ({
                        ...current,
                        productName: current.productName || query.trim(),
                      }));
                      setShowNewProduct(true);
                      setSearchOpen(false);
                      setError("");
                    }}
                  >
                    + Create new product
                  </button>
                )}
              </header>

              <form
                className="receive-v2__product-search"
                onSubmit={findProducts}
                ref={productSearchRef}
              >
                <label htmlFor="product-search">Search catalogue</label>
                <div className="receive-v2__product-search-control">
                  <input
                    id="product-search"
                    value={query}
                    placeholder="SKU, barcode or product name"
                    autoComplete="off"
                    role="combobox"
                    aria-expanded={searchOpen && query.trim().length > 0}
                    aria-controls="receive-product-results"
                    aria-autocomplete="list"
                    onFocus={() => {
                      if (query.trim()) setSearchOpen(true);
                    }}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setSearchOpen(Boolean(event.target.value.trim()));
                      setSearchActiveIndex(0);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setSearchOpen(true);
                        setSearchActiveIndex((current) =>
                          Math.min(current + 1, Math.max(0, products.length - 1)),
                        );
                      } else if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setSearchActiveIndex((current) => Math.max(0, current - 1));
                      } else if (
                        event.key === "Enter" &&
                        searchOpen &&
                        products[searchActiveIndex]
                      ) {
                        event.preventDefault();
                        chooseProduct(products[searchActiveIndex]);
                      } else if (event.key === "Escape") {
                        setSearchOpen(false);
                      }
                    }}
                  />
                  <span aria-live="polite">
                    {loading ? "Searching…" : query.trim() ? `${products.length} found` : "Type to search"}
                  </span>
                </div>
                {searchOpen && query.trim() && (
                  <div
                    className="receive-v2__product-results"
                    id="receive-product-results"
                    role="listbox"
                  >
                    {loading ? (
                      <p>Searching catalogue…</p>
                    ) : products.length === 0 ? (
                      <div className="receive-v2__product-no-result">
                        <div>
                          <strong>No matching product</strong>
                          <span>Try another SKU, barcode or product name.</span>
                        </div>
                        {role === "BUSINESS_OWNER" && (
                          <button
                            type="button"
                            onClick={() => {
                              setNewProduct((current) => ({
                                ...current,
                                productName: current.productName || query.trim(),
                              }));
                              setShowNewProduct(true);
                              setSearchOpen(false);
                            }}
                          >
                            Create product
                          </button>
                        )}
                      </div>
                    ) : (
                      products.map((product, index) => {
                        const onReceipt = receiptLines.find(
                          (line) => line.product.id === product.id,
                        );
                        return (
                          <button
                            type="button"
                            role="option"
                            aria-selected={index === searchActiveIndex}
                            className={index === searchActiveIndex ? "is-active" : ""}
                            key={product.id}
                            onPointerMove={() => setSearchActiveIndex(index)}
                            onClick={() => chooseProduct(product)}
                          >
                            <span>
                              <strong>{product.name}</strong>
                              <small>{product.sku}</small>
                            </span>
                            <span>{product.stock} sellable</span>
                            {onReceipt && (
                              <em>
                                {onReceipt.sellableQuantity +
                                  onReceipt.openBoxQuantity +
                                  onReceipt.damagedQuantity}{" "}
                                on receipt
                              </em>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </form>

              {!selected ? (
                <div className="receive-v2__product-empty">
                  <span aria-hidden="true">↑</span>
                  <strong>Search and select a delivered product</strong>
                  <p>Only the selected product will open for quantity and bill-cost entry.</p>
                </div>
              ) : (
                <form className="receive-v2__line-editor" onSubmit={addReceiptLine}>
                  <header>
                    <div>
                      <span>Receipt line</span>
                      <h2>{selected.name}</h2>
                      <p>{selected.sku} · {selected.rackLocation ?? "Rack not set"}</p>
                    </div>
                    <div className="receive-v2__line-stock">
                      <strong>{selected.stock}</strong>
                      <span>currently sellable</span>
                    </div>
                  </header>
                  <div className="condition-quantity-grid">
                    <label>
                      Sellable
                      <input type="number" min="0" max="5000" value={sellableQuantity} onChange={(event) => setSellableQuantity(Number(event.target.value))} required />
                    </label>
                    <label>
                      Open box
                      <input type="number" min="0" max="5000" value={openBoxQuantity} onChange={(event) => setOpenBoxQuantity(Number(event.target.value))} required />
                    </label>
                    <label>
                      Damaged
                      <input type="number" min="0" max="5000" value={damagedQuantity} onChange={(event) => setDamagedQuantity(Number(event.target.value))} required />
                    </label>
                  </div>
                  <label className="unit-cost-field">
                    Purchase cost per unit on this bill (₹)
                    <input type="number" min="0.01" max="1000000" step="0.01" value={unitCostRupees} onChange={(event) => setUnitCostRupees(event.target.value)} required />
                  </label>
                  <p className="condition-guidance">
                    Open-box and damaged units remain outside normal sellable stock.
                  </p>
                  <div className="receive-v2__line-actions">
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(null);
                        setSellableQuantity(1);
                        setOpenBoxQuantity(0);
                        setDamagedQuantity(0);
                        setUnitCostRupees("");
                      }}
                    >
                      Close
                    </button>
                    <button
                      className="complete-button"
                      type="submit"
                      disabled={
                        sellableQuantity + openBoxQuantity + damagedQuantity < 1 ||
                        invoiceUnitCostPaise < 1
                      }
                    >
                      {receiptLines.some((line) => line.product.id === selected.id)
                        ? "Save line changes"
                        : "Add product to receipt"}
                    </button>
                  </div>
                </form>
              )}
            </section>

            <aside className="receive-v2__receipt-lines" aria-labelledby="receipt-lines-heading">
              <header>
                <div>
                  <h2 id="receipt-lines-heading">Products on this receipt</h2>
                  <p>Edit any line before the final check.</p>
                </div>
                <span>{receiptLines.length} products · {receiptQuantity} units</span>
              </header>
              {receiptLines.length === 0 ? (
                <div className="receive-v2__receipt-empty">No products added yet.</div>
              ) : (
                <div className="receive-v2__receipt-list">
                  {receiptLines.map((line) => {
                    const lineQuantity =
                      line.sellableQuantity + line.openBoxQuantity + line.damagedQuantity;
                    return (
                      <article key={line.product.id}>
                        <div>
                          <strong>{line.product.name}</strong>
                          <small>{line.product.sku}</small>
                        </div>
                        <span>
                          {lineQuantity} units · {formatMoney(line.invoiceUnitCostPaise)} each
                        </span>
                        <strong>{formatMoney(lineQuantity * line.invoiceUnitCostPaise)}</strong>
                        <div>
                          <button type="button" onClick={() => chooseProduct(line.product)}>Edit</button>
                          <button type="button" onClick={() => removeReceiptLine(line.product.id)}>Remove</button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
              <footer>
                <div>
                  <span>{receiptLines.length} products · {receiptQuantity} units</span>
                  <strong>{formatMoney(receiptValuePaise)}</strong>
                </div>
                <button
                  className="complete-button"
                  type="button"
                  disabled={receiptLines.length === 0}
                  onClick={() => {
                    setSelected(null);
                    setStep("CONFIRM");
                    setError("");
                    setMessage("");
                  }}
                >
                  Review receipt
                </button>
              </footer>
            </aside>
          </div>
        )}

        {step === "CONFIRM" && lockedBill && (
          <section className="receive-v2__confirm" aria-labelledby="confirm-receipt-heading">
            <header className="receive-v2__confirm-header">
              <div>
                <p className="eyebrow">Final check</p>
                <h2 id="confirm-receipt-heading">Confirm this stock receipt</h2>
                <p>
                  Check every quantity and bill cost. Stock changes only after the final button.
                </p>
              </div>
              <button type="button" onClick={() => setStep("PRODUCTS")}>
                Back to products
              </button>
            </header>

            <div className="receive-v2__confirm-body">
              <div className="receive-v2__confirm-lines">
                {receiptLines.map((line) => {
                  const lineQuantity = line.sellableQuantity + line.openBoxQuantity + line.damagedQuantity;
                  return (
                    <article key={line.product.id}>
                      <div>
                        <strong>{line.product.name}</strong>
                        <small>{line.product.sku}</small>
                      </div>
                      <span>
                        {line.sellableQuantity} sellable · {line.openBoxQuantity} open box · {line.damagedQuantity} damaged
                      </span>
                      <span>
                        {lineQuantity} × {formatMoney(line.invoiceUnitCostPaise)}
                      </span>
                      <strong>{formatMoney(lineQuantity * line.invoiceUnitCostPaise)}</strong>
                    </article>
                  );
                })}
              </div>

              <aside className="receive-v2__confirm-summary">
                <div>
                  <span>Supplier</span>
                  <strong>{lockedBill.supplierName}</strong>
                </div>
                <div>
                  <span>Bill number</span>
                  <strong>{lockedBill.invoiceReference || "Not entered"}</strong>
                </div>
                <div className="receive-v2__condition-summary">
                  <span><small>Sellable</small><strong>{receiptSellableQuantity}</strong></span>
                  <span><small>Open box</small><strong>{receiptOpenBoxQuantity}</strong></span>
                  <span><small>Damaged</small><strong>{receiptDamagedQuantity}</strong></span>
                </div>
                <div className="receive-v2__confirm-total">
                  <span>{receiptLines.length} products · {receiptQuantity} units</span>
                  <strong>{formatMoney(receiptValuePaise)}</strong>
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

                <div className="receive-v2__atomic-note">
                  <strong>One safe transaction</strong>
                  <span>
                    If completion fails, none of these stock quantities are applied. You can try again without a partial receipt.
                  </span>
                </div>

                <button
                  className="complete-button"
                  type="button"
                  disabled={
                    submitting ||
                    receiptLines.length === 0 ||
                    Boolean(duplicateWarning && !duplicateAcknowledged)
                  }
                  onClick={saveReceipt}
                >
                  {submitting
                    ? role === "BUSINESS_OWNER" ? "Posting receipt…" : "Saving receipt…"
                    : role === "BUSINESS_OWNER"
                      ? `Confirm and add ${receiptQuantity} units`
                      : "Send receipt for owner review"}
                </button>
              </aside>
            </div>
          </section>
        )}

        <Modal
          open={showNewProduct}
          title="Create a new product"
          description="Save its catalogue details once, then add the delivered quantity to this receipt."
          onClose={requestCloseNewProduct}
          panelClassName="receive-v2__new-product-modal"
          footer={(
            <div className="receive-v2__new-product-actions">
              <button
                type="button"
                onClick={requestCloseNewProduct}
              >
                Close
              </button>
              <button
                className="complete-button"
                type="submit"
                form="receive-new-product-form"
                disabled={
                  creatingProduct ||
                  Boolean(
                    newProductPricingConflict ||
                    newProductFloorConflict ||
                    newProductVariantConflict
                  )
                }
              >
                {creatingProduct ? "Creating product…" : "Create product and continue"}
              </button>
            </div>
          )}
        >
          <form
            id="receive-new-product-form"
            className="receive-v2__new-product-form"
            onSubmit={createNewProduct}
          >
            <section className="receive-v2__new-product-section">
              <header><div><h3>Product details</h3><p>Codes are assigned automatically from your catalogue choices.</p></div></header>
              <div className="receive-v2__new-product-grid is-core">
                <label>Product name<input value={newProduct.productName} onChange={(event) => changeNewProduct("productName", event.target.value)} maxLength={160} autoFocus required /></label>
                <label><span className="receive-v2__field-label">Brand <em>Optional</em></span><CreatableCombobox value={newProduct.brand} options={brandOptions} onChange={(value) => changeNewProduct("brand", value)} ariaLabel="Brand" placeholder="Choose or create brand" /></label>
                <label>Category<CreatableCombobox value={newProduct.category} options={categoryOptions} onChange={chooseCategory} ariaLabel="Category" placeholder="Choose or create category" /></label>
                <label>Sub-category<CreatableCombobox value={newProduct.subcategory} options={subcategoryOptions} onChange={chooseSubcategory} ariaLabel="Sub-category" placeholder="Choose or create sub-category" /></label>
              </div>
              <div className="receive-v2__sku-preview"><span>SKU preview</span><strong>{skuBasePreview}</strong></div>
            </section>

            <section className="receive-v2__new-product-section">
              <header className="receive-v2__variant-heading">
                <div><h3>Variants</h3><p>Create one catalogue product with separate SKUs for colours, sizes or models.</p></div>
                <label className="receive-v2__variant-toggle"><input type="checkbox" checked={newProduct.hasVariants} onChange={(event) => setHasVariants(event.target.checked)} /><span>Contains variants</span></label>
              </header>
              {newProduct.hasVariants && (
                <div className="receive-v2__variant-table">
                  <div className="receive-v2__variant-labels"><span>Variant name</span><span>Code</span><span>SKU preview</span><span /></div>
                  {newProduct.variants.map((variant) => (
                    <div className="receive-v2__variant-row" key={variant.id}>
                      <input aria-label="Variant name" value={variant.name} placeholder="Example: Red" onChange={(event) => changeVariant(variant.id, "name", event.target.value)} required />
                      <input aria-label="Variant code" className="is-code" value={variant.code} placeholder="RED" maxLength={4} onChange={(event) => changeVariant(variant.id, "code", event.target.value)} required />
                      <code>{skuBasePreview}-{normalizeSkuCode(variant.code, 4) || "CODE"}</code>
                      <button type="button" aria-label="Remove variant" disabled={newProduct.variants.length === 1} onClick={() => removeVariant(variant.id)}>×</button>
                    </div>
                  ))}
                  <button className="receive-v2__add-variant" type="button" onClick={addVariant}>＋ Add variant row</button>
                  {newProductVariantConflict && <p className="receive-v2__new-product-error" role="alert">Every variant needs a name and a unique 2–4 character code.</p>}
                </div>
              )}
            </section>

            <section className="receive-v2__new-product-section">
              <header><div><h3>Pricing details</h3><p>MRP starts at 2.5× purchase cost. You can overwrite it.</p></div></header>
              <div className="receive-v2__new-product-grid is-pricing">
                <label>Unit type<CustomSelect value={newProduct.unitOfMeasure} ariaLabel="Unit type" options={PRODUCT_UNITS.map((unit) => ({ value: unit, label: unit === "UNIT" ? "Individual unit" : unit.toLocaleLowerCase("en-IN").replace(/^./, (letter) => letter.toUpperCase()) }))} onChange={(value) => changeNewProduct("unitOfMeasure", value as ProductUnit)} required /></label>
                <label>
                  Purchase cost (₹)
                  <input
                    type="number"
                    min="0.01"
                    max="1000000"
                    step="0.01"
                    value={newProduct.purchaseCostRupees}
                    onChange={(event) => changePurchaseCost(event.target.value)}
                    required
                  />
                </label>
                <label>
                  Retail selling price (₹)
                  <input
                    type="number"
                    min="0.01"
                    max="1000000"
                    step="0.01"
                    value={newProduct.standardPriceRupees}
                    onChange={(event) =>
                      changeNewProduct("standardPriceRupees", event.target.value)
                    }
                    required
                  />
                </label>
                <label>
                  Wholesale price (₹)
                  <input
                    type="number"
                    min="0.01"
                    max="1000000"
                    step="0.01"
                    value={newProduct.wholesalePriceRupees}
                    onChange={(event) =>
                      changeNewProduct("wholesalePriceRupees", event.target.value)
                    }
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
                    onChange={(event) => { setMrpManuallyEdited(true); changeNewProduct("mrpRupees", event.target.value); }}
                    required
                  />
                </label>
              </div>
              {(newProductPricingConflict || newProductFloorConflict || error) && (
                <p className="receive-v2__new-product-error" role="alert">
                  {newProductPricingConflict || newProductFloorConflict || error}
                </p>
              )}
            </section>
          </form>
        </Modal>

        <Modal
          open={showCloseProductDraft}
          title="Close this form?"
          description="Your entered product details will stay saved here and will be restored when you reopen the form."
          onClose={() => setShowCloseProductDraft(false)}
          panelClassName="receive-v2__cancel-modal"
        >
          <div className="receive-v2__cancel-modal-actions">
            <button type="button" onClick={() => setShowCloseProductDraft(false)}>Keep editing</button>
            <button type="button" onClick={() => { setShowCloseProductDraft(false); setShowNewProduct(false); setError(""); }}>Close and keep draft</button>
          </div>
        </Modal>

        <Modal
          open={showCancelReceipt}
          title="Cancel this receipt?"
          description="The supplier, bill and every added product will be removed from this unfinished receipt. Recorded stock will not change."
          onClose={() => setShowCancelReceipt(false)}
          panelClassName="receive-v2__cancel-modal"
        >
          <div className="receive-v2__cancel-modal-actions">
            <button type="button" onClick={() => setShowCancelReceipt(false)}>
              Keep working
            </button>
            <button type="button" className="is-danger" onClick={cancelReceipt}>
              Cancel receipt and start over
            </button>
          </div>
        </Modal>

        <Modal
          open={showDrafts}
          title={role === "BUSINESS_OWNER" ? "Receipts awaiting review" : "Drafts awaiting owner"}
          description="Open supplier receipts that have not changed stock yet."
          onClose={() => setShowDrafts(false)}
          panelClassName="receive-v2__draft-modal"
        >
          <section className="draft-receipts" aria-labelledby="draft-receipts-heading">
          <div className="section-title">
            <h2 id="draft-receipts-heading">
              {role === "BUSINESS_OWNER" ? "Receipts awaiting review" : "Your drafts awaiting owner"}
            </h2>
            <span>{drafts.length} waiting</span>
          </div>
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
          </section>
        </Modal>
      </section>
    </AppShell>
  );
}
