export const WORKBOOK_SHEETS = [
  "Inventory Master",
  "Sales Log",
  "Customers",
] as const;

export type WorkbookSheet = (typeof WORKBOOK_SHEETS)[number];
export type ImportEntityType = "PRODUCT" | "SALE_LINE" | "CUSTOMER";
export type ImportSeverity = "ERROR" | "WARNING";

export type ImportIssue = {
  field: string;
  code: string;
  severity: ImportSeverity;
  message: string;
  originalValue?: string;
};

export type StagedImportRow = {
  sheet: WorkbookSheet;
  row: number;
  entityType: ImportEntityType;
  sourceIdentifier: string | null;
  status: "ACCEPTED" | "QUARANTINED";
  raw: Record<string, string>;
  normalized: Record<string, string | number | null>;
  issues: ImportIssue[];
};

export type WorkbookReconciliation = {
  source: {
    products: number;
    saleLines: number;
    customers: number;
  };
  accepted: {
    products: number;
    saleLines: number;
    customers: number;
  };
  quarantined: number;
  warnings: number;
  sales: {
    sourceUnits: number;
    sourceRevenuePaise: number;
    acceptedUnits: number;
    acceptedRevenuePaise: number;
  };
};

export type WorkbookValidation = {
  rows: StagedImportRow[];
  reconciliation: WorkbookReconciliation;
};

export class InvalidWorkbookExportError extends Error {
  readonly status = 400;
  readonly code = "INVALID_WORKBOOK_EXPORT";

  constructor(message: string) {
    super(message);
    this.name = "InvalidWorkbookExportError";
  }
}

const headers = {
  "Inventory Master": [
    "SKU",
    "Item Name",
    "Category",
    "Sub-category",
    "Entry Type",
    "Brand",
    "PP (₹)",
    "SP (₹)",
    "MRP (₹)",
    "Opening Qty",
    "Purchased Qty",
    "Sold Qty",
    "On Hand Qty",
    "Sales Value (Actual ₹)",
    "Last Sold Date",
    "Notes",
  ],
  "Sales Log": [
    "Date",
    "Sale ID",
    "Customer Name",
    "Contact Number",
    "SKU",
    "Item Name",
    "Qty Sold",
    "MRP (₹)",
    "PP (₹)",
    "Standard S.Price (₹)",
    "Actual S.Price (₹)",
    "Gross Sales (₹)",
    "Customer Discount (₹)",
    "Actual Discount (₹)",
    "Actual Discount %age",
    "Profit (₹)",
    "Payment Mode",
    "Channel",
    "Notes",
  ],
  Customers: [
    "Customer ID",
    "Customer Name",
    "Phone Number",
    "WhatsApp Number",
    "Email",
    "Child Name",
    "Child Birthday",
    "Child Age",
    "Address",
    "Area / Locality",
    "Source",
    "First Visit Date",
    "Last Purchase Date",
    "Purchase Lines",
    "Total Spend (₹)",
    "Notes",
    "Status",
  ],
} satisfies Record<WorkbookSheet, string[]>;

function clean(value: string | undefined): string {
  return (value ?? "").trim();
}

export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        value += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  if (quoted) {
    throw new InvalidWorkbookExportError("A CSV file has an unclosed quoted value.");
  }
  if (value || row.length) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function tableFromCsv(sheet: WorkbookSheet, csv: string) {
  const rows = parseCsv(csv);
  const expected = headers[sheet];
  const headerIndex = rows.slice(0, 10).findIndex((candidate) => {
    const values = new Set(candidate.map(clean));
    return expected.every((header) => values.has(header));
  });
  if (headerIndex < 0) {
    throw new InvalidWorkbookExportError(
      `${sheet}.csv does not contain the expected ${sheet} header row.`,
    );
  }
  const positions = new Map<string, number>();
  rows[headerIndex].forEach((header, index) => {
    const name = clean(header);
    if (name && !positions.has(name)) positions.set(name, index);
  });
  return rows.slice(headerIndex + 1).map((values, offset) => ({
    sourceRow: headerIndex + offset + 2,
    data: Object.fromEntries(
      expected.map((header) => [header, clean(values[positions.get(header)!])]),
    ),
  }));
}

