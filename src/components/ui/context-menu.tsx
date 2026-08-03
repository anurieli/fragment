"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const VIEWPORT_PADDING = 8;
const ContextMenuCloseContext = createContext<(() => void) | null>(null);

export interface Point {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

export function clampContextMenuPosition(
  anchor: Point,
  menu: Size,
  viewport: Size,
  padding = VIEWPORT_PADDING,
): { left: number; top: number } {
  return {
    left: Math.max(padding, Math.min(anchor.x, viewport.width - menu.width - padding)),
    top: Math.max(padding, Math.min(anchor.y, viewport.height - menu.height - padding)),
  };
}

interface ContextMenuProps {
  position: Point;
  onClose: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}

export function ContextMenu({ position, onClose, ariaLabel, children }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState({ left: position.x, top: position.y });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const place = () => {
      setPlaced(
        clampContextMenuPosition(
          position,
          { width: menu.offsetWidth, height: menu.offsetHeight },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };

    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [position]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel}
      className="fixed z-[100] min-w-[220px] overflow-hidden rounded-[var(--radius-lg)] border border-border-strong bg-surface-2 py-1 shadow-2xl"
      style={{
        left: placed.left,
        top: placed.top,
        animation: "fadeIn 0.1s ease-out",
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <ContextMenuCloseContext.Provider value={onClose}>
        {children}
      </ContextMenuCloseContext.Provider>
    </div>,
    document.body,
  );
}

interface ContextMenuItemProps {
  label: string;
  onSelect: () => void;
  icon?: React.ReactNode;
  shortcut?: string;
  badge?: string;
  destructive?: boolean;
  disabled?: boolean;
}

export function ContextMenuItem({
  label,
  onSelect,
  icon,
  shortcut,
  badge,
  destructive = false,
  disabled = false,
}: ContextMenuItemProps) {
  const closeMenu = useContext(ContextMenuCloseContext);

  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        onSelect();
        closeMenu?.();
      }}
      className={`flex w-full items-center gap-3 px-3 py-2 text-left text-[12px] transition-colors duration-100 disabled:cursor-default disabled:opacity-50 ${
        destructive
          ? "text-red hover:bg-red-muted"
          : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
      }`}
    >
      <span className="flex w-4 shrink-0 items-center justify-center text-text-muted">{icon}</span>
      <span className="flex-1">{label}</span>
      {badge && (
        <span className="rounded-full border border-border-strong bg-surface-3 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-text-faint">
          {badge}
        </span>
      )}
      {shortcut && (
        <kbd className="font-[family-name:var(--font-mono)] text-[10px] text-text-faint">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}

export function ContextMenuSeparator() {
  return <div role="separator" className="my-1 border-t border-border" />;
}
