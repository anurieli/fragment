import {
  type ContentPiece,
  type Idea,
  type PieceHandoff,
  type Resource,
  type ResourceOwnerType,
} from "./contract";

// Pure import rules. No clocks, no ids, no storage: callers inject `now` and
// `generateId` so the same functions run in the app, the ingress route, tests,
// and the future hosted importer.

export interface ImportContext {
  now: number;
  generateId: () => string;
}

// Match an incoming handoff to an existing idea: by id first, then by
// normalized title. Deleted ideas never match — a re-push after deletion
// creates a fresh idea rather than resurrecting a tombstone.
export function matchIdea(
  handoff: Pick<PieceHandoff, "ideaId" | "ideaTitle">,
  ideas: readonly Idea[],
): Idea | undefined {
  const live = ideas.filter((idea) => idea.deletedAt === undefined);
  if (handoff.ideaId) {
    return live.find((idea) => idea.id === handoff.ideaId);
  }
  if (handoff.ideaTitle) {
    const wanted = normalizeTitle(handoff.ideaTitle);
    return live.find((idea) => normalizeTitle(idea.title) === wanted);
  }
  return undefined;
}

export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

export function buildIdeaFromHandoff(handoff: PieceHandoff, ctx: ImportContext): Idea {
  if (!handoff.ideaTitle) {
    // The contract schemas guarantee ideaId or ideaTitle; reaching here with
    // neither (or with an ideaId that matched nothing) is a caller bug.
    throw new Error(
      handoff.ideaId
        ? `idea ${handoff.ideaId} does not exist; agents may only create ideas by title`
        : "cannot create an idea without a title",
    );
  }
  return {
    id: ctx.generateId(),
    title: handoff.ideaTitle.trim(),
    summary: handoff.ideaSummary,
    parentId: null,
    priority: 0,
    origin: handoff.origin,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
}

export function handoffToPiece(
  handoff: PieceHandoff,
  opts: ImportContext & { ideaId: string; order: number },
): ContentPiece {
  const createdAt = handoff.createdAt ?? opts.now;
  const piece: ContentPiece = {
    id: handoff.id ?? opts.generateId(),
    ideaId: opts.ideaId,
    format: handoff.format,
    status: handoff.status,
    origin: handoff.origin,
    title: handoff.title,
    body: handoff.body,
    seen: false,
    priority: handoff.priority,
    order: opts.order,
    scheduledAt: handoff.scheduledAt,
    createdAt,
    updatedAt: handoff.updatedAt ?? createdAt,
  };
  if (handoff.origin === "agent") {
    piece.agentMeta = {
      agent: handoff.agent ?? "unknown",
      model: handoff.model,
      pushedAt: opts.now,
      supersedes: handoff.supersedes,
    };
  }
  return piece;
}

export function buildResources(
  handoff: PieceHandoff,
  owner: { type: ResourceOwnerType; id: string },
  ctx: ImportContext,
): Resource[] {
  return handoff.resources.map((input) => ({
    id: ctx.generateId(),
    ownerType: owner.type,
    ownerId: owner.id,
    kind: input.kind,
    url: input.url,
    title: input.title,
    note: input.note,
    createdAt: ctx.now,
  }));
}

export type UpsertAction =
  | { action: "insert" }
  | { action: "update" }
  | { action: "skip"; reason: "local-newer" | "unchanged" | "local-deleted" };

// Upsert by id, last-write-wins on updatedAt. A local piece that is newer than
// the incoming one is NEVER overwritten — the agent's copy is stale and the
// user's edits win. Equal timestamps are treated as an idempotent re-import.
export function resolvePieceUpsert(
  incoming: Pick<ContentPiece, "updatedAt">,
  existing: Pick<ContentPiece, "updatedAt" | "deletedAt"> | undefined,
): UpsertAction {
  if (existing === undefined) return { action: "insert" };
  if (existing.deletedAt !== undefined) return { action: "skip", reason: "local-deleted" };
  if (existing.updatedAt > incoming.updatedAt) return { action: "skip", reason: "local-newer" };
  if (existing.updatedAt === incoming.updatedAt) return { action: "skip", reason: "unchanged" };
  return { action: "update" };
}
