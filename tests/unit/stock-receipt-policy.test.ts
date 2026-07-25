import { describe, expect, it } from "vitest";
import { normalizeInvoiceReference } from "@/server/complete-stock-receipt";
import { normalizeSupplierName } from "@/server/suppliers";

describe("stock receipt identity policy", () => {
  it("matches supplier bill references despite case and accidental spaces", () => {
    expect(normalizeInvoiceReference("  inv  -  104 / a ")).toBe("INV-104/A");
    expect(normalizeInvoiceReference("INV-104/A")).toBe("INV-104/A");
    expect(normalizeInvoiceReference("   ")).toBeNull();
  });

  it("matches supplier names despite case and repeated spaces", () => {
    expect(normalizeSupplierName("  Akhil   Toy House ")).toBe("akhil toy house");
    expect(normalizeSupplierName("AKHIL TOY HOUSE")).toBe("akhil toy house");
  });
});