function moneyToPaise(value: string): number | null {
  const stripped = clean(value)
    .replace(/[₹,\s]/g, "")
    .replace(/^\((.*)\)$/, "-$1");
  if (!stripped || !/^-?\d+(?:\.\d{1,2})?$/.test(stripped)) return null;
  const negative = stripped.startsWith("-");
  const [rupees, decimals = ""] = stripped.replace(/^-/, "").split(".");
  const paise = Number(rupees) * 100 + Number(decimals.padEnd(2, "0"));
  return negative ? -paise : paise;
}

function integer(value: string, blankValue: number | null = null): number | null {
  const parsed = clean(value);
  if (!parsed) return blankValue;
  return /^-?\d+$/.test(parsed) ? Number(parsed) : null;
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

function normalizedDate(value: string): string | null {
  const source = clean(value);
  if (!source) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(source)) {
    const date = new Date(`${source}T00:00:00Z`);
    return Number.isNaN(date.valueOf()) ? null : source;
  }
  const match = source.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    const date = new Date(`${iso}T00:00:00Z`);
    return !Number.isNaN(date.valueOf())
        && date.getUTCDate() === Number(day)
        && date.getUTCMonth() + 1 === Number(month)
      ? iso
      : null;
  }
  const date = new Date(source);
  return Number.isNaN(date.valueOf())
    ? null
    : date.toISOString().slice(0, 10);
}

function issue(
  issues: ImportIssue[],
  field: string,
  code: string,
  severity: ImportSeverity,
  message: string,
  originalValue?: string,
) {
  issues.push({
    field,
    code,
    severity,
    message,
    ...(originalValue ? { originalValue: originalValue.slice(0, 500) } : {}),
  });
}

function finish(
  row: Omit<StagedImportRow, "status">,
): StagedImportRow {
  return {
    ...row,
    status: row.issues.some((item) => item.severity === "ERROR")
      ? "QUARANTINED"
      : "ACCEPTED",
  };
}

function validateProducts(csv: string): StagedImportRow[] {
  const rows = tableFromCsv("Inventory Master", csv)
    .filter(({ data }) => data.SKU || data["Item Name"]);

  return rows.map(({ sourceRow, data }) => {
    const issues: ImportIssue[] = [];
    const sku = data.SKU.toUpperCase();
    const purchaseCostPaise = moneyToPaise(data["PP (₹)"]);
    const standardPricePaise = moneyToPaise(data["SP (₹)"]);
    const mrpPaise = moneyToPaise(data["MRP (₹)"]);
    const openingQuantity = integer(data["Opening Qty"], 0);
    const purchasedQuantity = integer(data["Purchased Qty"], 0);
    const soldQuantity = integer(data["Sold Qty"], 0);
    const onHandQuantity = integer(data["On Hand Qty"]);

    if (!/^IMT-[A-Z0-9]{2,12}-[A-Z0-9]{2,12}-\d{4}(?:-[A-Z0-9]{1,12})?$/.test(sku)) {
      issue(issues, "SKU", "INVALID_SKU", "ERROR",
        "Use the approved IMT category, sub-category and four-digit sequence format.",
        data.SKU);
    }
    for (const field of ["Item Name", "Category", "Sub-category", "Entry Type"]) {
      if (!data[field]) {
        issue(issues, field, "MISSING_REQUIRED_VALUE", "ERROR",
          `${field} is required for a product.`);
      }
    }
    for (const [field, amount] of [
      ["PP (₹)", purchaseCostPaise],
      ["SP (₹)", standardPricePaise],
      ["MRP (₹)", mrpPaise],
    ] as const) {
      if (amount === null || amount <= 0) {
        issue(issues, field, "INVALID_MONEY", "ERROR",
          `${field} must be a positive amount.`, data[field]);
      }
    }
    if (
      standardPricePaise !== null
      && mrpPaise !== null
      && mrpPaise < standardPricePaise
    ) {
      issue(issues, "MRP (₹)", "MRP_BELOW_STANDARD_PRICE", "ERROR",
        "MRP cannot be lower than the standard selling price.", data["MRP (₹)"]);
    }
    if (
      purchaseCostPaise !== null
      && standardPricePaise !== null
      && standardPricePaise < purchaseCostPaise
    ) {
      issue(issues, "SP (₹)", "STANDARD_PRICE_BELOW_COST", "WARNING",
        "Standard selling price is below purchase cost.", data["SP (₹)"]);
    }
    for (const [field, quantity] of [
      ["Opening Qty", openingQuantity],
      ["Purchased Qty", purchasedQuantity],
      ["Sold Qty", soldQuantity],
      ["On Hand Qty", onHandQuantity],
    ] as const) {
      if (quantity === null || quantity < 0) {
        issue(issues, field, "INVALID_QUANTITY", "ERROR",
          `${field} must be a whole number of zero or more.`, data[field]);
      }
    }
    if (
      openingQuantity !== null
      && purchasedQuantity !== null
      && soldQuantity !== null
      && onHandQuantity !== null
      && openingQuantity + purchasedQuantity - soldQuantity !== onHandQuantity
    ) {
      issue(issues, "On Hand Qty", "STOCK_FORMULA_MISMATCH", "ERROR",
        "On-hand stock does not equal opening plus purchased minus sold.",
        data["On Hand Qty"]);
    }

    return finish({
      sheet: "Inventory Master",
      row: sourceRow,
      entityType: "PRODUCT",
      sourceIdentifier: sku || null,
      raw: data,
      normalized: {
        sku,
        name: data["Item Name"],
        category: data.Category,
        subcategory: data["Sub-category"],
        entryType: data["Entry Type"],
        brand: data.Brand || null,
        purchaseCostPaise,
        standardPricePaise,
        mrpPaise,
        openingQuantity,
        purchasedQuantity,
        soldQuantity,
        onHandQuantity,
        notes: data.Notes || null,
      },
      issues,
    });
  });
}

