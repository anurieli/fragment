import markdownit from "markdown-it";
import { generateId } from "@/lib/utils";
import { preserveWhitespace } from "@/lib/publish/whitespace";
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
  const bodyHtml = md.render(preserveWhitespace(note.markdown ?? ""));

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

export interface HostedReviewPageOptions extends BuildReviewFileOptions {
  /** Stable id for this share, used as the autosave key across visits. */
  docId: string;
  /** Where "Send back" POSTs. Presence of this is what makes the page hosted. */
  submitUrl: string;
  /** Snapshot revision, echoed back on submit. */
  revision: number;
  /** Whether the reviewer may rewrite the text as well as comment on it. */
  allowEdits: boolean;
  /** This reviewer's name, if we already know it. */
  reviewerName?: string;
  /**
   * Only ever this reviewer's own comments. The type does not stop a caller
   * passing someone else's, so the single caller (src/app/r/[token]/route.ts)
   * sources them from `listCommentsForGuest`, which cannot return another
   * guest's rows.
   */
  initialComments?: Array<{
    id: string;
    anchorText: string;
    prefix: string;
    suffix: string;
    body: string;
  }>;
}

/**
 * The same review page, served over HTTP instead of emailed as a file.
 *
 * Shares every line of the offline version except the last step: comments go
 * back over fetch rather than through a downloaded JSON file and a mailto.
 * Keeping one template means the anchoring, the selection popup and the
 * autosave cannot drift apart between the two ways in.
 */
export function buildHostedReviewPage(
  note: ReviewNoteInput,
  opts: HostedReviewPageOptions,
): string {
  const title = note.title.trim() || "Untitled";

  return renderReviewTemplate({
    docId: opts.docId,
    title,
    titleHtml: escapeHtml(title),
    authorName: opts.authorName?.trim() ?? "",
    authorEmail: opts.authorEmail?.trim() ?? "",
    bodyHtml: md.render(preserveWhitespace(note.markdown ?? "")),
    filenameStem: sanitizeFilename(title),
    submitUrl: opts.submitUrl,
    revision: opts.revision,
    allowEdits: opts.allowEdits,
    reviewerName: opts.reviewerName,
    initialComments: opts.initialComments,
  });
}
