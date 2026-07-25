// One-click publish to Kit (formerly ConvertKit) — ARI-164.
//
// Kit v4 API: POST https://api.kit.com/v4/broadcasts, header
// `X-Kit-Api-Key: <key>`, JSON body `{ subject, content, preview_text?,
// public?, send_at? }`. `send_at` omitted/null creates a DRAFT; an
// ISO-8601 `send_at` schedules the broadcast; `public: true` also
// publishes it to Kit's web feed. Rate limit: 120 requests / 60s.
//
// This module owns two things: a pure request builder
// (`buildKitBroadcastRequest`, no network — unit-tested directly) and the
// network call itself (`createKitBroadcast`, uses `codexFetch` from
// `platform-fetch.ts` so it works unchanged from the Tauri desktop build).

import { codexFetch } from "@/lib/platform-fetch";
import type { ContentFormat } from "@/lib/content-engine/contract";

const KIT_BROADCASTS_URL = "https://api.kit.com/v4/broadcasts";

// Kit doesn't publish a fixed subject-line limit for broadcasts; 80 is
// Fragment's own cap so the derived subject stays readable in an inbox
// preview and in Fragment's own toasts.
const SUBJECT_MAX_LEN = 80;

// Formats a "Publish to Kit" / "Schedule on Kit" action makes sense for.
// Kit broadcasts are long-form email content, so short-form
// social-composer formats (tweet, linkedin) and scripts are excluded —
// mirrors the ARI-164 spec's format gate.
const KIT_ELIGIBLE_FORMATS: readonly ContentFormat[] = ["substack", "essay", "other"];

export interface CreateKitBroadcastOptions {
  apiKey: string;
  subject: string;
  /** Full HTML body — pass the output of `markdownToCleanHtml`. */
  contentHtml: string;
  previewText?: string;
  /** Epoch ms. Omitted = draft (no `send_at` sent at all). Present = scheduled. */
  sendAt?: number;
  /** Also publishes the broadcast to Kit's public web feed. */
  publicPost?: boolean;
}

export interface KitBroadcastRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface KitBroadcastResult {
  id: string;
  /**
   * Best-effort deep link to the broadcast's edit page in Kit's dashboard,
   * built from the broadcast id (`https://app.kit.com/broadcasts/<id>`).
   * The v4 API response does not include this URL, and Kit does not
   * document it as a stable contract — this matches the URL shape Kit's
   * own dashboard used as of July 2026, but treat it as a convenience
   * link, not a guarantee. If Kit changes its dashboard routing this link
   * may 404 even though the broadcast itself was created successfully.
   */
  url: string;
}

/**
 * Pure request-builder for `POST /v4/broadcasts` — no network access, so
 * the draft-vs-scheduled shape, the ISO conversion, and the header are all
 * unit-testable without mocking fetch. `createKitBroadcast` is the only
 * caller that actually sends this.
 */
export function buildKitBroadcastRequest(opts: CreateKitBroadcastOptions): KitBroadcastRequest {
  const body: Record<string, unknown> = {
    subject: opts.subject,
    content: opts.contentHtml,
  };
  if (opts.previewText !== undefined) body.preview_text = opts.previewText;
  if (opts.publicPost !== undefined) body.public = opts.publicPost;
  // send_at omitted entirely (not `null`) for drafts — Kit's own docs treat
  // "field absent" and "field null" as equivalent for this endpoint, and
  // omitting keeps the draft-request body minimal.
  if (opts.sendAt !== undefined) body.send_at = new Date(opts.sendAt).toISOString();

  return {
    url: KIT_BROADCASTS_URL,
    headers: {
      "X-Kit-Api-Key": opts.apiKey,
      "Content-Type": "application/json",
    },
    body,
  };
}

export type KitErrorKind = "invalid_key" | "rate_limited" | "validation" | "network" | "unknown";

export class KitApiError extends Error {
  readonly status: number;
  readonly kind: KitErrorKind;

  constructor(message: string, status: number, kind: KitErrorKind) {
    super(message);
    this.name = "KitApiError";
    this.status = status;
    this.kind = kind;
  }
}

function extractKitErrorDetail(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const root = body as Record<string, unknown>;
  if (typeof root.message === "string" && root.message.trim()) return root.message.trim();
  if (typeof root.error === "string" && root.error.trim()) return root.error.trim();
  if (Array.isArray(root.errors) && root.errors.length > 0) {
    const messages = root.errors
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).message === "string") {
          return (entry as Record<string, unknown>).message as string;
        }
        return undefined;
      })
      .filter((m): m is string => Boolean(m));
    if (messages.length > 0) return messages.join("; ");
  }
  return undefined;
}