function validateSales(
  csv: string,
  productSkus: Set<string>,
): StagedImportRow[] {
  const rows = tableFromCsv("Sales Log", csv).filter(({ data }) =>
    data.Date
    || data.SKU
    || data["Qty Sold"]
    || data["Actual S.Price (₹)"]
    || data["Gross Sales (₹)"]
  );

  return rows.map(({ sourceRow, data }) => {
    const issues: ImportIssue[] = [];
    const saleDate = normalizedDate(data.Date);
    const saleId = data["Sale ID"];
    const sku = data.SKU.toUpperCase();
    const quantity = integer(data["Qty Sold"]);
    const purchaseCostPaise = moneyToPaise(data["PP (₹)"]);
    const standardPricePaise = moneyToPaise(data["Standard S.Price (₹)"]);
    const mrpPaise = moneyToPaise(data["MRP (₹)"]);
    const unitPricePaise = moneyToPaise(data["Actual S.Price (₹)"]);
    const grossSalesPaise = moneyToPaise(data["Gross Sales (₹)"]);
    const phone = normalizePhone(data["Contact Number"]);

    if (!saleDate) {
      issue(issues, "Date", "INVALID_DATE", "ERROR",
        "Enter an unambiguous sale date.", data.Date);
    }
    if (!saleId) {
      issue(issues, "Sale ID", "MISSING_SALE_ID", "ERROR",
        "Every historical sale line needs its source Sale ID.");
    }
    if (!sku || !productSkus.has(sku)) {
      issue(issues, "SKU", "MISSING_PRODUCT_SKU", "ERROR",
        "The sale SKU is missing from this Inventory Master snapshot.", data.SKU);
    }
    if (quantity === null || quantity < 1) {
      issue(issues, "Qty Sold", "INVALID_SALE_QUANTITY", "ERROR",
        "Sold quantity must be a whole number greater than zero.", data["Qty Sold"]);
    }
    if (unitPricePaise === null || unitPricePaise <= 0) {
      issue(issues, "Actual S.Price (₹)", "ZERO_OR_INVALID_SALE_PRICE", "ERROR",
        "Zero-price or invalid-price sales require owner review.",
        data["Actual S.Price (₹)"]);
    }
    if (
      quantity !== null
      && unitPricePaise !== null
      && grossSalesPaise !== quantity * unitPricePaise
    ) {
      issue(issues, "Gross Sales (₹)", "SALE_TOTAL_MISMATCH", "ERROR",
        "Gross sales must equal quantity multiplied by unit actual selling price.",
        data["Gross Sales (₹)"]);
    }
    if (
      purchaseCostPaise !== null
      && unitPricePaise !== null
      && unitPricePaise < purchaseCostPaise
    ) {
      issue(issues, "Actual S.Price (₹)", "SALE_BELOW_CURRENT_COST", "WARNING",
        "Actual selling price is below the workbook’s current purchase cost.",
        data["Actual S.Price (₹)"]);
    }
    if (!data["Payment Mode"]) {
      issue(issues, "Payment Mode", "MISSING_PAYMENT_MODE", "WARNING",
        "Payment mode is missing and must be resolved before import.");
    }
    if (!data.Channel) {
      issue(issues, "Channel", "MISSING_SALES_CHANNEL", "WARNING",
        "Sales channel is missing and must be resolved before import.");
    }
    if (phone && !/^\d{10,15}$/.test(phone)) {
      issue(issues, "Contact Number", "INVALID_CUSTOMER_PHONE", "WARNING",
        "The sale contact number is not a valid 10–15 digit phone number.",
        data["Contact Number"]);
    }

    return finish({
      sheet: "Sales Log",
      row: sourceRow,
      entityType: "SALE_LINE",
      sourceIdentifier: saleId || null,
      raw: data,
      normalized: {
        saleDate,
        saleId,
        customerName:
          data["Customer Name"].toLowerCase() === "anonymous"
            ? null
            : data["Customer Name"] || null,
        customerPhone: phone || null,
        sku,
        quantity,
        mrpPaise,
        purchaseCostPaise,
        standardPricePaise,
        unitPricePaise,
        grossSalesPaise,
        paymentMode: data["Payment Mode"] || null,
        channel: data.Channel || null,
        notes: data.Notes || null,
      },
      issues,
    });
  });
}

