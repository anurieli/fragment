import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { z } from "zod";

import {
  PIECE_ORIGINS,
  PIECE_STATUSES,
  assertIdeaParentAllowed,
  buildIdeaFromHandoff,
  handoffToPiece,
  matchIdea,
  parsePieceFile,
  prioritySchema,
  serializePieceFile,
  type Idea,
  type PieceHandoff,
  type PieceStatus,
} from "../../../src/lib/content-engine/index.js";

import { generateIdeaId, generatePieceId, generateResourceId } from "./id.js";
import {
  TransportError,
  type AddResourceInput,
  type CreateIdeaInput,
  type IdeaListEntry,
  type PieceView,
  type Transport,
} from "./transport.js";

// ---------------------------------------------------------------------------
// Phase-1 file-based transport. Ideas and pieces live under:
//
//   <inboxDir>/<ideaId>/idea.json          idea manifest, written once
//   <inboxDir>/<ideaId>/<pieceId>.md       piece handoff (contract format)
//   <inboxDir>/.imported/<ideaId>/<id>.md  where the running Fragment app
//                                          moves a piece file once imported
//   <inboxDir>/.status.jsonl               append-only status change log:
//                                          {pieceId, status, at, by}\n per line
//
// Reads (listIdeas / getPiece) reconstruct current state by scanning both
// piece locations and layering the status log on top — they are eventually
// consistent with whatever the app has done to the same directory tree, by
// design (see docs/AGENT-API.md and the package README).
// ---------------------------------------------------------------------------

const ideaManifestSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().optional(),
  parentId: z.string().nullable(),
  priority: prioritySchema,
  pinnedAt: z.number().optional(),
  voiceId: z.string().optional(),
  origin: z.enum(PIECE_ORIGINS),
  createdAt: z.number(),
  updatedAt: z.number(),
  deletedAt: z.number().optional(),
});

interface StatusLogEntry {
  pieceId: string;
  status: PieceStatus;
  at: number;
  by: "agent" | "user" | "app";
}

interface IdentifiedHandoff {
  id: string;
  handoff: PieceHandoff;
}

export function resolveInboxDir(override?: string): string {
  return override ?? process.env.FRAGMENT_INBOX_DIR ?? path.join(os.homedir(), ".fragment", "inbox");
}

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "ENOENT";
}

function emptyCounts(): Record<PieceStatus, number> {
  const counts = {} as Record<PieceStatus, number>;
  for (const status of PIECE_STATUSES) counts[status] = 0;
  return counts;
}

export class FileTransport implements Transport {
  readonly inboxDir: string;
  private readonly statusLogPath: string;

  constructor(inboxDir?: string) {
    this.inboxDir = resolveInboxDir(inboxDir);
    this.statusLogPath = path.join(this.inboxDir, ".status.jsonl");
  }

  /**
   * A write to the inbox only counts if the running app can still pick it
   * up. When the app's agent-inbox is closed to the operator's browser
   * origin, pushes land on disk and are never imported, so the honest move
   * is to refuse the call rather than report a success the user will never
   * see. An app that is merely closed right now is fine: files legitimately
   * queue for it.
   */
  async assertDeliverable(): Promise<void> {
    const { checkDelivery } = await import("./delivery-check.js");
    const finding = await checkDelivery(this.inboxDir);
    if (finding.state === "ingress_blocked") {
      throw new TransportError(
        finding.summary +
          (finding.fix ? " " + finding.fix : "") +
          " (run `fragment-mcp doctor` for the full report)",
        "invalid",
      );
    }
  }

