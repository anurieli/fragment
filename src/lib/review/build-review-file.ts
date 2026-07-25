import markdownit from "markdown-it";
import { generateId } from "@/lib/utils";
import { renderReviewTemplate, escapeHtml } from "./template";

// Same options used for the app's other markdown -> HTML preview path
// (src/components/editor/slash-node-view.tsx): html disabled so arbitrary
// markup in the note can never leak into the standalone file unescaped.
const md = markdownit({ html: false, linkify: true, breaks: false });

export interface ReviewNoteInput {
  title: string;
  markdown: string;
}

export interface BuildReviewFileOptions {
  authorName?: string;
  authorEmail?: string;
}

function sanitizeFilename(title: string): string {
  const name = title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  return name || "untitled";
}

/**
 * Builds a self-contained review HTML page for `note` — the file "Send for
 * review" downloads. The returned string embeds the rendered document, a
 * freshly generated `docId`, and an inlined vanilla-JS review UI (comment
 * highlighting, autosave, "Send back"). No network requests are made by the
 * generated page.
 */
export function buildReviewFile(note: ReviewNoteInput, opts: BuildReviewFileOptions = {}): string {
  const docId = generateId();
  const title = note.title.trim() || "Untitled";
  const bodyHtml = md.render(note.markdown ?? "");

  return renderReviewTemplate({
    docId,
    title,
    titleHtml: escapeHtml(title),
    authorName: opts.authorName?.trim() ?? "",
    authorEmail: opts.authorEmail?.trim() ?? "",
    bodyHtml,
    filenameStem: sanitizeFilename(title),
  });
}

/** Filename `buildReviewFile`'s output should be downloaded as. */
export function reviewFileName(title: string): string {
  return `${sanitizeFilename(title)}.review.html`;
}
