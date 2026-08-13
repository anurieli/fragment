import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  normalizeTitle,
  parsePieceFile,
  resourceLineSchema,
  type PieceHandoff,
} from "../../../src/lib/content-engine/index.js";

import { FileTransport } from "./file-transport.js";
import type { HttpTransport } from "./http-transport.js";
import { TransportError } from "./transport.js";

/**
 * Draining the local inbox into a hosted account.
 *
 * The file transport writes pieces to a directory and trusts a running
 * Fragment app to pick them up. When there is no such app — the common case
 * once someone moves to the hosted product — those files are not lost, they
 * are simply invisible: real drafts sitting on a disk nobody reads. This
 * command is the bridge, and the reason the file transport's failure mode is
 * recoverable rather than terminal.
 *
 * Identity is the whole problem. Local ids were minted offline and mean
 * nothing to the account, so every idea is matched by NORMALIZED TITLE
 * against what the account already has, exactly the way an `ideaTitle`
 * handoff resolves. Matching is what keeps a drain from cloning an idea the
 * writer already has; minting is what keeps it from dropping one they do
 * not. Pieces then travel with the resolved id, never the local one.
 *
 * Drained files move to `.imported/`, the same acknowledgement the running
 * app performs, so a second drain is a no-op rather than a duplicate.
 */

export interface DrainResult {
  ideasCreated: { title: string; ideaId: string }[];
  ideasMatched: { title: string; ideaId: string }[];
  piecesPushed: { pieceId: string; ideaId: string; title?: string }[];
  resourcesPushed: number;
  /** Files that could not be understood; left in place for a retry. */
  failures: { file: string; reason: string }[];
  inboxDir: string;
}

interface DrainOptions {
  /** Report what would move without touching the account or the disk. */
  dryRun?: boolean;
}

async function readIdeaManifests(
  inboxDir: string,
): Promise<{ ideaId: string; title: string; summary?: string; dir: string }[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(inboxDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const manifests: { ideaId: string; title: string; summary?: string; dir: string }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = path.join(inboxDir, entry.name);
    try {
      const raw = await fs.readFile(path.join(dir, "idea.json"), "utf8");
      const parsed = JSON.parse(raw) as { id?: string; title?: string; summary?: string };
      if (typeof parsed.title === "string" && parsed.title.trim()) {
        manifests.push({
          ideaId: parsed.id ?? entry.name,
          title: parsed.title,
          summary: parsed.summary,
          dir,
        });
      }
    } catch {
      // A directory without a readable manifest still holds piece files,
      // which carry their own idea reference; skip only the manifest.
      continue;
    }
  }
  return manifests;
}

async function readPendingPieces(
  dir: string,
): Promise<{ file: string; raw: string }[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: { file: string; raw: string }[] = [];
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    const file = path.join(dir, name);
    try {
      out.push({ file, raw: await fs.readFile(file, "utf8") });
    } catch {
      continue;
    }
  }
  return out;
}

/** Acknowledge a drained file the way the running app does: move it aside. */
async function moveToImported(inboxDir: string, file: string): Promise<void> {
  const rel = path.relative(inboxDir, file);
  const target = path.join(inboxDir, ".imported", rel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.rename(file, target);
  } catch {
    // Cross-device or a name already taken: copy then unlink, uniquified.
    const alt = target.replace(/\.md$/, `-${Date.now()}.md`);
    await fs.copyFile(file, alt);
    await fs.unlink(file);
  }
}

