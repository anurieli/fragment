"use client";

import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";

/** Breathing room kept between a menu and the edge of the window. */
const VIEWPORT_MARGIN = 12;

export interface MenuPlacement {
  /** Which side of its trigger the menu opens on. */
  side: "top" | "bottom";
  /** Positioning classes for that side — spread onto the menu element. */
  className: string;
  /** Height cap, so a menu taller than the space available scrolls inside
   * itself instead of running off the screen. */
  maxHeight: number;
}

/**
 * Keeps a dropdown on screen. Menus in this app are absolutely positioned
 * under their trigger, which is fine until the trigger sits near the bottom of
 * the window — a piece's footer is pinned to the bottom of its page, and the
 * editor's toolbar can be too — and then the menu opens straight into the edge
 * and its last items are unreachable.
 *
 * Measures the real menu against the space above and below the trigger, flips
 * it up when down doesn't fit, and caps its height either way. Re-measures on
 * resize, on scroll (capturing, so inner scrollers count), and when the menu's
 * own content changes size — submenus and inline forms expand these menus
 * after they've opened.
 */
export function useMenuPlacement(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
): MenuPlacement {
  const [side, setSide] = useState<"top" | "bottom">("bottom");
  const [maxHeight, setMaxHeight] = useState(0);

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
    setSide(next);
    setMaxHeight(Math.max(0, Math.floor(next === "bottom" ? below : above)));
  }, [triggerRef, menuRef]);

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
    className: side === "top" ? "bottom-full mb-1" : "top-full mt-1",
    maxHeight,
  };
}