function validateCustomers(csv: string): StagedImportRow[] {
  const rows = tableFromCsv("Customers", csv).filter(({ data }) =>
    data["Customer ID"] || data["Customer Name"] || data["Phone Number"]
  );

  return rows.map(({ sourceRow, data }) => {
    const issues: ImportIssue[] = [];
    const customerId = data["Customer ID"];
    const name = data["Customer Name"];
    const phone = normalizePhone(data["Phone Number"]);
    const email = data.Email.toLowerCase();
    const isGuest = name.toLowerCase() === "anonymous";

    if (!customerId) {
      issue(issues, "Customer ID", "MISSING_CUSTOMER_ID", "ERROR",
        "Every customer row needs its source Customer ID.");
    }
    if (!name) {
      issue(issues, "Customer Name", "MISSING_CUSTOMER_NAME", "ERROR",
        "Customer name is required.");
    }
    if (isGuest) {
      issue(issues, "Customer Name", "GUEST_PSEUDO_CUSTOMER", "ERROR",
        "Anonymous is a Guest sale marker, not a customer-master record.", name);
    } else if (!/^\d{10,15}$/.test(phone)) {
      issue(issues, "Phone Number", "MISSING_OR_INVALID_PHONE", "ERROR",
        "A customer-master record needs a unique 10–15 digit phone number.",
        data["Phone Number"]);
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      issue(issues, "Email", "INVALID_EMAIL", "WARNING",
        "Invalid email will not be imported.", data.Email);
    }
    if (data["Child Name"] || data["Child Birthday"] || data["Child Age"]) {
      issue(issues, "Child details", "EXCLUDED_CHILD_DATA", "WARNING",
        "Child name, birthday and age are excluded from Phase 1 migration.");
    }

    const raw = { ...data };
    for (const field of ["Child Name", "Child Birthday", "Child Age"]) {
      if (raw[field]) raw[field] = "[REDACTED]";
    }

    return finish({
      sheet: "Customers",
      row: sourceRow,
      entityType: "CUSTOMER",
      sourceIdentifier: customerId || null,
      raw,
      normalized: {
        customerId,
        name,
        phone: phone || null,
        whatsappPhone: normalizePhone(data["WhatsApp Number"]) || null,
        email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
        address: data.Address || null,
        locality: data["Area / Locality"] || null,
        source: data.Source || null,
        notes: data.Notes || null,
        status: data.Status || null,
      },
      issues,
    });
  });
}

