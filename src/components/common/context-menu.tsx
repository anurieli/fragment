"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** Breathing room kept between the menu and the edge of the window. Matches
 * use-menu-placement's margin, since these are the same menus in a different
 * position. */
const VIEWPORT_MARGIN = 12;

export interface ContextMenuPoint {
  x: number;
  y: number;
}

/**
 * State for one right-click menu. Every surface that wants one needs the same
 * three things: where the click was, a way to open it from an event, and a way
 * to close it. Written once here so a row only has to say `onContextMenu`.
 *
 * `openAt` swallows the browser's own menu, which is the trade: a writer who
 * right-clicks a piece row is asking about the piece, not about the page. It
 * deliberately does NOT swallow anything inside a text field — see the guard
 * in the components that use it, where spellcheck and paste still matter.
 */
export function useContextMenu() {
  const [point, setPoint] = useState<ContextMenuPoint | null>(null);

  const openAt = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPoint({ x: e.clientX, y: e.clientY });
  }, []);

  const close = useCallback(() => setPoint(null), []);

  return { point, openAt, close };
}

interface ContextMenuProps {
  point: ContextMenuPoint;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * A menu that opens at the pointer rather than under a button.
 *
 * Fixed positioning, measured after mount and nudged back inside the window,
 * so a right-click near the bottom or the right edge still shows every item
 * (the same failure use-menu-placement exists to prevent for anchored menus).
 * A transparent backdrop catches the next click anywhere, including the next
 * right-click, so two of these can never be open at once.
 */
export function ContextMenu({ point, onClose, children }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<ContextMenuPoint>(point);
  const [maxHeight, setMaxHeight] = useState<number>(0);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const width = menu.offsetWidth;
    const needed = menu.scrollHeight;
    const room = window.innerHeight - point.y - VIEWPORT_MARGIN;
    // Flip up only when down genuinely doesn't fit and up has more room, then
    // cap either way so a long menu scrolls inside itself.
    const above = point.y - VIEWPORT_MARGIN;
    const openUp = needed > room && above > room;
    const height = Math.max(0, Math.floor(openUp ? above : room));
    setMaxHeight(height);
    setPosition({
      x: Math.min(point.x, window.innerWidth - width - VIEWPORT_MARGIN),
      y: openUp ? Math.max(VIEWPORT_MARGIN, point.y - Math.min(needed, height)) : point.y,
    });
  }, [point]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    // Capturing: a menu pinned to a point in the window is wrong the moment
    // whatever it points at moves, and closing beats following.
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}
      />
      <div
        ref={menuRef}
        role="menu"
        onClick={(e) => e.stopPropagation()}
        style={{ left: position.x, top: position.y, maxHeight: maxHeight || undefined }}
        className="fixed z-50 w-48 bg-surface-3 border border-border-strong rounded-[var(--radius-default)] shadow-xl py-1 overflow-y-auto"
      >
        {children}
      </div>
    </>
  );
}

/** One row in any of these menus. `hint` is the second line for actions whose
 * consequence isn't obvious from two words (archive, cascading delete). */
export function ContextMenuItem({
  label,
  hint,
  destructive,
  disabled,
  title,
  onClick,
}: {
  label: string;
  hint?: string;
  destructive?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      disabled={disabled}
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`block w-full text-left px-3 py-1.5 transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none ${
        destructive ? "text-red hover:bg-red-muted" : "text-text-secondary hover:bg-surface-hover"
      }`}
    >
      <span className="block text-[12px]">{label}</span>
      {hint && <span className="block text-[10px] text-text-faint">{hint}</span>}
    </button>
  );
}

export function ContextMenuDivider() {
  return <div className="my-1 border-t border-border" />;
}