function kitErrorKindFromStatus(status: number): KitErrorKind {
  if (status === 401 || status === 403) return "invalid_key";
  if (status === 429) return "rate_limited";
  if (status === 422) return "validation";
  return "unknown";
}

/**
 * Pure status/body -> readable-message mapping, independent of `fetch` so
 * 401/429/422 handling is unit-tested without a network mock. `body` is
 * the already-`JSON.parse`d response body (or `undefined` if parsing
 * failed / the body was empty).
 */
export function kitErrorMessage(status: number, body: unknown): string {
  const detail = extractKitErrorDetail(body);
  switch (kitErrorKindFromStatus(status)) {
    case "invalid_key":
      return "Kit rejected your API key — check your Kit API key in Settings.";
    case "rate_limited":
      return "Kit's rate limit (120 requests/minute) was hit — try again in a moment.";
    case "validation":
      return detail
        ? `Kit rejected the broadcast: ${detail}`
        : "Kit rejected the broadcast — check the title and content.";
    default:
      return detail ? `Kit error: ${detail}` : `Kit request failed (HTTP ${status}).`;
  }
}

/** Derives the broadcast edit deep link from a broadcast id. See the
 * caveat on `KitBroadcastResult.url`. */
function kitBroadcastEditUrl(id: string): string {
  return `https://app.kit.com/broadcasts/${id}`;
}

function extractBroadcastId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const root = payload as Record<string, unknown>;
  const broadcast =
    root.broadcast && typeof root.broadcast === "object"
      ? (root.broadcast as Record<string, unknown>)
      : root;
  const id = broadcast.id;
  if (typeof id === "string" && id) return id;
  if (typeof id === "number") return String(id);
  return undefined;
}

/**
 * Creates a broadcast on Kit via `POST /v4/broadcasts`. Draft (no
 * `sendAt`) or scheduled (`sendAt` set) is entirely determined by
 * `opts.sendAt` — see `buildKitBroadcastRequest`. Throws `KitApiError` on
 * any non-2xx response or network failure, with a message already safe to
 * show a user (surface it directly in a toast).
 */
export async function createKitBroadcast(opts: CreateKitBroadcastOptions): Promise<KitBroadcastResult> {
  const { url, headers, body } = buildKitBroadcastRequest(opts);

  let response: Response;
  try {
    response = await codexFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    throw new KitApiError("Couldn't reach Kit — check your connection and try again.", 0, "network");
  }

  const rawBody = await response.text();
  let parsed: unknown;
  try {
    parsed = rawBody ? JSON.parse(rawBody) : undefined;
  } catch {
    parsed = undefined;
  }

  if (!response.ok) {
    throw new KitApiError(kitErrorMessage(response.status, parsed), response.status, kitErrorKindFromStatus(response.status));
  }

  const id = extractBroadcastId(parsed);
  if (!id) {
    throw new KitApiError("Kit created the broadcast but didn't return an id.", response.status, "unknown");
  }

  return { id, url: kitBroadcastEditUrl(id) };
}

function firstNonEmptyLine(text: string): string {
  for (const rawLine of text.split(/\r?\n/)) {
    // Strip a leading markdown heading marker so "# My Title" derives the
    // same subject as a piece titled "My Title".
    const line = rawLine.replace(/^#{1,6}\s+/, "").trim();
    if (line) return line;
  }
  return "";
}

/**
 * Derives a broadcast subject: the piece/note title if set, otherwise the
 * first non-empty line of the body, truncated to 80 characters (an
 * ellipsis replaces the last character when truncated, so the result
 * never exceeds the cap).
 */
export function deriveKitSubject(title: string | undefined, body: string): string {
  const source = title?.trim() || firstNonEmptyLine(body);
  if (source.length <= SUBJECT_MAX_LEN) return source;
  return `${source.slice(0, SUBJECT_MAX_LEN - 1).trimEnd()}…`;
}

/** Whether `format` is one of the long-form-ish formats Kit publish
 * actions apply to (substack, essay, other) — tweet/linkedin/script never
 * show a Kit action. */
export function isKitEligibleFormat(format: ContentFormat): boolean {
  return KIT_ELIGIBLE_FORMATS.includes(format);
}

/**
 * Pure eligibility gate for the "Publish to Kit" / "Schedule on Kit" share
 * actions: the piece's format must be Kit-eligible AND a non-blank Kit API
 * key must be on file. Takes the two scalars that actually decide this
 * (rather than the full `ContentPiece`/`AppSettings` objects) so it's
 * trivial to unit test and to call from both `piece-share-menu.tsx` (piece
 * format) and `export-menu.tsx` (notes have no format — see
 * `isKitEligibleFormat` note in each caller).
 */
export function canPublishToKit(format: ContentFormat, kitApiKey: string | undefined): boolean {
  return isKitEligibleFormat(format) && Boolean(kitApiKey?.trim());
}