function addDuplicateErrors(
  rows: StagedImportRow[],
  key: (row: StagedImportRow) => string | null,
  field: string,
  code: string,
  message: string,
) {
  const groups = new Map<string, StagedImportRow[]>();
  for (const row of rows) {
    const value = key(row);
    if (!value) continue;
    groups.set(value, [...(groups.get(value) ?? []), row]);
  }
  for (const duplicates of groups.values()) {
    if (duplicates.length < 2) continue;
    for (const row of duplicates) {
      issue(row.issues, field, code, "ERROR", message);
      row.status = "QUARANTINED";
    }
  }
}

export function validateWorkbookExports(input: {
  inventoryCsv: string;
  salesCsv: string;
  customersCsv: string;
}): WorkbookValidation {
  const products = validateProducts(input.inventoryCsv);
  const productSkus = new Set(
    products.map((row) => String(row.normalized.sku || "")).filter(Boolean),
  );
  const sales = validateSales(input.salesCsv, productSkus);
  const customers = validateCustomers(input.customersCsv);
  const soldUnitsBySku = new Map<string, number>();
  for (const row of sales) {
    const sku = String(row.normalized.sku || "");
    const quantity = Number(row.normalized.quantity);
    if (sku && Number.isInteger(quantity) && quantity > 0) {
      soldUnitsBySku.set(sku, (soldUnitsBySku.get(sku) ?? 0) + quantity);
    }
  }
  for (const row of products) {
    const sku = String(row.normalized.sku || "");
    const workbookSold = Number(row.normalized.soldQuantity);
    const sourceSalesSold = soldUnitsBySku.get(sku) ?? 0;
    if (Number.isInteger(workbookSold) && workbookSold !== sourceSalesSold) {
      issue(
        row.issues,
        "Sold Qty",
        "SOLD_QUANTITY_RECONCILIATION_MISMATCH",
        "ERROR",
        `Inventory Master records ${workbookSold} sold units, but Sales Log contains ${sourceSalesSold}.`,
        String(row.raw["Sold Qty"] || ""),
      );
      row.status = "QUARANTINED";
    }
  }

  addDuplicateErrors(
    products,
    (row) => String(row.normalized.sku || "") || null,
    "SKU",
    "DUPLICATE_SKU",
    "The same normalized SKU appears more than once in Inventory Master.",
  );
  addDuplicateErrors(
    customers,
    (row) => String(row.normalized.customerId || "") || null,
    "Customer ID",
    "DUPLICATE_CUSTOMER_ID",
    "The same Customer ID appears more than once.",
  );
  addDuplicateErrors(
    customers,
    (row) => String(row.normalized.phone || "") || null,
    "Phone Number",
    "DUPLICATE_CUSTOMER_PHONE",
    "The same normalized phone number appears more than once.",
  );

  const sourceSaleUnits = sales.reduce(
    (total, row) => total + (Number(row.normalized.quantity) || 0),
    0,
  );
  const sourceSaleRevenue = sales.reduce(
    (total, row) => total + (Number(row.normalized.grossSalesPaise) || 0),
    0,
  );
  const acceptedSales = sales.filter((row) => row.status === "ACCEPTED");
  const rows = [...products, ...sales, ...customers];

  return {
    rows,
    reconciliation: {
      source: {
        products: products.length,
        saleLines: sales.length,
        customers: customers.length,
      },
      accepted: {
        products: products.filter((row) => row.status === "ACCEPTED").length,
        saleLines: acceptedSales.length,
        customers: customers.filter((row) => row.status === "ACCEPTED").length,
      },
      quarantined: rows.filter((row) => row.status === "QUARANTINED").length,
      warnings: rows.reduce(
        (total, row) =>
          total + row.issues.filter((item) => item.severity === "WARNING").length,
        0,
      ),
      sales: {
        sourceUnits: sourceSaleUnits,
        sourceRevenuePaise: sourceSaleRevenue,
        acceptedUnits: acceptedSales.reduce(
          (total, row) => total + (Number(row.normalized.quantity) || 0),
          0,
        ),
        acceptedRevenuePaise: acceptedSales.reduce(
          (total, row) => total + (Number(row.normalized.grossSalesPaise) || 0),
          0,
        ),
      },
    },
  };
}
