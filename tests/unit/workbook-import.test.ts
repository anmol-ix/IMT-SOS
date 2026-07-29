import { describe, expect, it } from "vitest";
import {
  parseCsv,
  validateWorkbookExports,
} from "@/shared/workbook-import";

const inventoryHeader = [
  "SKU", "Item Name", "Category", "Sub-category", "Entry Type", "Brand",
  "PP (₹)", "SP (₹)", "MRP (₹)", "Opening Qty", "Purchased Qty", "Sold Qty",
  "On Hand Qty", "Sales Value (Actual ₹)", "Last Sold Date", "Notes",
].join(",");
const salesHeader = [
  "Date", "Sale ID", "Customer Name", "Contact Number", "SKU", "Item Name",
  "Qty Sold", "MRP (₹)", "PP (₹)", "Standard S.Price (₹)",
  "Actual S.Price (₹)", "Gross Sales (₹)", "Customer Discount (₹)",
  "Actual Discount (₹)", "Actual Discount %age", "Profit (₹)",
  "Payment Mode", "Channel", "Notes",
].join(",");
const customerHeader = [
  "Customer ID", "Customer Name", "Phone Number", "WhatsApp Number", "Email",
  "Child Name", "Child Birthday", "Child Age", "Address", "Area / Locality",
  "Source", "First Visit Date", "Last Purchase Date", "Purchase Lines",
  "Total Spend (₹)", "Notes", "Status",
].join(",");

function cleanExports() {
  return {
    inventoryCsv: [
      "Inventory Master",
      inventoryHeader,
      "IMT-CAR-RC-0001,Stunt Car,Toys,Remote,Single Item,,100,200,250,2,1,1,2,,,",
      ",,Toys,Remote,Single Item,,0,0,0,,,0,,,,",
    ].join("\n"),
    salesCsv: [
      "",
      salesHeader,
      "28/07/2026,S-0001,Anmol,9876543210,IMT-CAR-RC-0001,Stunt Car,1,250,100,200,180,180,,,,80,Cash,Store Walk-in,",
      ",S-0999,,,,,,,,,,,,,,,,,",
    ].join("\n"),
    customersCsv: [
      "",
      customerHeader,
      "CUS-0001,Anmol,9876543210,,,,,,,Sunny Enclave,Store Walk-in,,,,,,Active",
    ].join("\n"),
  };
}

describe("workbook import validation", () => {
  it("parses quoted commas, quotes and line breaks without a dependency", () => {
    expect(parseCsv('a,"b,c","d""e"\n1,"two\nlines",3')).toEqual([
      ["a", "b,c", 'd"e'],
      ["1", "two\nlines", "3"],
    ]);
  });

  it("accepts source rows and ignores prefilled blank template rows", () => {
    const result = validateWorkbookExports(cleanExports());
    expect(result.reconciliation).toMatchObject({
      source: { products: 1, saleLines: 1, customers: 1 },
      accepted: { products: 1, saleLines: 1, customers: 1 },
      quarantined: 0,
      sales: {
        sourceUnits: 1,
        sourceRevenuePaise: 18_000,
        acceptedUnits: 1,
        acceptedRevenuePaise: 18_000,
      },
    });
  });

  it("quarantines duplicate masters, zero-price sales and missing SKUs", () => {
    const input = cleanExports();
    input.inventoryCsv +=
      "\nIMT-CAR-RC-0001,Duplicate Car,Toys,Remote,Single Item,,100,200,250,1,0,0,1,,,";
    input.salesCsv +=
      "\n28/07/2026,S-0002,Guest,,IMT-MISSING-RC-0002,Missing,1,250,100,200,0,0,,,,,Cash,Store Walk-in,";
    input.customersCsv +=
      "\nCUS-0002,Duplicate Phone,9876543210,,,,,,,Mohali,Store Walk-in,,,,,,Active";

    const result = validateWorkbookExports(input);
    const codes = result.rows.flatMap((row) => row.issues.map((issue) => issue.code));
    expect(codes).toEqual(expect.arrayContaining([
      "DUPLICATE_SKU",
      "MISSING_PRODUCT_SKU",
      "ZERO_OR_INVALID_SALE_PRICE",
      "DUPLICATE_CUSTOMER_PHONE",
    ]));
    expect(result.reconciliation.quarantined).toBe(5);
  });

  it("quarantines stock whose sold quantity disagrees with Sales Log", () => {
    const input = cleanExports();
    input.inventoryCsv = input.inventoryCsv.replace(
      "100,200,250,2,1,1,2",
      "100,200,250,3,1,2,2",
    );
    const product = validateWorkbookExports(input).rows.find(
      (row) => row.entityType === "PRODUCT",
    )!;
    expect(product.status).toBe("QUARANTINED");
    expect(product.issues).toContainEqual(expect.objectContaining({
      code: "SOLD_QUANTITY_RECONCILIATION_MISMATCH",
    }));
  });

  it("excludes child data from normalized and stored raw customer values", () => {
    const input = cleanExports();
    input.customersCsv = [
      "",
      customerHeader,
      "CUS-0001,Anmol,9876543210,,,Child Name,01/01/2020,6,,,Store Walk-in,,,,,,Active",
    ].join("\n");
    const customer = validateWorkbookExports(input).rows.find(
      (row) => row.entityType === "CUSTOMER",
    )!;
    expect(customer.raw["Child Name"]).toBe("[REDACTED]");
    expect(customer.raw["Child Birthday"]).toBe("[REDACTED]");
    expect(customer.normalized).not.toHaveProperty("childName");
    expect(customer.issues).toContainEqual(expect.objectContaining({
      code: "EXCLUDED_CHILD_DATA",
      severity: "WARNING",
    }));
  });
});
