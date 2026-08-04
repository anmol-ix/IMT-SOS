export type DropdownPlacement = {
  vertical: "top" | "bottom";
  horizontal: "left" | "right";
  maxHeight: number;
};

export function resolveDropdownPlacement(
  trigger: Pick<DOMRect, "top" | "right" | "bottom" | "left" | "width">,
  viewport: { width: number; height: number },
  requestedHeight: number,
  requestedWidth = trigger.width,
): DropdownPlacement {
  const gap = 8;
  const roomAbove = Math.max(0, trigger.top - gap);
  const roomBelow = Math.max(0, viewport.height - trigger.bottom - gap);
  const neededHeight = Math.min(256, Math.max(96, requestedHeight));
  const vertical = roomBelow >= neededHeight || roomBelow >= roomAbove
    ? "bottom"
    : "top";
  const availableHeight = vertical === "bottom" ? roomBelow : roomAbove;

  const menuWidth = Math.max(trigger.width, requestedWidth);
  const roomFromLeft = viewport.width - trigger.left - gap;
  const roomFromRight = trigger.right - gap;
  const horizontal = roomFromLeft >= menuWidth || roomFromLeft >= roomFromRight
    ? "left"
    : "right";

  return {
    vertical,
    horizontal,
    maxHeight: Math.max(96, Math.min(256, availableHeight)),
  };
}
