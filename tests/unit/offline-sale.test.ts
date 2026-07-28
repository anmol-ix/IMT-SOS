import { describe, expect, it } from "vitest";
import type { OfflineCatalogSnapshot } from "@/shared/offline-catalog";
import type { OfflineDeviceEnrollment } from "@/shared/offline-device";
import {
  buildOfflineSaleCommand,
  offlineAvailableQuantity,
  OfflineSaleNotAllowedError,
  type OfflineSaleCommand,
} from "@/shared/offline-sale";

const catalog: OfflineCatalogSnapshot = {
  asOf: "2026-07-28T03:00:00.000Z",
  products: [{
    id: "5a0be628-c716-41c8-9332-ac703252db61",
    priceVersionId: "641aecbe-ff97-4d26-9ce5-9dc3a3e10b31",
    name: "Remote Control Car",
    variantName: "Red",
    sku: "IMT-CAR-RC-0001-RED",
    barcode: "890100000001",
    barcodes: ["890100000001"],
    rackLocation: "L1-S2",
    stock: 4,
    mrpPaise: 100_000,
    standardPricePaise: 90_000,
    minimumPricePaise: 80_000,
  }],
};

const device: OfflineDeviceEnrollment = {
  deviceId: "45ee4c95-a774-49c7-b3df-4a24c0bcaefd",
  devicePublicId: "21e97c07-c082-4c89-9f82-5e862df4ce99",
  displayName: "Safari on iPhone",
  status: "ACTIVE",
  lastValidatedAt: "2026-07-28T03:00:00.000Z",
  graceExpiresAt: "2026-07-28T15:00:00.000Z",
};

function build(overrides: Partial<Parameters<typeof buildOfflineSaleCommand>[0]> = {}) {
  return buildOfflineSaleCommand({
    commandId: "91922e03-2a91-469f-a22a-654bfc69227f",
    userBinding: "user-id:STORE_OPERATOR",
    catalog,
    device,
    queuedCommands: [],
    lines: [{
      variantId: catalog.products[0].id,
      quantity: 1,
      unitPricePaise: 85_000,
    }],
    paymentMode: "UPI",
    now: new Date("2026-07-28T10:00:00.000Z"),
    ...overrides,
  });
}

describe("offline Guest sale queue policy", () => {
  it("leaves one last-known unit and includes the cached price version", () => {
    expect(offlineAvailableQuantity(4, 1)).toBe(2);
    const command = build();
    expect(command).toMatchObject({
      status: "QUEUED",
      display: { totalPaise: 85_000, units: 1, paymentMode: "UPI" },
      payload: {
        offline: {
          schemaVersion: 1,
          catalogAsOf: catalog.asOf,
          lines: [{
            priceVersionId: catalog.products[0].priceVersionId,
            cachedStock: 4,
            queuedBeforeQuantity: 0,
          }],
        },
      },
    });
  });

  it("counts earlier unsynced sales before applying the reserve", () => {
    const queued = build();
    expect(() => build({
      queuedCommands: [queued],
      lines: [{
        variantId: catalog.products[0].id,
        quantity: 3,
        unitPricePaise: 90_000,
      }],
    })).toThrowError(OfflineSaleNotAllowedError);
  });

  it("blocks expired devices, below-floor prices and high-value Guest carts", () => {
    expect(() => build({ now: new Date("2026-07-28T15:00:00.000Z") }))
      .toThrow(/validate this approved device/i);
    expect(() => build({
      lines: [{
        variantId: catalog.products[0].id,
        quantity: 1,
        unitPricePaise: 79_999,
      }],
    })).toThrow(/saved permitted price/i);

    const expensiveCatalog: OfflineCatalogSnapshot = {
      ...catalog,
      products: [{ ...catalog.products[0], stock: 10 }],
    };
    expect(() => build({
      catalog: expensiveCatalog,
      lines: [{
        variantId: catalog.products[0].id,
        quantity: 6,
        unitPricePaise: 90_000,
      }],
    })).toThrow(/₹5,000 or more/i);
  });

  it("keeps needs-review commands reserved because the physical sale already happened", () => {
    const needsReview: OfflineSaleCommand = {
      ...build(),
      status: "NEEDS_REVIEW",
    };
    expect(() => build({
      queuedCommands: [needsReview],
      lines: [{
        variantId: catalog.products[0].id,
        quantity: 3,
        unitPricePaise: 90_000,
      }],
    })).toThrow(/last known unit/i);
  });
});
