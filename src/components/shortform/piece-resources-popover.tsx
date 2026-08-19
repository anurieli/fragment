"use client";

import { useMemo, useRef, useState, type RefObject } from "react";
import { ExternalLink, Plus } from "lucide-react";
import { Portal } from "@/components/common/portal";
import { useMenuPlacement } from "@/hooks/use-menu-placement";
import { Z_FLOATING } from "@/lib/z-layers";
import { useContentStore } from "@/stores/content-store";
import { effectiveResourcesForPiece } from "@/stores/resources-selectors";

interface PieceResourcesPopoverProps {
  pieceId: string;
  onClose: () => void;
  /** The `relative` wrapper this popover is positioned against, so it can
   * flip above the trigger when the card's footer sits at the window's edge. */
  anchorRef: RefObject<HTMLElement | null>;
}

/**
 * Small popover, opened from a piece card's ⋯ menu: the piece's EFFECTIVE
 * resources (its own + inherited from its idea + that idea's parent, tagged
 * accordingly) plus a lean attach-link form. Inherited entries aren't
 * removable from here — remove them from the owning idea's Resources rail.
 */
export function PieceResourcesPopover({ pieceId, onClose, anchorRef }: PieceResourcesPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const placement = useMenuPlacement(true, anchorRef, popoverRef);
  const pieces = useContentStore((s) => s.pieces);
  const ideas = useContentStore((s) => s.ideas);
  const resources = useContentStore((s) => s.resources);
  const addResource = useContentStore((s) => s.addResource);
  const removeResource = useContentStore((s) => s.removeResource);

  const [formOpen, setFormOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");

  const effective = useMemo(
    () =>
      effectiveResourcesForPiece(
        pieceId,
        Object.values(pieces),
        Object.values(ideas),
        Object.values(resources),
      ),
    [pieceId, pieces, ideas, resources],
  );

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    addResource("piece", pieceId, { kind: "link", url: url.trim() || undefined, title: title.trim(), note: note.trim() || undefined });
    setUrl("");
    setTitle("");
    setNote("");
    setFormOpen(false);
  }

  return (
    <Portal>
    <div
      ref={popoverRef}
      onClick={(e) => e.stopPropagation()}
      onMouseLeave={onClose}
      className={`fixed ${Z_FLOATING} w-64 bg-surface-3 border border-border-strong rounded-[var(--radius-default)] shadow-xl p-2.5 overflow-y-auto`}
      style={{ animation: "fadeIn 0.12s ease-out", ...placement.style }}
    >
      <p className="text-[10px] uppercase tracking-wider text-text-faint px-0.5 pb-1.5">
        Resources — this piece&apos;s, plus what its idea shares down
      </p>

      {effective.length === 0 ? (
        <p className="text-[11px] text-text-faint px-0.5 pb-1.5">No resources yet.</p>
      ) : (
        <div className="space-y-1.5 mb-1.5">
          {effective.map(({ resource, inheritedFrom }) => (
            <div key={resource.id} className="flex items-center gap-1.5 px-0.5">
              {resource.url ? (
                <a
                  href={resource.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center gap-1 text-[11px] text-text-secondary hover:text-gold transition-colors duration-150 truncate"
                >
                  {resource.title}
                  <ExternalLink size={9} className="shrink-0" />
                </a>
              ) : (
                <span className="flex-1 text-[11px] text-text-secondary truncate">{resource.title}</span>
              )}
              {inheritedFrom ? (
                <span className="shrink-0 text-[9px] text-text-faint bg-surface-2 px-1 py-0.5 rounded-[3px]">
                  from {inheritedFrom.title || "idea"}
                </span>
              ) : (
                <button
                  onClick={() => removeResource(resource.id)}
                  className="shrink-0 text-[10px] text-text-faint hover:text-red transition-colors duration-150"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {formOpen ? (
        <form onSubmit={handleAdd} className="flex flex-col gap-1 px-0.5">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="text-[11px] bg-surface-2 border border-border rounded-[4px] px-1.5 py-1 text-text-primary placeholder:text-text-faint outline-none"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
            className="text-[11px] bg-surface-2 border border-border rounded-[4px] px-1.5 py-1 text-text-primary placeholder:text-text-faint outline-none"
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Comment (optional)"
            className="text-[11px] bg-surface-2 border border-border rounded-[4px] px-1.5 py-1 text-text-primary placeholder:text-text-faint outline-none"
          />
          <div className="flex items-center gap-2 mt-0.5">
            <button
              type="submit"
              disabled={!title.trim()}
              className="text-[11px] text-gold hover:text-gold/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
            >
              Attach
            </button>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="text-[11px] text-text-faint hover:text-text-secondary transition-colors duration-150"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setFormOpen(true)}
          className="flex items-center gap-1 text-[11px] text-text-faint hover:text-text-secondary px-0.5 transition-colors duration-150"
        >
          <Plus size={10} />
          Attach link
        </button>
      )}
    </div>
    </Portal>
  );
}
