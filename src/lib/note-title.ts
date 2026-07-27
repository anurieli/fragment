/**
 * Pure helpers behind the note header's "generate title" button (ARI-45).
 * No Zustand, no React, same convention as src/lib/piece-ai.ts, so the
 * sanitising a generated title goes through stays unit-testable without
 * mocking the AI hooks.
 */

/**
 * Longest title we keep. Mirrors the 80-character cap onboarding already uses
 * when it derives a title from the first line of pasted text
 * (onboarding-flow.tsx), so a generated title can never be longer than one
 * the app writes for you elsewhere.
 */
export const MAX_TITLE_CHARS = 80;

/**
 * How much of the draft is sent as title context. A title comes from what the
 * piece is about, which the opening carries; the cap keeps a long essay from
 * turning one button press into a max-context request.
 */
export const MAX_TITLE_CONTEXT_CHARS = 6000;

/** The slice of the draft the title prompt sees. */
export function titleContext(content: string): string {
  return content.trim().slice(0, MAX_TITLE_CONTEXT_CHARS);
}

/** Wrapping characters a model reaches for when it "returns only the title". */
const WRAPPERS = /^[\s"'“”‘’«»*_#]+|[\s"'“”‘’«»*_]+$/g;

/**
 * Turns a raw completion into something that belongs in the title field.
 * Models answer this prompt with a heading, a quoted string, a "Title:"
 * prefix, or a whole sentence with a full stop, however plainly the prompt
 * asks for none of that, and every one of those lands in a field the user
 * reads as their own typing. Returns "" when nothing usable is left, which
 * the caller treats as a failed generation rather than an empty title.
 */
export function cleanGeneratedTitle(raw: string): string {
  const firstLine = (raw ?? "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return "";

  let title = firstLine.replace(/^(?:title|headline)\s*[:—-]\s*/i, "");

  // Strip wrappers repeatedly: **"Like this"** needs more than one pass.
  let previous = "";
  while (title !== previous) {
    previous = title;
    title = title.replace(WRAPPERS, "").trim();
  }

  title = title.replace(/\s+/g, " ").replace(/[.,;:]+$/, "").trim();
  if (title.length <= MAX_TITLE_CHARS) return title;

  // Cut on a word boundary rather than mid-word.
  const cut = title.slice(0, MAX_TITLE_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}
