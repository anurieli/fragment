"use client";

import type { ContentPiece, Idea } from "@/lib/content-engine";
import { PieceCard } from "./piece-card";
import { PieceSeparator } from "./piece-separator";

interface ShortformFeedProps {
  rootIdeaId: string;
  pieces: readonly ContentPiece[];
  ideas: Record<string, Idea>;
  now: number;
  focusedIndex: number;
  editing: boolean;
  onFocusCard: (index: number) => void;
  onEnterEdit: () => void;
  onExitEdit: () => void;
  onDelete: (piece: ContentPiece) => void;
}

function insertOrderBetween(before: ContentPiece | undefined, after: ContentPiece | undefined): number {
  if (before && after) return (before.order + after.order) / 2;
  if (before) return before.order + 1;
  if (after) return after.order - 1;
  return 0;
}

/**
 * The feed as a deck of pages rather than one long scroll: each piece fills
 * the viewport at the editor's 720px measure, and the container snaps a page
 * at a time (`snap-y snap-mandatory`, `snap-always` so a fast flick can't skip
 * one). Long pieces scroll inside their own page — the piece's meta row and
 * footer stay pinned while its text moves — and running off the end of that
 * inner scroll chains outward and snaps to the next piece. Reading one piece
 * therefore never drags the next one halfway into frame, which is what made
 * the old continuous feed hard to read.
 *
 * Each page still ends with a PieceSeparator: invisible in normal use, it's
 * the Snip Bar's drop target for creating a piece at that position (see
 * piece-separator.tsx).
 *
 * When the active idea has children, a piece whose ideaId differs from the
 * root gets a subtle section header above the run of pieces it belongs to
 * (the "rolled up" child ideas from hierarchyRollup — see shortform-view.tsx).
 */
export function ShortformFeed({
  rootIdeaId,
  pieces,
  ideas,
  now,
  focusedIndex,
  editing,
  onFocusCard,
  onEnterEdit,
  onExitEdit,
  onDelete,
}: ShortformFeedProps) {
  let lastOwnerId: string | null = null;

  return (
    <div className="max-w-[720px] mx-auto w-full h-full">
      {pieces.map((piece, index) => {
        const showHeader = piece.ideaId !== rootIdeaId && piece.ideaId !== lastOwnerId;
        lastOwnerId = piece.ideaId;
        const childIdea = showHeader ? ideas[piece.ideaId] : null;

        return (
          <section
            key={piece.id}
            data-piece-page
            className="snap-start snap-always h-full flex flex-col min-h-0 pb-2"
          >
            {childIdea && (
              <div className="shrink-0 px-5 pt-2 pb-1">
                <span className="text-[10px] uppercase tracking-wider text-text-faint font-[family-name:var(--font-mono)]">
                  {childIdea.title || "Untitled idea"}
                </span>
              </div>
            )}
            <div className="flex-1 min-h-0">
              <PieceCard
                piece={piece}
                now={now}
                focused={index === focusedIndex}
                editing={editing && index === focusedIndex}
                position={index + 1}
                total={pieces.length}
                onFocusCard={() => onFocusCard(index)}
                onEnterEdit={onEnterEdit}
                onExitEdit={onExitEdit}
                onDelete={() => onDelete(piece)}
              />
            </div>
            <PieceSeparator
              ideaId={rootIdeaId}
              insertOrder={insertOrderBetween(piece, pieces[index + 1])}
            />
          </section>
        );
      })}
    </div>
  );
}
