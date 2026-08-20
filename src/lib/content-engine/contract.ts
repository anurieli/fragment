import { z } from "zod";

// The Content Engine contract. Every field here is a public commitment shared
// by the Dexie store, the local ingress API, fragment-mcp, and the future
// hosted API (M2). Version bumps are additive; breaking changes require a new
// `fragment` version handled side by side.

export const CONTRACT_VERSION = 1;

export const CONTENT_FORMATS = [
  "linkedin",
  "tweet",
  "substack",
  "essay",
  "script",
  "other",
] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];

// Formats whose natural home is the long-form editor rather than a feed card.
// This is about *shape* and nothing else: every fragment stores its text the
// same way (`body`), so format decides which surface edits it, never where the
// words live. A fragment in one of these formats is what the UI calls a draft;
// changing its format moves it between the editor and the feed without touching
// a byte of its text.
export const LONGFORM_FORMATS = ["essay", "substack", "script"] as const;

export function isLongformFormat(format: ContentFormat): boolean {
  return (LONGFORM_FORMATS as readonly ContentFormat[]).includes(format);
}

export const PIECE_STATUSES = [
  "inbox",
  "in-progress",
  "ready",
  "published",
] as const;
export type PieceStatus = (typeof PIECE_STATUSES)[number];

export const PIECE_ORIGINS = ["agent", "user"] as const;
export type PieceOrigin = (typeof PIECE_ORIGINS)[number];

export const PIECE_REVIEW_QUEUES = ["extraction"] as const;
export type PieceReviewQueue = (typeof PIECE_REVIEW_QUEUES)[number];

// 0 = none, 1 = urgent, 2 = high, 3 = medium, 4 = low (Linear convention).
export type Priority = 0 | 1 | 2 | 3 | 4;

export const RESOURCE_OWNER_TYPES = ["idea", "piece"] as const;
export type ResourceOwnerType = (typeof RESOURCE_OWNER_TYPES)[number];