  /**
   * The sentence an agent needs to read after a successful local write.
   *
   * Writing to this directory only becomes a delivered draft when a running
   * Fragment app imports it. If no app is answering AND none ever has, the
   * agent has just filed a real draft into a folder nobody reads, and it
   * will keep doing so, cheerfully, forever. The write is not undone (the
   * words are safe on disk, and `drain` exists to rescue them) but the
   * caller must be told, in the tool result the model actually reads,
   * rather than left to infer it from an inbox that never fills.
   *
   * Null when delivery looks fine, so the happy path stays quiet.
   */
  async deliveryWarning(): Promise<string | null> {
    const { checkDelivery } = await import("./delivery-check.js");
    const finding = await checkDelivery(this.inboxDir);
    if (finding.state !== "app_down" || finding.everImported) return null;

    return (
      `WARNING: this was written to the local folder ${this.inboxDir}, and nothing has ever ` +
      "imported from it. No Fragment app is running here, so this draft has NOT reached the " +
      "user's Fragment account and will not until something picks it up. If they use hosted " +
      "Fragment, set FRAGMENT_API_URL and FRAGMENT_API_TOKEN on this MCP server (a token is " +
      "minted in Fragment under Settings, Account & Sync, Agent access) and every push will go " +
      "straight to their account. Anything already stranded here can be recovered with " +
      "`fragment-mcp drain` once those two variables are set. Tell the user this rather than " +
      "reporting a clean success."
    );
  }

  async createIdea(input: CreateIdeaInput): Promise<Idea> {
    const title = input.title.trim();
    if (!title) throw new TransportError("idea title is required", "invalid");

    let parentId: string | null = null;
    if (input.parentId) {
      const parent = await this.readIdeaManifest(input.parentId);
      if (!parent) {
        throw new TransportError(`parent idea not found: ${input.parentId}`, "not_found");
      }
      assertIdeaParentAllowed(parent);
      parentId = input.parentId;
    }

    const now = Date.now();
    const idea: Idea = {
      id: generateIdeaId(),
      title,
      summary: input.summary,
      parentId,
      priority: 0,
      origin: "agent",
      createdAt: now,
      updatedAt: now,
    };
    await this.writeIdeaManifest(idea);
    return idea;
  }

  async addPiece(handoff: PieceHandoff): Promise<{ pieceId: string; ideaId: string }> {
    const ideas = await this.loadIdeas();
    let idea = matchIdea(handoff, ideas);
    if (!idea) {
      idea = buildIdeaFromHandoff(handoff, { now: Date.now(), generateId: generateIdeaId });
      await this.writeIdeaManifest(idea);
    }

    const order = (await this.readPiecesForIdea(idea.id)).length;
    const now = Date.now();
    // handoffToPiece is the contract's own normalization: it mints the id
    // (via our injected generator), stamps createdAt/updatedAt, and builds
    // agentMeta for origin: "agent" pieces. We reuse its output purely to
    // get a canonical id + timestamps; the file on disk stays the wire
    // (frontmatter) format, never the stored ContentPiece shape.
    const piece = handoffToPiece(handoff, { now, generateId: generatePieceId, ideaId: idea.id, order });

    const resolved: PieceHandoff = {
      ...handoff,
      id: piece.id,
      ideaId: idea.id,
      ideaTitle: undefined,
      ideaSummary: undefined,
      // Agent-pushed pieces always start in inbox, regardless of what a
      // caller passed — this is a contract invariant, not a preference.
      status: "inbox",
      createdAt: piece.createdAt,
      updatedAt: piece.updatedAt,
    };

    const raw = serializePieceFile(resolved);
    const ideaDir = path.join(this.inboxDir, idea.id);
    await fs.mkdir(ideaDir, { recursive: true });
    // A fresh nanoid-derived filename per call — add_piece can never collide
    // with, let alone overwrite, an existing piece file. That is the
    // append-only guarantee at the filesystem level.
    await fs.writeFile(path.join(ideaDir, `${piece.id}.md`), raw, "utf8");

    return { pieceId: piece.id, ideaId: idea.id };
  }

