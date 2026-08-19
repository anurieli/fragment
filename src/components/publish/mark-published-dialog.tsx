"use client";

import { useEffect } from "react";
import { CheckCircle2, X } from "lucide-react";
import type { ContentPiece } from "@/lib/content-engine";
import { MarkPublishedForm } from "./mark-published-form";

/**
 * "Where did it go live?", asked properly.
 *
 * The same form also sits inline inside the Share and publish dropdowns, where
 * the field is right under the button that opened it. A right-click menu is a
 * worse host: it is pinned to a point, it closes on any scroll, and focusing a
 * field inside it scrolls it. So from a row menu the question gets a dialog,
 * and the answer goes through the same form either way.
 */
export function MarkPublishedDialog({
  piece,
  onClose,
}: {
  piece: ContentPiece;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(12,12,11,0.7)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] bg-surface border border-border-strong rounded-[var(--radius-lg)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Mark as published"
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2.5 min-w-0">
            <CheckCircle2 size={15} className="text-text-muted shrink-0" />
            <div className="min-w-0">
              <p className="text-[13px] text-text-primary font-medium">
                Where did it go live?
              </p>
              <p className="text-[11px] text-text-faint truncate">
                {piece.title || "Untitled"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-text-faint hover:text-text-secondary transition-colors duration-150"
          >
            <X size={14} />
          </button>
        </div>
        <div className="py-2">
          <MarkPublishedForm piece={piece} onDone={onClose} autoFocus />
        </div>
      </div>
    </div>
  );
}