export const RESOURCE_KINDS = ["link", "note", "asset"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

// "kit" (ARI-164): a broadcast created via Kit's (formerly ConvertKit) v4
// API — see src/lib/publish/kit.ts. Additive to the contract; existing
// "composio" | "copy" | "manual" values are unaffected.
export const PUBLISH_METHODS = ["composio", "copy", "manual", "kit"] as const;
export type PublishMethod = (typeof PUBLISH_METHODS)[number];

export interface AgentMeta {
  agent: string;
  model?: string;
  // When the piece was pushed into Fragment (epoch ms). Refines createdAt for
  // agent pieces; createdAt stays the canonical age timestamp.
  pushedAt: number;
  // Append-only conflict model: a re-drafted piece arrives as a NEW piece
  // pointing at the one it replaces, never as an in-place overwrite.
  supersedes?: string;
}

export interface PublishRecord {
  platform: ContentFormat;
  method: PublishMethod;
  publishedAt: number;
  url?: string;
  // False while awaiting go-live confirmation (e.g. Substack RSS check).
  verified: boolean;
}

export interface Idea {
  id: string;
  title: string;
  summary?: string;
  // Single-level nesting: a child idea's parent must itself be a root idea
  // (max depth 2, enforced at write time — see assertIdeaParentAllowed).
  parentId: string | null;
  priority: Priority;
  pinnedAt?: number;
  voiceId?: string;
  // The idea's writing brief: the middle tier between the voice's defaults and
  // a single fragment's own. An idea aimed somewhere other than your usual
  // audience says so once here rather than on every fragment inside it.
  // Resolution order and the empty-means-inherit rule live in
  // lib/brief-context.ts.
  goal?: string;
  audience?: string;
  tone?: string;
  remember?: string;
  origin: PieceOrigin;
  createdAt: number;
  updatedAt: number;
  // Put away, not thrown away. An archived idea drops out of the sidebar and
  // out of every count, and its pieces go with it, but the words are all
  // still there and one click brings the whole thing back. Distinct from
  // deletedAt on purpose: a tombstone says "this was a mistake", an archive
  // says "this is finished". Conflating them would mean the only way to tidy
  // the list is to tell the app you regret writing something.
  archivedAt?: number;
  deletedAt?: number;
}

export interface ContentPiece {
  id: string;
  ideaId: string;
  format: ContentFormat;
  status: PieceStatus;
  origin: PieceOrigin;
  // Internal generation never enters Inbox. It waits here until the writer
  // accepts it into active work or tosses it. Inbox stays reserved for
  // external arrivals such as MCP/API handoffs.
  reviewQueue?: PieceReviewQueue;
  title?: string;
  // A fragment's text, and the only place it ever lives. Required rather than
  // optional so "no words yet" is an empty string and never a missing field:
  // there is exactly one content home now, so the absent case would mean
  // nothing a reader could act on.
  body: string;
  // One-line dek under the title. Carried over from Note.subtitle.
  subtitle?: string;
  // The writing brief. Short-form fragments have never had one; long-form
  // fragments inherit theirs from the note they absorbed.
  goal?: string;
  audience?: string;
  tone?: string;
  remember?: string;
  // undefined = inherit the default voice, null = explicitly no voice, string =
  // a specific voice id. Three states, and the migration preserves all three.
  voiceId?: string | null;
  // The note this fragment's text came from. Set once by the migration and
  // never afterwards. Old share links, review threads and file backups are all
  // keyed by note id, so this is how they keep resolving.
  legacyNoteId?: string;
  seen: boolean;
  priority: Priority;
  // Held at the top of its idea's feed regardless of order or status. Ideas
  // have had this since the sidebar existed; pieces need it for the same
  // reason, which is that the one you keep coming back to should not sink
  // under the twenty you wrote after it. Drafts have no pin: an idea's drafts
  // are few and already listed by hand.
  pinnedAt?: number;
  order: number;
  scheduledAt?: number;
  publish?: PublishRecord;
  // Stamped when a "Publish to Substack" attempt fires (copy + open composer)
  // and cleared the moment the piece's status next changes (verified match,
  // manual mark-published, or any other status transition — see
  // content-store's setPieceStatus). While set and status isn't yet
  // "published", the piece is "pending" a Substack RSS verification match
  // (see src/lib/publish/substack-verify.ts's publishPendingState and
  // src/hooks/use-publish-verification.ts).
  publishAttemptedAt?: number;
  // When a published piece's text was first changed after it went live.
  //
  // Publishing closes a piece's text: the editor and the card go read-only and
  // say so, because what shipped is a fact and quietly rewriting it makes the
  // publish record a lie. But a typo is not a reason to duplicate a piece and
  // split its history, so "Edit anyway" unlocks it and this records that it
  // happened. Set once, by the first body change while published (see
  // updatePiece in content-store), and never cleared while the piece stays
  // published: the point is that the piece no longer matches what was
  // distributed, which one later edit does not undo.
  //
  // Undefined on a published piece means its text is still exactly what
  // shipped. Meaningless on an unpublished one, where it is always undefined.
  editedAfterPublishAt?: number;
  agentMeta?: AgentMeta;
  createdAt: number;
  updatedAt: number;
  // See Idea.archivedAt. Archiving an idea stamps its pieces too, so a piece
  // can be archived on its own or as part of its idea; unarchiving the idea
  // only lifts the stamps that idea put there (see restoreIdeaArchive).
  archivedAt?: number;
  deletedAt?: number;
}

export interface Resource {
  id: string;
  ownerType: ResourceOwnerType;
  ownerId: string;
  kind: ResourceKind;
  url?: string;
  title: string;
  note?: string;
  createdAt: number;
}

export class ContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(issues.length ? `${message}: ${issues.join("; ")}` : message);
    this.name = "ContractError";
    this.issues = issues;
  }
}

export function contractErrorFromZod(context: string, error: z.ZodError): ContractError {
  const issues = error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  return new ContractError(context, issues);
}

// ---------------------------------------------------------------------------
// Shared field schemas (single source; both wire formats reuse these)
// ---------------------------------------------------------------------------

const idSchema = z.string().min(1).max(64);

export const prioritySchema = z
  .number()
  .int()
  .min(0)
  .max(4)
  .transform((n): Priority => n as Priority);

// Wire timestamps arrive as ISO-8601 strings (frontmatter), epoch ms (JSON),
// or Date (YAML parsers that eagerly type timestamps). Canonical form: epoch ms.
export const timestampSchema = z
  .union([z.number(), z.string(), z.date()])
  .transform((value, ctx) => {
    if (typeof value === "number") {
      if (!Number.isInteger(value) || value <= 0) {
        ctx.addIssue({ code: "custom", message: "epoch ms must be a positive integer" });
        return z.NEVER;
      }
      return value;
    }
    const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
    if (Number.isNaN(parsed)) {
      ctx.addIssue({ code: "custom", message: `not a valid ISO-8601 date: ${String(value)}` });
      return z.NEVER;
    }
    return parsed;
  });

export const resourceInputSchema = z.object({
  kind: z.enum(RESOURCE_KINDS),
  url: z.string().min(1).optional(),
  title: z.string().min(1),
  note: z.string().optional(),
});
export type ResourceInput = z.infer<typeof resourceInputSchema>;