  async listIdeas(status?: PieceStatus): Promise<IdeaListEntry[]> {
    const ideaIds = await this.listIdeaIds();
    const overrides = await this.loadStatusOverrides();
    const entries: IdeaListEntry[] = [];

    for (const ideaId of ideaIds) {
      const idea = await this.readIdeaManifest(ideaId);
      if (!idea || idea.deletedAt !== undefined) continue;

      const pieces = await this.readPiecesForIdea(ideaId);
      const counts = emptyCounts();
      for (const { id, handoff } of pieces) {
        const effective = overrides.get(id)?.status ?? handoff.status;
        counts[effective] += 1;
      }
      const total = pieces.length;
      if (status && counts[status] === 0) continue;

      entries.push({
        id: idea.id,
        title: idea.title,
        summary: idea.summary,
        parentId: idea.parentId,
        priority: idea.priority,
        origin: idea.origin,
        createdAt: idea.createdAt,
        updatedAt: idea.updatedAt,
        counts,
        total,
      });
    }
    return entries;
  }

  async getPiece(pieceId: string): Promise<PieceView> {
    const ideaIds = await this.listIdeaIds();
    const overrides = await this.loadStatusOverrides();
    for (const ideaId of ideaIds) {
      const pieces = await this.readPiecesForIdea(ideaId);
      const found = pieces.find((p) => p.id === pieceId);
      if (found) return this.toPieceView(ideaId, found, overrides);
    }
    throw new TransportError(`piece not found: ${pieceId}`, "not_found");
  }

  async updateStatus(pieceId: string, status: PieceStatus): Promise<void> {
    if (status !== "published") {
      throw new TransportError(
        `agents may only set status "published" (got "${status}"); every other status is a ` +
          "user verdict made inside Fragment, not something an agent can set.",
        "invalid",
      );
    }
    // Fail loud on a typo'd id rather than silently appending an orphaned
    // status line nothing will ever read.
    await this.getPiece(pieceId);

    const entry: StatusLogEntry = { pieceId, status, at: Date.now(), by: "agent" };
    await fs.mkdir(this.inboxDir, { recursive: true });
    await fs.appendFile(this.statusLogPath, `${JSON.stringify(entry)}\n`, "utf8");
  }

  async addResource(input: AddResourceInput): Promise<{ resourceId: string; ideaId: string }> {
    let ideaId: string;
    if (input.ownerType === "idea") {
      const idea = await this.readIdeaManifest(input.ownerId);
      if (!idea) {
        throw new TransportError(`idea not found: ${input.ownerId}`, "not_found");
      }
      ideaId = idea.id;
    } else {
      const owningIdeaId = await this.resolvePieceIdeaId(input.ownerId);
      if (!owningIdeaId) {
        throw new TransportError(`piece not found: ${input.ownerId}`, "not_found");
      }
      ideaId = owningIdeaId;
    }

    const resourceId = generateResourceId();
    const line = {
      id: resourceId,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      kind: input.kind,
      title: input.title,
      url: input.url,
      note: input.note,
      createdAt: Date.now(),
    };

    const ideaDir = path.join(this.inboxDir, ideaId);
    await fs.mkdir(ideaDir, { recursive: true });
    // Append-only, same as add_piece: a fresh line per call, an idea's
    // resources.jsonl accumulates and is never edited in place.
    await fs.appendFile(path.join(ideaDir, "resources.jsonl"), `${JSON.stringify(line)}\n`, "utf8");

    return { resourceId, ideaId };
  }

  // -- internals -------------------------------------------------------

  /** Resolve which idea directory owns a given piece id, by scanning every
   * idea's piece files (primary + .imported). Returns undefined if no idea
   * has ever seen this piece id. */
  private async resolvePieceIdeaId(pieceId: string): Promise<string | undefined> {
    const ideaIds = await this.listIdeaIds();
    for (const ideaId of ideaIds) {
      const pieces = await this.readPiecesForIdea(ideaId);
      if (pieces.some(({ id }) => id === pieceId)) return ideaId;
    }
    return undefined;
  }

