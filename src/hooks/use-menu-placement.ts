"use client";

import { useCallback, useEffect, useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

/** Breathing room kept between a menu and the edge of the window. */
const VIEWPORT_MARGIN = 12;

export interface MenuPlacement {
  /** Which side of its trigger the menu opens on. */
  side: "top" | "bottom";
  /**
   * Viewport coordinates for the menu, to be spread onto a `fixed` element
   * rendered through `Portal`. Includes the height cap and hides the menu for
   * the one frame before it has been measured.
   */
  style: CSSProperties;
  /** Height cap, so a menu taller than the space available scrolls inside
   * itself instead of running off the screen. */
  maxHeight: number;
  /** The trigger's width, for the dropdowns that want to match it. A portaled
   * menu has no parent to take `w-full` from any more. */
  triggerWidth: number;
}

/**
 * Keeps a dropdown on screen, and out of its container.
 *
 * Menus here used to be absolutely positioned under their trigger, which fails
 * twice. Near the bottom of the window the menu opens straight into the edge
 * and its last items are unreachable. And inside any scroller (the sidebar's
 * idea list, a piece card's column) `overflow` clips it, so an idea near the
 * bottom of the sidebar had its menu cut off by the sidebar's own footer no
 * matter what z-index it carried.
 *
 * So this measures the real menu against the space above and below the
 * trigger and returns *viewport* coordinates: render the menu `fixed`, inside
 * a `Portal`, at `Z_FLOATING`, and it is clipped by nothing. It flips up when
 * down doesn't fit, caps its height either way, and clamps horizontally so a
 * right-aligned menu on a narrow panel never hangs off the window.
 *
 * Re-measures on resize, on scroll (capturing, so inner scrollers count), and
 * when the menu's own content changes size — submenus and inline forms expand
 * these menus after they've opened.
 *
 * `align` is which edge of the menu lines up with the trigger: "right" matches
 * the old `right-0`, which is what nearly every menu here wants.
 */
export function useMenuPlacement(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
  align: "left" | "right" = "right",
): MenuPlacement {
  const [side, setSide] = useState<"top" | "bottom">("bottom");
  const [maxHeight, setMaxHeight] = useState(0);
  const [triggerWidth, setTriggerWidth] = useState(0);
  const [offset, setOffset] = useState<{ left: number; top: number } | null>(null);

  const measure = useCallback(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;

    const rect = trigger.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
    const above = rect.top - VIEWPORT_MARGIN;
    const needed = menu.scrollHeight;

    // Prefer opening downward, the way every other menu here reads; flip only
    // when it genuinely doesn't fit and there's more room the other way.
    const next = needed <= below || below >= above ? "bottom" : "top";
    const room = Math.max(0, Math.floor(next === "bottom" ? below : above));
    setSide(next);
    setMaxHeight(room);
    setTriggerWidth(rect.width);

    const width = menu.offsetWidth;
    const rawLeft = align === "right" ? rect.right - width : rect.left;
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(rawLeft, window.innerWidth - width - VIEWPORT_MARGIN),
    );
    // 4px gap either way, matching the mt-1 / mb-1 these menus used to carry.
    const top =
      next === "bottom"
        ? rect.bottom + 4
        : Math.max(VIEWPORT_MARGIN, rect.top - 4 - Math.min(needed, room));
    setOffset({ left, top });
  }, [triggerRef, menuRef, align]);

  // Not cleared on close: the menu is unmounted by then, and this effect runs
  // before paint on reopen, so the stale coordinates are corrected in the same
  // commit and never reach the screen.
  useLayoutEffect(() => {
    if (!open) return;
    measure();
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const observer = menu ? new ResizeObserver(measure) : null;
    if (menu && observer) observer.observe(menu);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      observer?.disconnect();
    };
  }, [open, measure, menuRef]);

  return {
    side,
    maxHeight,
    triggerWidth,
    style: {
      left: offset?.left ?? 0,
      top: offset?.top ?? 0,
      maxHeight: maxHeight || undefined,
      // One frame passes between "the menu exists so it can be measured" and
      // "we know where it goes". Hidden rather than unmounted, because it has
      // to be in the document to have a size at all.
      visibility: offset ? "visible" : "hidden",
    },
  };
}