// A single line of a `<ideaId>/resources.jsonl` file (ARI-162): what
// fragment-mcp's `add_resource` tool appends, and what the agent-inbox
// importer reads back. `id` and `createdAt` are optional on the wire so a
// hand-written line still imports, but fragment-mcp itself always fills
// both — that's what makes re-importing the same file idempotent.
export const resourceLineSchema = z.object({
  id: idSchema.optional(),
  ownerType: z.enum(RESOURCE_OWNER_TYPES),
  ownerId: idSchema,
  kind: z.enum(RESOURCE_KINDS),
  url: z.string().min(1).optional(),
  title: z.string().min(1),
  note: z.string().optional(),
  createdAt: timestampSchema.optional(),
});
export type ResourceLine = z.infer<typeof resourceLineSchema>;

// An idea manifest (`<inboxDir>/<ideaId>/idea.json`): what fragment-mcp's
// `create_idea` tool writes, and what the agent-inbox importer reads back so
// a piece that references an agent-created `idea_id` can resolve. Additive
// within `fragment: 1` — the manifest existed since ARI-151; ingesting it is
// the new part. Tolerant on optionals so a hand-written manifest imports.
export const ideaFileSchema = z.object({
  id: idSchema,
  title: z.string().min(1),
  summary: z.string().optional(),
  parentId: idSchema.nullable().optional(),
  priority: prioritySchema.optional(),
  origin: z.enum(PIECE_ORIGINS).optional(),
  createdAt: timestampSchema.optional(),
  updatedAt: timestampSchema.optional(),
});
export type IdeaFile = z.infer<typeof ideaFileSchema>;

// ---------------------------------------------------------------------------
// Piece handoff: the canonical shape an agent submission normalizes into,
// whether it arrived as a frontmatter .md file or a JSON API body.
// ---------------------------------------------------------------------------

export interface PieceHandoff {
  fragment: typeof CONTRACT_VERSION;
  id?: string;
  ideaId?: string;
  ideaTitle?: string;
  ideaSummary?: string;
  format: ContentFormat;
  status: PieceStatus;
  origin: PieceOrigin;
  title?: string;
  body: string;
  priority: Priority;
  createdAt?: number;
  updatedAt?: number;
  scheduledAt?: number;
  agent?: string;
  model?: string;
  supersedes?: string;
  resources: ResourceInput[];
}

interface HandoffFields {
  fragment: number;
  id?: string;
  ideaId?: string;
  ideaTitle?: string;
  ideaSummary?: string;
  format: ContentFormat;
  status: PieceStatus;
  origin: PieceOrigin;
  title?: string;
  body: string;
  priority: Priority;
  createdAt?: number;
  updatedAt?: number;
  scheduledAt?: number;
  agent?: string;
  model?: string;
  supersedes?: string;
  resources: ResourceInput[];
}

function finalizeHandoff(fields: HandoffFields, ctx: z.RefinementCtx): PieceHandoff {
  if (fields.fragment !== CONTRACT_VERSION) {
    ctx.addIssue({
      code: "custom",
      path: ["fragment"],
      message: `unsupported contract version ${fields.fragment}; this build speaks fragment: ${CONTRACT_VERSION}`,
    });
    return z.NEVER as never;
  }
  if (!fields.ideaId && !fields.ideaTitle) {
    ctx.addIssue({
      code: "custom",
      message: "a piece must reference an idea: provide ideaId (idea_id) or ideaTitle (idea_title)",
    });
    return z.NEVER as never;
  }
  return { ...fields, fragment: CONTRACT_VERSION };
}

// JSON API body — camelCase keys. Used by the local ingress route now and the
// hosted API at M2.
export const pieceHandoffJsonSchema = z
  .object({
    fragment: z.number().int(),
    id: idSchema.optional(),
    ideaId: idSchema.optional(),
    ideaTitle: z.string().min(1).optional(),
    ideaSummary: z.string().optional(),
    format: z.enum(CONTENT_FORMATS),
    status: z.enum(PIECE_STATUSES).default("inbox"),
    origin: z.enum(PIECE_ORIGINS).default("agent"),
    title: z.string().optional(),
    body: z.string(),
    priority: prioritySchema.default(0),
    createdAt: timestampSchema.optional(),
    updatedAt: timestampSchema.optional(),
    scheduledAt: timestampSchema.optional(),
    agent: z.string().optional(),
    model: z.string().optional(),
    supersedes: idSchema.optional(),
    resources: z.array(resourceInputSchema).default([]),
  })
  .transform(finalizeHandoff);

