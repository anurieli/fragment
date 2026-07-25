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
 * Free-scroll feed of pieces at the editor's 720px measure. Borderless
 * cards separated by hairline PieceSeparators (also the Snip Bar drop
 * target — see piece-separator.tsx). When the active idea has children,
 * a piece whose ideaId differs from the root gets a subtle section header
 * above the run of pieces it belongs to (the "rolled up" child ideas from
 * hierarchyRollup — see shortform-view.tsx).
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
    <div className="max-w-[720px] mx-auto w-full pb-24">
      <PieceSeparator ideaId={rootIdeaId} insertOrder={insertOrderBetween(undefined, pieces[0])} />
      {pieces.map((piece, index) => {
        const showHeader = piece.ideaId !== rootIdeaId && piece.ideaId !== lastOwnerId;
        lastOwnerId = piece.ideaId;
        const childIdea = showHeader ? ideas[piece.ideaId] : null;

        return (
          <div key={piece.id}>
            {childIdea && (
              <div className="px-5 pt-4 pb-1">
                <span className="text-[10px] uppercase tracking-wider text-text-faint font-[family-name:var(--font-mono)]">
                  {childIdea.title || "Untitled idea"}
                </span>
              </div>
            )}
            <PieceCard
              piece={piece}
              now={now}
              focused={index === focusedIndex}
              editing={editing && index === focusedIndex}
              onFocusCard={() => onFocusCard(index)}
              onEnterEdit={onEnterEdit}
              onExitEdit={onExitEdit}
              onDelete={() => onDelete(piece)}
            />
            <PieceSeparator
              ideaId={rootIdeaId}
              insertOrder={insertOrderBetween(piece, pieces[index + 1])}
            />
          </div>
        );
      })}
    </div>
  );
}
