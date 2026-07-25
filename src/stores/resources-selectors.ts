import type { ContentPiece, Idea, Resource } from "@/lib/content-engine";

// Pure inheritance selectors for the Resources model (ARI-162): the main
// idea holds resources, an article-level idea inherits from its parent, and
// a piece inherits from its own idea and (transitively) that idea's parent.
// Resources are never copied on inheritance — these selectors compose the
// effective set at read time from the flat `resources` table, same
// no-Zustand/no-clock discipline as content-selectors.ts.

export interface EffectiveResource {
  resource: Resource;
  /** Set when this resource is inherited from an ancestor idea, never the
   * owner the caller asked about directly. */
  inheritedFrom?: { type: "idea"; id: string; title: string };
}

function ownedBy(
  ownerType: Resource["ownerType"],
  ownerId: string,
  resources: readonly Resource[],
): Resource[] {
  return resources.filter((r) => r.ownerType === ownerType && r.ownerId === ownerId);
}

/**
 * An idea's own resources plus its parent's (if any), max depth 2 — matches
 * the idea nesting cap enforced by the contract. A deleted (tombstoned)
 * idea, or a deleted parent, contributes nothing.
 */
export function effectiveResourcesForIdea(
  ideaId: string,
  ideas: readonly Idea[],
  resources: readonly Resource[],
): EffectiveResource[] {
  const idea = ideas.find((i) => i.id === ideaId);
  if (!idea || idea.deletedAt !== undefined) return [];

  const own: EffectiveResource[] = ownedBy("idea", ideaId, resources).map((resource) => ({
    resource,
  }));

  if (idea.parentId === null) return own;
  const parent = ideas.find((i) => i.id === idea.parentId);
  if (!parent || parent.deletedAt !== undefined) return own;

  const inherited: EffectiveResource[] = ownedBy("idea", parent.id, resources).map((resource) => ({
    resource,
    inheritedFrom: { type: "idea" as const, id: parent.id, title: parent.title },
  }));

  return [...own, ...inherited];
}

/**
 * A piece's own resources, plus its idea's, plus that idea's parent's
 * (transitively, via effectiveResourcesForIdea — max depth 2 overall). A
 * deleted (tombstoned) piece, or a deleted owning idea, contributes nothing
 * beyond what the piece owns directly.
 */
export function effectiveResourcesForPiece(
  pieceId: string,
  pieces: readonly ContentPiece[],
  ideas: readonly Idea[],
  resources: readonly Resource[],
): EffectiveResource[] {
  const piece = pieces.find((p) => p.id === pieceId);
  if (!piece || piece.deletedAt !== undefined) return [];

  const own: EffectiveResource[] = ownedBy("piece", pieceId, resources).map((resource) => ({
    resource,
  }));

  const idea = ideas.find((i) => i.id === piece.ideaId);
  if (!idea || idea.deletedAt !== undefined) return own;

  // effectiveResourcesForIdea already returns the idea's own resources
  // (untagged) plus its parent's (tagged). Re-tag the untagged ones with
  // this idea, since from the piece's vantage point they're inherited too —
  // the already-tagged (grandparent) entries keep their original tag.
  const fromIdea = effectiveResourcesForIdea(idea.id, ideas, resources).map(
    (entry): EffectiveResource =>
      entry.inheritedFrom
        ? entry
        : { resource: entry.resource, inheritedFrom: { type: "idea" as const, id: idea.id, title: idea.title } },
  );

  return [...own, ...fromIdea];
}