  private toPieceView(
    ideaId: string,
    { id, handoff }: IdentifiedHandoff,
    overrides: Map<string, StatusLogEntry>,
  ): PieceView {
    return {
      id,
      ideaId,
      format: handoff.format,
      status: overrides.get(id)?.status ?? handoff.status,
      origin: handoff.origin,
      title: handoff.title,
      priority: handoff.priority,
      scheduledAt: handoff.scheduledAt,
      agent: handoff.agent,
      model: handoff.model,
      supersedes: handoff.supersedes,
      createdAt: handoff.createdAt ?? 0,
      updatedAt: handoff.updatedAt ?? handoff.createdAt ?? 0,
      body: handoff.body,
      resources: handoff.resources,
    };
  }

  private async listIdeaIds(): Promise<string[]> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(this.inboxDir, { withFileTypes: true });
    } catch (err) {
      if (isEnoent(err)) return [];
      throw err;
    }
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
  }

  private async loadIdeas(): Promise<Idea[]> {
    const ideaIds = await this.listIdeaIds();
    const ideas: Idea[] = [];
    for (const id of ideaIds) {
      const idea = await this.readIdeaManifest(id);
      if (idea) ideas.push(idea);
    }
    return ideas;
  }

  private async readIdeaManifest(ideaId: string): Promise<Idea | undefined> {
    const file = path.join(this.inboxDir, ideaId, "idea.json");
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch (err) {
      if (isEnoent(err)) return undefined;
      throw err;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      throw new TransportError(`corrupt idea manifest at ${file}: not valid JSON`, "invalid");
    }
    const parsed = ideaManifestSchema.safeParse(json);
    if (!parsed.success) {
      throw new TransportError(`corrupt idea manifest at ${file}: ${parsed.error.message}`, "invalid");
    }
    return parsed.data;
  }

  private async writeIdeaManifest(idea: Idea): Promise<void> {
    const dir = path.join(this.inboxDir, idea.id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "idea.json"), `${JSON.stringify(idea, null, 2)}\n`, "utf8");
  }

  private async readPiecesForIdea(ideaId: string): Promise<IdentifiedHandoff[]> {
    const primary = await this.readMarkdownFiles(path.join(this.inboxDir, ideaId));
    const imported = await this.readMarkdownFiles(path.join(this.inboxDir, ".imported", ideaId));
    const byId = new Map<string, PieceHandoff>();
    // Imported copies represent the app's authoritative post-processing
    // state; on an id collision they win over the pending inbox copy.
    for (const { id, handoff } of primary) byId.set(id, handoff);
    for (const { id, handoff } of imported) byId.set(id, handoff);
    return [...byId.entries()].map(([id, handoff]) => ({ id, handoff }));
  }

  private async readMarkdownFiles(dir: string): Promise<IdentifiedHandoff[]> {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch (err) {
      if (isEnoent(err)) return [];
      throw err;
    }
    const results: IdentifiedHandoff[] = [];
    for (const name of names) {
      if (!name.endsWith(".md")) continue;
      let raw: string;
      try {
        raw = await fs.readFile(path.join(dir, name), "utf8");
      } catch {
        continue;
      }
      try {
        const handoff = parsePieceFile(raw);
        const id = handoff.id ?? name.slice(0, -3);
        results.push({ id, handoff });
      } catch {
        // Reads are best-effort/eventually consistent: an unparsable or
        // half-written file is skipped rather than failing the whole read.
        continue;
      }
    }
    return results;
  }

  private async loadStatusOverrides(): Promise<Map<string, StatusLogEntry>> {
    const overrides = new Map<string, StatusLogEntry>();
    let raw: string;
    try {
      raw = await fs.readFile(this.statusLogPath, "utf8");
    } catch (err) {
      if (isEnoent(err)) return overrides;
      throw err;
    }
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed) as Partial<StatusLogEntry>;
        if (
          typeof entry.pieceId === "string" &&
          typeof entry.status === "string" &&
          typeof entry.at === "number" &&
          (PIECE_STATUSES as readonly string[]).includes(entry.status)
        ) {
          // Later lines override earlier ones for the same piece — the log
          // is append-only and read in file order, which is chronological.
          overrides.set(entry.pieceId, entry as StatusLogEntry);
        }
      } catch {
        continue;
      }
    }
    return overrides;
  }
}
