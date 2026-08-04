import { describe, expect, it } from "vitest";
import {
  buildJpegPdf,
  receiptFilename,
  receiptSavings,
} from "@/client/receipt-export";

describe("receipt export", () => {
  it("creates a safe customer-facing receipt filename", () => {
    expect(receiptFilename({ saleNumber: "SAL/93 46" }))
      .toBe("ItsMyToy-SAL-93-46");
  });

  it("wraps a receipt image in a valid single-page PDF", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const pdf = buildJpegPdf(jpeg, 640, 1280);
    const text = new TextDecoder("latin1").decode(pdf);

    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/Subtype /Image");
    expect(text).toContain("/Count 1");
    expect(text).toContain("startxref");
    expect(text.endsWith("%%EOF\n")).toBe(true);
  });

  it("separates the extra discount from the customer's total saving", () => {
    expect(receiptSavings({
      lines: [{
        productName: "Toy",
        sku: "IMT-TEST-0001",
        quantity: 2,
        mrpPaise: 50_000,
        listedPricePaise: 40_000,
        unitPricePaise: 35_000,
        totalPaise: 70_000,
      }],
    })).toEqual({
      additionalDiscountPaise: 10_000,
      totalSavingPaise: 30_000,
    });
  });
});
