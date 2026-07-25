import { describe, expect, it } from "vitest";
import { productChangeNoteConflict } from "@/shared/product-change-policy";

describe("existing product change policy", () => {
  it("requires an explanation for Other and accepts controlled reasons", () => {
    expect(productChangeNoteConflict("MARGIN_REVIEW")).toBeNull();
    expect(productChangeNoteConflict("OTHER", "Supplier relabelled the item"))
      .toBeNull();
    expect(productChangeNoteConflict("OTHER", " ")).toMatch(/Add a note/);
  });
});
