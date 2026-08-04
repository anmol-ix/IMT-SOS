import { describe, expect, it } from "vitest";
import { matchPrintedLabel } from "@/shared/label-recognition";

const candidates = [
  {
    code: "IMT-CAR-RC-0002",
    sku: "IMT-CAR-RC-0002",
    name: "360 Climb Force Rotation",
  },
  {
    code: "IMT-CAR-RC-0027",
    sku: "IMT-CAR-RC-0027",
    name: "4 wheel moka rock crawal",
  },
];

describe("printed label recognition", () => {
  it("matches a partially misread printed SKU", () => {
    const match = matchPrintedLabel("IMT-CAR-RC-OOO2", candidates);
    expect(match?.candidate.code).toBe("IMT-CAR-RC-0002");
    expect(match?.matchedBy).toBe("sku");
  });

  it("falls back to the product name when the barcode and SKU are blurred", () => {
    const match = matchPrintedLabel(
      "340 Climb Farce Rotation MRP 1500 SALE 1200",
      candidates,
    );
    expect(match?.candidate.code).toBe("IMT-CAR-RC-0002");
    expect(match?.matchedBy).toBe("product-name");
  });

  it("matches the imperfect text recovered from the photographed shop label", () => {
    const match = matchPrintedLabel(
      "A ART 340 Climb Farce Rotation MRP 1500 SALE 1200 ITSMYTOY WHOLESALE RETAIL",
      candidates,
    );
    expect(match?.candidate.code).toBe("IMT-CAR-RC-0002");
    expect(match?.matchedBy).toBe("product-name");
  });

  it("does not guess when two products are equally plausible", () => {
    const match = matchPrintedLabel("Remote Control Car", [
      { code: "A", sku: "A", name: "Remote Control Car Red" },
      { code: "B", sku: "B", name: "Remote Control Car Blue" },
    ]);
    expect(match).toBeNull();
  });
});
