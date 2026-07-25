// LinkedIn's "little text" markup (used by its Posts/Notify write APIs, the
// future Composio publish path referenced in ARI-152) treats these
// characters as reserved. Left unescaped, an unmatched `(` or `)` in
// particular is known to silently truncate the rest of the post rather
// than erroring, so every reserved character is backslash-escaped
// defensively, not just parens.
const LINKEDIN_RESERVED_CHARS = new Set([
  "\\",
  "|",
  "{",
  "}",
  "@",
  "[",
  "]",
  "(",
  ")",
  "<",
  ">",
  "#",
  "*",
  "_",
  "~",
]);

/**
 * Backslash-escapes every LinkedIn little-text reserved character
 * (`\ | { } @ [ ] ( ) < > # * _ ~`) in `text`.
 *
 * NOT idempotent by design: escaping already-escaped text re-escapes the
 * backslashes the first pass introduced (`\(` becomes `\\\(`), so calling
 * this twice on the same string double-escapes it. Callers must escape
 * exactly once, on raw unescaped input, right before sending to the
 * LinkedIn API — never on text that may have already passed through here.
 */
export function escapeLinkedInReserved(text: string): string {
  let result = "";
  for (const char of text) {
    result += LINKEDIN_RESERVED_CHARS.has(char) ? `\\${char}` : char;
  }
  return result;
}
