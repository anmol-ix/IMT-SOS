import { describe, expect, it } from "vitest";
import {
  searchOfflineCatalog,
  toOfflineCatalogProduct,
  type OfflineCatalogProduct,
} from "@/shared/offline-catalog";

const products: OfflineCatalogProduct[] = [
  {
    id: "1",
    name: "Remote Control Car",
    variantName: "Red",
    sku: "IMT-CAR-RC-0001-RED",
    barcode: "890100000001",
    barcodes: ["890100000001", "SUPPLIER-RED"],
    rackLocation: "L1-S2",
    stock: 4,
    mrpPaise: 100_000,
    standardPricePaise: 90_000,
    minimumPricePaise: 80_000,
  },
  {
    id: "2",
    name: "Science Kit",
    variantName: null,
    sku: "IMT-EDU-SCI-0002",
    barcode: "890100000002",
    barcodes: ["890100000002"],
    rackLocation: "C2-S3",
    stock: 2,
    mrpPaise: 60_000,
    standardPricePaise: 55_000,
    minimumPricePaise: 50_000,
  },
];

describe("offline catalogue search", () => {
  it("finds an alternate barcode and prioritizes exact SKU matches", () => {
    expect(searchOfflineCatalog(products, "SUPPLIER-RED")[0]?.id).toBe("1");
    expect(searchOfflineCatalog([...products].reverse(), "IMT-CAR-RC-0001-RED")[0]?.id)
      .toBe("1");
  });

  it("matches product names without exposing more than twelve results", () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      ...products[1],
      id: String(index),
      name: `Science Kit ${index}`,
    }));
    expect(searchOfflineCatalog(many, "science")).toHaveLength(12);
  });

  it("removes owner-only cost fields from the device snapshot", () => {
    const ownerProduct = {
      ...products[0],
      inventoryValuePaise: 240_000,
      latestLandedCostPaise: 60_000,
      weightedAverageCostPaise: 60_000,
    };
    expect(toOfflineCatalogProduct(ownerProduct)).not.toHaveProperty(
      "inventoryValuePaise",
    );
    expect(toOfflineCatalogProduct(ownerProduct)).not.toHaveProperty(
      "latestLandedCostPaise",
    );
  });
});
