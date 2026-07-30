import { describe, expect, it } from "vitest";
import { buildLabelCsv } from "@/shared/label-csv";

describe("buildLabelCsv", () => {
  it("exports selected SKU details safely for label software", () => {
    const csv = buildLabelCsv([{
      sku: "IMT-CAR-RC-0001",
      barcode: "IMT-CAR-RC-0001",
      productName: "Car, Remote",
      variantName: "Blue",
      mrpPaise: 59900,
      standardPricePaise: 49900,
      rackLocation: "L1-S2",
    }]);

    expect(csv).toContain('"SKU","Barcode","Product Name"');
    expect(csv).toContain('"Car, Remote","Blue","599.00","499.00","L1-S2"');
  });
});
