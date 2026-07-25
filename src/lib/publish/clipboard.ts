import { markdownToCleanHtml, markdownToPlainText } from "./markdown";
import type { PublishPlatform } from "./platform";

export interface ClipboardPayload {
  /** Rich HTML flavor. Omitted for platforms that must paste as plain text
   * only (linkedin, tweet) — copyForPlatform falls back to writeText for
   * those instead of building a ClipboardItem. */
  html?: string;
  /** Plain-text flavor. Always present. */
  text: string;
}

/**
 * Builds the {html, text} pair `copyForPlatform` writes to the clipboard.
 * Pure and framework-free — no `navigator`/DOM access — so it's the part of
 * this module that's unit-tested directly.
 *
 * - substack: html is the payload (rich paste preserves headings/bold/
 *   links/lists); text is a markdown-stripped plain fallback.
 * - linkedin: plain text IS the payload, byte-for-byte `content` — no html
 *   flavor, and deliberately no markdown-to-unicode-bold conversion
 *   (screen readers can't parse unicode "bold" glyphs as bold).
 * - tweet: plain text IS `content`, completely unchanged — not even
 *   trimmed. Whitespace (blank lines, trailing spaces) is part of what the
 *   author wrote and must round-trip exactly.
 * - html: generic clean-HTML export, same treatment as substack.
 */
export function buildClipboardPayload(content: string, platform: PublishPlatform): ClipboardPayload {
  switch (platform) {
    case "tweet":
    case "linkedin":
      return { text: content };
    case "substack":
    case "html":
      return { html: markdownToCleanHtml(content), text: markdownToPlainText(content) };
    default: {
      const exhaustiveCheck: never = platform;
      throw new Error(`buildClipboardPayload: unsupported platform ${String(exhaustiveCheck)}`);
    }
  }
}

/**
 * Writes `content` to the clipboard in the flavor(s) appropriate for
 * `platform`, using the dual-flavor `navigator.clipboard.write([...])` API
 * when an HTML flavor applies, falling back to `writeText` (both as the
 * primary path for text-only platforms, and if `write` throws/is
 * unavailable).
 *
 * IMPORTANT: must be invoked synchronously from a user-gesture event
 * handler (click, keydown, etc). Browsers only grant clipboard-write
 * permission inside the call stack of a trusted user gesture — if this is
 * called after an `await` (e.g. inside a `.then()` chain kicked off by a
 * gesture but resolved later), Chrome/Firefox will silently reject and
 * Safari is stricter still: it requires each `ClipboardItem` value to be a
 * `Promise<Blob>` (not a resolved `Blob`) precisely so it can keep the
 * write pending until the async work settles while staying attributed to
 * the gesture. Since `buildClipboardPayload` is synchronous today this
 * function passes resolved `Blob`s (matching the pattern already used in
 * src/lib/export.ts's `copyAsHtml`) — if this ever wraps an async payload
 * builder, switch the ClipboardItem values to Promises for Safari.
 */
export async function copyForPlatform(content: string, platform: PublishPlatform): Promise<void> {
  const payload = buildClipboardPayload(content, platform);

  if (payload.html !== undefined) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([payload.html], { type: "text/html" }),
          "text/plain": new Blob([payload.text], { type: "text/plain" }),
        }),
      ]);
      return;
    } catch {
      // Fall through to the plain-text fallback below (older browsers,
      // permission denial, or a platform without ClipboardItem support).
    }
  }

  try {
    await navigator.clipboard.writeText(payload.text);
  } catch {
    // Clipboard access unavailable/denied. Callers own surfacing this to
    // the user (e.g. a toast) — this function intentionally doesn't throw
    // so a denied clipboard permission never crashes a copy button handler.
  }
}
