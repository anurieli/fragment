"use client";

import { createPortal } from "react-dom";

/**
 * Renders its children at the end of <body> instead of where they sit in the
 * tree.
 *
 * Menus and tooltips in this app are born inside a scroller: the sidebar's
 * idea list, a piece card's column, the helper bar. `overflow` on any ancestor
 * clips a child no matter how high its z-index is, so a menu opened on the
 * last idea in a long list was cut off by the sidebar's own footer, and a
 * popover in the pieces panel was cut off by the editor beside it. No z-index
 * fixes that; leaving the container does.
 *
 * Pair it with `fixed` positioning and one of the layers in lib/z-layers.
 *
 * The document check, rather than the usual mounted-in-an-effect gate, is
 * load-bearing: everything portaled here measures itself in a layout effect to
 * work out where on screen it goes, and a portal that only appears on the
 * second render hands those measurements a null ref on the first one. They
 * then never re-run, and the menu renders wherever the click happened to be
 * with no clamping at all. Nothing here is rendered until someone opens it, so
 * there is no server render to mismatch.
 */
export function Portal({ children }: { children: React.ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
