import { MAX_TITLE_CHARS } from "./note-title";

/**
 * A title taken from the text itself.
 *
 * Used wherever the app has to name something the writer did not name: a note
 * migrated out of the standalone list, an idea captured from a highlighted
 * sentence mid-draft. The rule is the same in both places, which is the point
 * of it living here: two different derivations of "first line" would show a
 * writer two different names for the same words.
 *
 * Markdown decoration is stripped because the source is prose the writer was
 * in the middle of formatting, and a title reading "## The real point" is the
 * editor leaking into the sidebar.
 */
export function titleFromText(content: string): string {
  const line = content
    .split("\n")
    .map((raw) => raw.replace(/^#+\s*/, "").replace(/^[>*-]\s*/, "").trim())
    .find((candidate) => candidate.length > 0);
  if (!line) return "";

  const collapsed = line.replace(/\s+/g, " ");
  if (collapsed.length <= MAX_TITLE_CHARS) return collapsed;

  // Cut on a word boundary rather than mid-word, leaving room for the ellipsis
  // so the result never exceeds the cap the rest of the app uses.
  const cut = collapsed.slice(0, MAX_TITLE_CHARS - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const trimmed = (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trimEnd();
  return `${trimmed}…`;
}
