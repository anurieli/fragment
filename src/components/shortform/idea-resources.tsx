"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Plus, StickyNote } from "lucide-react";
import type { ResourceKind } from "@/lib/content-engine";
import { useContentStore } from "@/stores/content-store";
import { effectiveResourcesForIdea } from "@/stores/resources-selectors";

interface IdeaResourcesProps {
  ideaId: string;
}

function faviconUrl(url: string): string | undefined {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).host}`;
  } catch {
    return undefined;
  }
}

/**
 * Collapsible reference-material rail at the top of the Pieces feed: links,
 * notes, and assets attached to this idea, plus anything inherited from its
 * parent idea (visually tagged, never editable/removable from here — the
 * source of truth for an inherited entry lives on its owning idea). Lean by
 * design — reference material at hand, not a browser.
 */
export function IdeaResources({ ideaId }: IdeaResourcesProps) {
  const ideas = useContentStore((s) => s.ideas);
  const resources = useContentStore((s) => s.resources);
  const addResource = useContentStore((s) => s.addResource);
  const removeResource = useContentStore((s) => s.removeResource);

  const [expanded, setExpanded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [kind, setKind] = useState<ResourceKind>("link");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");

  const effective = useMemo(
    () => effectiveResourcesForIdea(ideaId, Object.values(ideas), Object.values(resources)),
    [ideaId, ideas, resources],
  );

  function resetForm() {
    setKind("link");
    setUrl("");
    setTitle("");
    setNote("");
    setFormOpen(false);
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    addResource("idea", ideaId, {
      kind,
      url: url.trim() || undefined,
      title: title.trim(),
      note: note.trim() || undefined,
    });
    resetForm();
    setExpanded(true);
  }

  return (
    <div className="px-8 pt-3 pb-1 shrink-0 border-b border-[var(--color-surface-3)]">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-text-faint hover:text-text-secondary transition-colors duration-150"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Resources{effective.length > 0 ? ` (${effective.length})` : ""}
      </button>

      {expanded && (
        <div className="pt-2 pb-3">
          <p className="text-[11px] text-text-faint mb-2">
            Reference material for this idea — sources, notes, and assets you&apos;re drawing from.
          </p>

          {effective.length > 0 && (
            <div className="space-y-1 mb-2">
              {effective.map(({ resource, inheritedFrom }) => (
                <div key={resource.id} className="group flex items-center gap-2 py-1">
                  {resource.kind === "link" && resource.url ? (
                    // Favicon is best-effort — a broken/blocked fetch just hides the img.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={faviconUrl(resource.url)}
                      alt=""
                      className="w-3.5 h-3.5 rounded-sm shrink-0"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  ) : (
                    <StickyNote size={12} className="text-text-faint shrink-0" />
                  )}

                  {resource.url ? (
                    <a
                      href={resource.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[12px] text-text-secondary hover:text-gold transition-colors duration-150 truncate"
                    >
                      {resource.title}
                      <ExternalLink size={9} className="shrink-0" />
                    </a>
                  ) : (
                    <span className="text-[12px] text-text-secondary truncate">{resource.title}</span>
                  )}

                  {resource.note && (
                    <span className="text-[11px] text-text-faint truncate">— {resource.note}</span>
                  )}

                  {inheritedFrom ? (
                    <span className="ml-auto shrink-0 text-[10px] text-text-faint bg-surface-2 px-1.5 py-0.5 rounded-[4px]">
                      from {inheritedFrom.title || "parent idea"}
                    </span>
                  ) : (
                    <button
                      onClick={() => removeResource(resource.id)}
                      className="ml-auto shrink-0 text-[10px] text-text-faint opacity-0 group-hover:opacity-100 hover:text-red transition-all duration-150"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {formOpen ? (
            <form onSubmit={handleAdd} className="flex flex-col gap-1.5 bg-surface-2/50 rounded-[var(--radius-default)] p-2.5">
              <div className="flex items-center gap-2">
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as ResourceKind)}
                  className="text-[11px] bg-surface-2 border border-border rounded-[4px] px-1.5 py-1 text-text-secondary outline-none"
                >
                  <option value="link">Link</option>
                  <option value="note">Note</option>
                  <option value="asset">Asset</option>
                </select>
                <input
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Title"
                  className="flex-1 text-[12px] bg-surface-2 border border-border rounded-[4px] px-2 py-1 text-text-primary placeholder:text-text-faint outline-none"
                />
              </div>
              {kind !== "note" && (
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://..."
                  className="text-[12px] bg-surface-2 border border-border rounded-[4px] px-2 py-1 text-text-primary placeholder:text-text-faint outline-none"
                />
              )}
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Comment (optional)"
                className="text-[12px] bg-surface-2 border border-border rounded-[4px] px-2 py-1 text-text-primary placeholder:text-text-faint outline-none"
              />
              <p className="text-[10px] text-text-faint">Attached here, this idea&apos;s child ideas and pieces will see it too.</p>
              <div className="flex items-center gap-2 mt-0.5">
                <button
                  type="submit"
                  disabled={!title.trim()}
                  className="text-[11px] text-gold hover:text-gold/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
                >
                  Add resource
                </button>
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-[11px] text-text-faint hover:text-text-secondary transition-colors duration-150"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => setFormOpen(true)}
              className="flex items-center gap-1 text-[11px] text-text-faint hover:text-text-secondary transition-colors duration-150"
            >
              <Plus size={10} />
              Add resource
            </button>
          )}
        </div>
      )}
    </div>
  );
}
