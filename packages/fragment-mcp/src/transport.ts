import type { ContentFormat, Idea, PieceHandoff, PieceOrigin, PieceStatus, Priority, ResourceInput } from "../../../src/lib/content-engine/index.js";

// The Transport interface is the seam between "how a tool call reads/writes
// pieces and ideas" and "where they actually live". Phase 1 (this package,
// M1) implements it against the local filesystem inbox. The hosted M2 build
// implements the same interface against an HTTP API — see http-transport.ts.

export interface CreateIdeaInput {
  title: string;
  summary?: string;
  /** Name of the agent creating the idea. Not persisted on the Idea record
   * today (the contract's Idea type has no "agent" field) — accepted for a
   * consistent tool signature and forward compatibility. */
  agent?: string;
  /** Nest under an existing root idea. Max depth 2: the parent must itself
   * be a root idea (enforced via assertIdeaParentAllowed). */
  parentId?: string;
}

export interface PieceListView {
  id: string;
  ideaId: string;
  format: ContentFormat;
  status: PieceStatus;
  origin: PieceOrigin;
  title?: string;
  priority: Priority;
  scheduledAt?: number;
  agent?: string;
  model?: string;
  supersedes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PieceView extends PieceListView {
  body: string;
  resources: ResourceInput[];
}

export interface IdeaListEntry {
  id: string;
  title: string;
  summary?: string;
  parentId: string | null;
  priority: Priority;
  origin: PieceOrigin;
  createdAt: number;
  updatedAt: number;
  /** Piece counts broken out per status, always populated regardless of any
   * status filter applied to the overall list_ideas call. */
  counts: Record<PieceStatus, number>;
  total: number;
}

export interface Transport {
  createIdea(input: CreateIdeaInput): Promise<Idea>;
  /** Takes an already-validated PieceHandoff (validate with the contract's
   * zod schemas before calling). Always creates a new piece file — agents
   * never mutate an existing piece; a re-draft is a new piece that
   * `supersedes` the old one. */
  addPiece(handoff: PieceHandoff): Promise<{ pieceId: string; ideaId: string }>;
  listIdeas(status?: PieceStatus): Promise<IdeaListEntry[]>;
  getPiece(pieceId: string): Promise<PieceView>;
  /** Agents may only move a piece to "published" (after posting on the
   * user's behalf). Any other status is a user verdict inside the app. */
  updateStatus(pieceId: string, status: PieceStatus): Promise<void>;
}

export class TransportError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "invalid" | "unimplemented" = "invalid",
  ) {
    super(message);
    this.name = "TransportError";
  }
}
