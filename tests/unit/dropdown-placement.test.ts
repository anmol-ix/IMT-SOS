import { describe, expect, it } from "vitest";
import { resolveDropdownPlacement } from "@/components/ui/dropdown-placement";

describe("dropdown placement", () => {
  it("opens below when there is enough room", () => {
    expect(resolveDropdownPlacement(
      { top: 100, right: 300, bottom: 148, left: 100, width: 200 },
      { width: 1_200, height: 800 },
      220,
    )).toMatchObject({ vertical: "bottom", horizontal: "left" });
  });

  it("flips above a trigger near the bottom of the viewport", () => {
    expect(resolveDropdownPlacement(
      { top: 690, right: 300, bottom: 738, left: 100, width: 200 },
      { width: 1_200, height: 800 },
      220,
    )).toMatchObject({ vertical: "top", horizontal: "left" });
  });

  it("aligns to the right edge when the trigger is near the right viewport edge", () => {
    expect(resolveDropdownPlacement(
      { top: 100, right: 1_180, bottom: 148, left: 980, width: 200 },
      { width: 1_200, height: 800 },
      220,
      260,
    )).toMatchObject({ vertical: "bottom", horizontal: "right" });
  });
});