// Frontmatter header — snake_case keys, ISO dates. The body of the .md file is
// attached by the frontmatter parser, byte-exact.
export const pieceHandoffFrontmatterSchema = z
  .object({
    fragment: z.number().int(),
    id: idSchema.optional(),
    idea_id: idSchema.optional(),
    idea_title: z.string().min(1).optional(),
    idea_summary: z.string().optional(),
    format: z.enum(CONTENT_FORMATS),
    status: z.enum(PIECE_STATUSES).default("inbox"),
    origin: z.enum(PIECE_ORIGINS).default("agent"),
    title: z.string().optional(),
    priority: prioritySchema.default(0),
    created_at: timestampSchema.optional(),
    updated_at: timestampSchema.optional(),
    scheduled_at: timestampSchema.optional(),
    agent: z.string().optional(),
    model: z.string().optional(),
    supersedes: idSchema.optional(),
    resources: z.array(resourceInputSchema).default([]),
  })
  .transform((raw, ctx) =>
    finalizeHandoff(
      {
        fragment: raw.fragment,
        id: raw.id,
        ideaId: raw.idea_id,
        ideaTitle: raw.idea_title,
        ideaSummary: raw.idea_summary,
        format: raw.format,
        status: raw.status,
        origin: raw.origin,
        title: raw.title,
        body: "",
        priority: raw.priority,
        createdAt: raw.created_at,
        updatedAt: raw.updated_at,
        scheduledAt: raw.scheduled_at,
        agent: raw.agent,
        model: raw.model,
        supersedes: raw.supersedes,
        resources: raw.resources,
      },
      ctx,
    ),
  );

export function parsePieceHandoffJson(input: unknown): PieceHandoff {
  const result = pieceHandoffJsonSchema.safeParse(input);
  if (!result.success) {
    throw contractErrorFromZod("invalid piece handoff (JSON)", result.error);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Stored-entity validation
// ---------------------------------------------------------------------------

export const contentPieceSchema = z.object({
  id: idSchema,
  ideaId: idSchema,
  format: z.enum(CONTENT_FORMATS),
  status: z.enum(PIECE_STATUSES),
  origin: z.enum(PIECE_ORIGINS),
  reviewQueue: z.enum(PIECE_REVIEW_QUEUES).optional(),
  title: z.string().optional(),
  body: z.string(),
  subtitle: z.string().optional(),
  goal: z.string().optional(),
  audience: z.string().optional(),
  tone: z.string().optional(),
  remember: z.string().optional(),
  voiceId: z.string().nullable().optional(),
  legacyNoteId: idSchema.optional(),
  seen: z.boolean(),
  priority: prioritySchema,
  pinnedAt: z.number().optional(),
  order: z.number(),
  scheduledAt: z.number().optional(),
  publishAttemptedAt: z.number().optional(),
  editedAfterPublishAt: z.number().optional(),
  publish: z
    .object({
      platform: z.enum(CONTENT_FORMATS),
      method: z.enum(PUBLISH_METHODS),
      publishedAt: z.number(),
      url: z.string().optional(),
      verified: z.boolean(),
    })
    .optional(),
  agentMeta: z
    .object({
      agent: z.string(),
      model: z.string().optional(),
      pushedAt: z.number(),
      supersedes: idSchema.optional(),
    })
    .optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  archivedAt: z.number().optional(),
  deletedAt: z.number().optional(),
}).superRefine((piece, ctx) => {
  if (piece.reviewQueue !== "extraction") return;
  if (piece.status !== "in-progress") {
    ctx.addIssue({ code: "custom", path: ["status"], message: "extraction review must stay in progress until accepted" });
  }
  if (piece.origin !== "user") {
    ctx.addIssue({ code: "custom", path: ["origin"], message: "extraction review is internal user-initiated work" });
  }
  if (isLongformFormat(piece.format)) {
    ctx.addIssue({ code: "custom", path: ["format"], message: "extraction review belongs in the short-form review feed" });
  }
  if (piece.publish !== undefined) {
    ctx.addIssue({ code: "custom", path: ["publish"], message: "extraction review cannot be published before acceptance" });
  }
});

// Max depth 2: a parent must itself be a root idea. Call before persisting any
// idea whose parentId is set.
export function assertIdeaParentAllowed(parent: Pick<Idea, "id" | "parentId" | "deletedAt">): void {
  if (parent.deletedAt !== undefined) {
    throw new ContractError(`parent idea ${parent.id} is deleted`);
  }
  if (parent.parentId !== null) {
    throw new ContractError(
      `idea ${parent.id} is already a child idea; ideas nest at most one level deep`,
    );
  }
}
