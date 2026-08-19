"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import type { ContentPiece } from "@/lib/content-engine";
import { useAppStore } from "@/stores/app-store";
import { useContentStore } from "@/stores/content-store";
import { hierarchyRollup, pinnedFirst, shortformOnly } from "@/stores/content-selectors";
import { visiblePieces } from "@/components/shortform/feed-logic";

const STATUS_LABELS: Record<ContentPiece["status"], string> = {
  inbox: "Inbox",
  "in-progress": "In progress",
  ready: "Ready",
  published: "Published",
};

function MobilePieceBody({
  piece,
  position,
  total,
}: {
  piece: ContentPiece;
  position: number;
  total: number;
}) {
  const updatePiece = useContentStore((state) => state.updatePiece);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.max(textarea.scrollHeight, 240)}px`;
  }, [piece.body]);

  return (
    <textarea
      ref={textareaRef}
      aria-label={`Piece ${position} of ${total}`}
      value={piece.body ?? ""}
      onChange={(event) => updatePiece(piece.id, { body: event.target.value })}
      placeholder="Write this piece..."
      rows={8}
      className="block w-full min-h-60 resize-none overflow-hidden bg-transparent text-[17px] leading-7 text-text-primary placeholder:text-text-faint outline-none"
    />
  );
}

export function MobilePieceEditor() {
  const ideas = useContentStore((state) => state.ideas);
  const pieces = useContentStore((state) => state.pieces);
  const activeIdeaId = useAppStore((state) => state.activeIdeaId);
  const setActiveIdea = useAppStore((state) => state.setActiveIdea);
  const setIdeaSpace = useAppStore((state) => state.setIdeaSpace);
  const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(() => activeIdeaId);
  const [currentPieceIndex, setCurrentPieceIndex] = useState(0);

  const availableIdeas = useMemo(
    () => pinnedFirst(Object.values(ideas)),
    [ideas],
  );
  const selectedIdea = selectedIdeaId ? ideas[selectedIdeaId] : undefined;
  const visible = useMemo(() => {
    if (!selectedIdeaId) return [];
    const rollup = shortformOnly(
      hierarchyRollup(selectedIdeaId, Object.values(ideas), Object.values(pieces)),
    );
    return visiblePieces(rollup, "all", "newest");
  }, [selectedIdeaId, ideas, pieces]);

  const selectIdea = useCallback((ideaId: string) => {
    setSelectedIdeaId(ideaId);
    setCurrentPieceIndex(0);
    setActiveIdea(ideaId);
    setIdeaSpace(ideaId, "pieces");
  }, [setActiveIdea, setIdeaSpace]);

  const showIdeaList = useCallback(() => {
    setSelectedIdeaId(null);
    setCurrentPieceIndex(0);
    setActiveIdea(null);
  }, [setActiveIdea]);

  const updateCurrentPiece = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const sections = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>("[data-mobile-piece]"),
    );
    if (sections.length === 0) return;

    const positionAnchor = 112;
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    sections.forEach((section, index) => {
      const distance = Math.abs(section.getBoundingClientRect().top - positionAnchor);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });
    setCurrentPieceIndex(closestIndex);
  }, []);

  if (!selectedIdea) {
    return (
      <main className="h-[100dvh] overflow-y-auto bg-bg px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
        <header className="mb-7">
          <p className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.2em] text-text-faint">
            Fragment
          </p>
          <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl text-text-primary">
            Ideas
          </h1>
          <p className="mt-2 text-sm text-text-muted">
            Pick one to read and edit its pieces.
          </p>
        </header>

        {availableIdeas.length === 0 ? (
          <p className="rounded-[var(--radius-lg)] border border-border bg-surface px-4 py-8 text-center text-sm text-text-faint">
            No ideas yet.
          </p>
        ) : (
          <div className="space-y-2">
            {availableIdeas.map((idea) => {
              const count = shortformOnly(
                hierarchyRollup(idea.id, Object.values(ideas), Object.values(pieces)),
              ).filter((piece) => piece.archivedAt === undefined).length;
              return (
                <button
                  key={idea.id}
                  onClick={() => selectIdea(idea.id)}
                  className="flex min-h-16 w-full items-center gap-4 rounded-[var(--radius-lg)] border border-border bg-surface px-4 py-3 text-left active:bg-surface-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-medium text-text-primary">
                      {idea.title || "Untitled idea"}
                    </span>
                    {idea.summary && (
                      <span className="mt-1 block line-clamp-1 text-[12px] text-text-muted">
                        {idea.summary}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-[family-name:var(--font-mono)] text-[11px] text-text-faint">
                    {count} {count === 1 ? "piece" : "pieces"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </main>
    );
  }

  const progressValue = visible.length === 0 ? 0 : currentPieceIndex + 1;
  const progressPercent = visible.length === 0 ? 0 : (progressValue / visible.length) * 100;

  return (
    <main
      data-testid="mobile-piece-scroll"
      onScroll={updateCurrentPiece}
      className="h-[100dvh] overflow-y-auto bg-bg"
    >
      <header className="sticky top-0 z-20 border-b border-border bg-bg/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            onClick={showIdeaList}
            aria-label="Back to ideas"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-text-muted active:bg-surface-2"
          >
            <ChevronLeft size={22} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-medium text-text-primary">
              {selectedIdea.title || "Untitled idea"}
            </h1>
            <p className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-wider text-text-faint">
              {visible.length === 0
                ? "No pieces"
                : `Piece ${progressValue} of ${visible.length}`}
            </p>
          </div>
        </div>
        {visible.length > 0 && (
          <div
            role="progressbar"
            aria-label="Current piece"
            aria-valuemin={1}
            aria-valuemax={visible.length}
            aria-valuenow={progressValue}
            className="mt-3 h-1 overflow-hidden rounded-full bg-surface-3"
          >
            <div
              className="h-full rounded-full bg-gold transition-[width] duration-150"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}
      </header>

      {visible.length === 0 ? (
        <div className="px-6 py-20 text-center">
          <p className="text-sm text-text-muted">This idea has no pieces yet.</p>
        </div>
      ) : (
        <div className="mx-auto max-w-xl">
          {visible.map((piece, index) => (
            <section
              key={piece.id}
              data-mobile-piece
              className="min-h-[calc(100dvh-6.5rem)] border-b border-border px-5 py-7"
            >
              <div className="mb-5 flex items-center gap-2 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-wider text-text-faint">
                <span>{piece.format}</span>
                <span aria-hidden>·</span>
                <span>{STATUS_LABELS[piece.status]}</span>
              </div>
              <MobilePieceBody
                piece={piece}
                position={index + 1}
                total={visible.length}
              />
              <div className="mt-6 flex justify-end">
                <span className="font-[family-name:var(--font-mono)] text-[10px] text-text-faint">
                  {(piece.body ?? "").length} chars
                </span>
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
