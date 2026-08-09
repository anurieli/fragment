"use client";

import { useCallback } from "react";
import { useContentStore } from "@/stores/content-store";
import { useLabelSnippet } from "@/hooks/use-label-snippet";
import { briefForPiece } from "@/hooks/use-brief";

/**
 * Labels a snippet with whatever context its home has.
 *
 * A snip off a fragment gets that fragment's text and its resolved goal (its
 * own, else its idea's). A snip taken where
 * no single fragment owns it has none of that, so the idea's summary and title
 * stand in: thin context, but the alternative (labelling against a draft the
 * snippet has nothing to do with) reads worse than a plain label.
 */
export function useSnipLabeler() {
  const { labelSnippet } = useLabelSnippet();
  const pieces = useContentStore((s) => s.pieces);
  const ideas = useContentStore((s) => s.ideas);

  return useCallback(
    (
      snippetId: string,
      content: string,
      home: { pieceId: string | null; ideaId?: string },
    ) => {
      const piece = home.pieceId ? pieces[home.pieceId] : null;
      if (piece) {
        labelSnippet(snippetId, content, piece.body, briefForPiece(piece).brief.goal, piece.id);
        return;
      }
      const idea = home.ideaId ? ideas[home.ideaId] : null;
      labelSnippet(snippetId, content, idea?.summary ?? "", idea?.title ?? "");
    },
    [labelSnippet, pieces, ideas],
  );
}
