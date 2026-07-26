"use client";

import { useCallback } from "react";
import { useDataStore } from "@/stores/data-store";
import { useContentStore } from "@/stores/content-store";
import { useLabelSnippet } from "@/hooks/use-label-snippet";

/**
 * Labels a snippet with whatever context its home has.
 *
 * A snip off a draft gets the draft's text and goal, as it always did. A snip
 * off a short-form piece has no draft behind it, so the idea's summary and
 * title stand in — thin context, but the alternative (labelling against a
 * note the snippet has nothing to do with) reads worse than a plain label.
 */
export function useSnipLabeler() {
  const { labelSnippet } = useLabelSnippet();
  const notes = useDataStore((s) => s.notes);
  const ideas = useContentStore((s) => s.ideas);

  return useCallback(
    (
      snippetId: string,
      content: string,
      home: { noteId: string | null; ideaId?: string },
    ) => {
      const note = home.noteId ? notes[home.noteId] : null;
      if (note) {
        labelSnippet(snippetId, content, note.content, note.goal, note.id);
        return;
      }
      const idea = home.ideaId ? ideas[home.ideaId] : null;
      labelSnippet(snippetId, content, idea?.summary ?? "", idea?.title ?? "");
    },
    [labelSnippet, notes, ideas],
  );
}