export async function drainInbox(
  http: HttpTransport,
  options: DrainOptions = {},
): Promise<DrainResult> {
  const local = new FileTransport();
  const inboxDir = local.inboxDir;

  const result: DrainResult = {
    ideasCreated: [],
    ideasMatched: [],
    piecesPushed: [],
    resourcesPushed: 0,
    failures: [],
    inboxDir,
  };

  // What the account already has, by normalized title. An idea the writer
  // already owns must absorb its stranded pieces rather than gain a twin.
  const hosted = await http.listIdeas();
  const byTitle = new Map<string, string>();
  for (const idea of hosted) byTitle.set(normalizeTitle(idea.title), idea.id);

  // Local idea id -> hosted idea id.
  const idMap = new Map<string, string>();

  for (const manifest of await readIdeaManifests(inboxDir)) {
    const key = normalizeTitle(manifest.title);
    const existing = byTitle.get(key);
    if (existing) {
      idMap.set(manifest.ideaId, existing);
      result.ideasMatched.push({ title: manifest.title, ideaId: existing });
      continue;
    }
    if (options.dryRun) {
      idMap.set(manifest.ideaId, `(new) ${manifest.title}`);
      result.ideasCreated.push({ title: manifest.title, ideaId: "(dry run)" });
      continue;
    }
    try {
      const created = await http.createIdea({ title: manifest.title, summary: manifest.summary });
      idMap.set(manifest.ideaId, created.id);
      byTitle.set(key, created.id);
      result.ideasCreated.push({ title: manifest.title, ideaId: created.id });
    } catch (err) {
      result.failures.push({
        file: path.join(manifest.dir, "idea.json"),
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Pieces, walking the same directories.
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = await fs.readdir(inboxDir, { withFileTypes: true });
  } catch {
    return result;
  }

  // Local piece id -> hosted piece id, so a piece-owned resource can follow.
  const pieceMap = new Map<string, string>();

  // Every pending piece across every idea, gathered before any is pushed and
  // ordered oldest first.
  //
  // Order is not cosmetic here. A re-draft arrives as a new piece pointing at
  // the one it replaces, and the account only honours that link if the
  // replaced piece is already there. Pushing newest-first would deliver the
  // revision, find nothing to supersede, then deliver the draft it was meant
  // to retire — leaving the writer to work out which of two near-identical
  // pieces is the live one. Oldest-first lets the chain collapse exactly as
  // the agent intended.
  const pending: { file: string; dirName: string; handoff: PieceHandoff }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    for (const { file, raw } of await readPendingPieces(path.join(inboxDir, entry.name))) {
      try {
        pending.push({ file, dirName: entry.name, handoff: parsePieceFile(raw) });
      } catch (err) {
        result.failures.push({ file, reason: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  pending.sort((a, b) => (a.handoff.createdAt ?? 0) - (b.handoff.createdAt ?? 0));

  for (const { file, dirName, handoff } of pending) {
    // The account's own id for this idea, by whichever route resolves:
    // the manifest map, or the title carried on the handoff itself.
    const localIdeaId = handoff.ideaId ?? dirName;
    const hostedIdeaId = idMap.get(localIdeaId);

    // Only a piece drained earlier in this run can be superseded. A local id
    // pointing at something that never crossed means nothing to the account,
    // so the link is dropped rather than sent as a dangling reference.
    const supersedes = handoff.supersedes ? pieceMap.get(handoff.supersedes) : undefined;

    const outgoing: PieceHandoff = {
      ...handoff,
      // A local id means nothing to the account, and reusing it would
      // claim an id the account may already have spent.
      id: undefined,
      ideaId: hostedIdeaId,
      ideaTitle: hostedIdeaId ? undefined : (handoff.ideaTitle ?? dirName),
      supersedes,
      status: "inbox",
    };

    if (options.dryRun) {
      result.piecesPushed.push({
        pieceId: "(dry run)",
        ideaId: hostedIdeaId ?? "(by title)",
        title: handoff.title,
      });
      continue;
    }

    try {
      const pushed = await http.addPiece(outgoing);
      if (handoff.id) pieceMap.set(handoff.id, pushed.pieceId);
      result.piecesPushed.push({
        pieceId: pushed.pieceId,
        ideaId: pushed.ideaId,
        title: handoff.title,
      });
      await moveToImported(inboxDir, file);
    } catch (err) {
      result.failures.push({
        file,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = path.join(inboxDir, entry.name);

    // Resources filed under this idea, if any.
    const resourcesFile = path.join(dir, "resources.jsonl");
    let resourcesRaw: string | undefined;
    try {
      resourcesRaw = await fs.readFile(resourcesFile, "utf8");
    } catch {
      resourcesRaw = undefined;
    }
    if (resourcesRaw === undefined) continue;

    let drainedAny = false;
    for (const line of resourcesRaw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed;
      try {
        parsed = resourceLineSchema.safeParse(JSON.parse(trimmed));
      } catch {
        continue;
      }
      if (!parsed.success) continue;
      const res = parsed.data;

      const ownerId =
        res.ownerType === "idea" ? idMap.get(res.ownerId) : pieceMap.get(res.ownerId);
      // An owner that never made it across has nothing to attach to; leaving
      // the line in place is better than filing it against the wrong record.
      if (!ownerId) continue;

      if (options.dryRun) {
        result.resourcesPushed += 1;
        continue;
      }
      try {
        await http.addResource({
          ownerType: res.ownerType,
          ownerId,
          kind: res.kind,
          title: res.title,
          url: res.url,
          note: res.note,
        });
        result.resourcesPushed += 1;
        drainedAny = true;
      } catch {
        // Resources are supporting material; one failure must not strand a
        // successfully pushed piece.
      }
    }
    if (drainedAny && !options.dryRun) await moveToImported(inboxDir, resourcesFile);
  }

  return result;
}

export function formatDrainResult(result: DrainResult, dryRun: boolean): string {
  const verb = dryRun ? "would move" : "moved";
  const lines: string[] = [];

  const total = result.piecesPushed.length;
  lines.push(
    total === 0 && result.ideasCreated.length === 0
      ? `Nothing waiting in ${result.inboxDir}.`
      : `${verb}: ${result.ideasCreated.length} new idea(s), ${result.ideasMatched.length} matched to ideas you already have, ${total} piece(s), ${result.resourcesPushed} resource(s).`,
  );

  if (result.ideasCreated.length) {
    lines.push("", "  new ideas:");
    for (const idea of result.ideasCreated) lines.push(`    ${idea.title}`);
  }
  if (result.ideasMatched.length) {
    lines.push("", "  matched to existing ideas:");
    for (const idea of result.ideasMatched) lines.push(`    ${idea.title}`);
  }
  if (result.piecesPushed.length) {
    lines.push("", "  pieces:");
    for (const piece of result.piecesPushed) {
      lines.push(`    ${piece.title ?? "(untitled)"} -> ${piece.pieceId}`);
    }
  }
  if (result.failures.length) {
    lines.push("", "  left in place (fix and re-run):");
    for (const failure of result.failures) {
      lines.push(`    ${path.basename(failure.file)}: ${failure.reason}`);
    }
  }
  if (!dryRun && total > 0) {
    lines.push("", "Open Fragment; they are in your inbox, waiting for review.");
  }
  return lines.join("\n");
}

/** Shared refusal when hosted mode is not configured. */
export function requireHostedForDrain(): never {
  throw new TransportError(
    "drain needs a hosted account to move things INTO. Set FRAGMENT_API_URL and " +
      "FRAGMENT_API_TOKEN (mint a token in Fragment: Settings, Account & Sync, Agent access), " +
      "then run this again.",
    "invalid",
  );
}
