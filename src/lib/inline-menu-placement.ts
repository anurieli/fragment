export interface InlineMenuRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface InlineMenuSize {
  width: number;
  height: number;
}

export interface InlineMenuPlacementInput {
  selection: InlineMenuRect;
  container: InlineMenuRect;
  scrollTop: number;
  scrollLeft: number;
  menu: InlineMenuSize;
  viewport: InlineMenuSize;
}

export interface InlineMenuPosition {
  top: number;
  left: number;
  side: "top" | "bottom";
}

const MENU_GAP = 8;
const VIEWPORT_MARGIN = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function calculateInlineMenuPosition({
  selection,
  container,
  scrollTop,
  scrollLeft,
  menu,
  viewport,
}: InlineMenuPlacementInput): InlineMenuPosition | null {
  const selectionCenter = (selection.left + selection.right) / 2;
  const visibleTop = Math.max(VIEWPORT_MARGIN, container.top);
  const visibleBottom = Math.min(viewport.height - VIEWPORT_MARGIN, container.bottom);
  const visibleLeft = Math.max(VIEWPORT_MARGIN, container.left);
  const visibleRight = Math.min(viewport.width - VIEWPORT_MARGIN, container.right);

  if (selection.bottom < visibleTop || selection.top > visibleBottom) {
    return null;
  }

  const spaceAbove = selection.top - visibleTop - MENU_GAP;
  const spaceBelow = visibleBottom - selection.bottom - MENU_GAP;
  const side = menu.height <= spaceAbove || spaceAbove >= spaceBelow ? "top" : "bottom";
  const preferredTop = side === "top"
    ? selection.top - MENU_GAP - menu.height
    : selection.bottom + MENU_GAP;
  const viewportTop = clamp(
    preferredTop,
    visibleTop,
    Math.max(visibleTop, visibleBottom - menu.height),
  );
  const viewportLeft = clamp(
    selectionCenter - menu.width / 2,
    visibleLeft,
    Math.max(visibleLeft, visibleRight - menu.width),
  );

  return {
    top: viewportTop - container.top + scrollTop,
    left: viewportLeft - container.left + scrollLeft,
    side,
  };
}
