import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CONTRACT_VERSION,
  parsePieceFile,
  parsePieceHandoffJson,
  type PieceHandoff,
} from "../../../../src/lib/content-engine/index.js";

import { FileTransport } from "../file-transport.js";
import { TransportError } from "../transport.js";
import { pushFile } from "../cli.js";

// Every test gets its own temp directory under os.tmpdir() — never the real
// ~/.fragment — passed straight into FileTransport's constructor override.

let tmpDir: string;
let transport: FileTransport;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fragment-mcp-test-"));
  transport = new FileTransport(tmpDir);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeHandoff(overrides: Partial<PieceHandoff> = {}): PieceHandoff {
  return parsePieceHandoffJson({
    fragment: CONTRACT_VERSION,
    ideaTitle: "Voice is the moat",
    format: "linkedin",
    title: "Post 1 of 4",
    body: "Everyone is automating content. Almost no one is keeping their voice.",
    priority: 2,
    agent: "claude-code",
    resources: [],
    ...overrides,
  });
}

describe("FileTransport: create_idea + add_piece write valid, parseable files", () => {
  it("writes an idea manifest and a piece file that round-trip through the contract", async () => {
    const idea = await transport.createIdea({ title: "Voice is the moat", summary: "core thesis" });
    expect(idea.id).toMatch(/^idea_/);
    expect(idea.parentId).toBeNull();

    const handoff = makeHandoff({ ideaTitle: undefined, ideaId: idea.id });
    const { pieceId, ideaId } = await transport.addPiece(handoff);
    expect(pieceId).toMatch(/^pc_/);
    expect(ideaId).toBe(idea.id);

    const raw = await fs.readFile(path.join(tmpDir, ideaId, `${pieceId}.md`), "utf8");
    const reparsed = parsePieceFile(raw);

    expect(reparsed.id).toBe(pieceId);
    expect(reparsed.ideaId).toBe(ideaId);
    expect(reparsed.format).toBe("linkedin");
    expect(reparsed.status).toBe("inbox");
    expect(reparsed.origin).toBe("agent");
    expect(reparsed.body).toBe(handoff.body);
    expect(reparsed.agent).toBe("claude-code");
  });

  it("creates a new root idea from ideaTitle when none matches, byte-exact body preserved", async () => {
    const body = "Line one.\n\nLine two, with   odd   spacing.\n";
    const handoff = makeHandoff({ ideaTitle: "A brand new idea", body });
    const { pieceId, ideaId } = await transport.addPiece(handoff);

    const manifestRaw = await fs.readFile(path.join(tmpDir, ideaId, "idea.json"), "utf8");
    const manifest = JSON.parse(manifestRaw) as { title: string; origin: string };
    expect(manifest.title).toBe("A brand new idea");
    expect(manifest.origin).toBe("agent");

    const pieceRaw = await fs.readFile(path.join(tmpDir, ideaId, `${pieceId}.md`), "utf8");
    expect(parsePieceFile(pieceRaw).body).toBe(body);
  });

  it("matches an existing idea by normalized title instead of creating a duplicate", async () => {
    const first = await transport.addPiece(makeHandoff({ ideaTitle: "Shared Idea" }));
    const second = await transport.addPiece(makeHandoff({ ideaTitle: "  shared   idea  " }));

    expect(second.ideaId).toBe(first.ideaId);
    const ideaDirs = (await fs.readdir(tmpDir, { withFileTypes: true })).filter((e) => e.isDirectory());
    expect(ideaDirs).toHaveLength(1);
  });

  it("rejects nesting an idea more than one level deep", async () => {
    const root = await transport.createIdea({ title: "Root" });
    const child = await transport.createIdea({ title: "Child", parentId: root.id });
    await expect(transport.createIdea({ title: "Grandchild", parentId: child.id })).rejects.toThrow();
  });
});

describe("FileTransport: append-only enforcement", () => {
  it("never overwrites an existing piece — every add_piece call produces a new file", async () => {
    const handoff = makeHandoff({ ideaTitle: "Re-pushed idea" });
    const first = await transport.addPiece(handoff);
    const second = await transport.addPiece(handoff);

    expect(first.pieceId).not.toBe(second.pieceId);
    expect(second.ideaId).toBe(first.ideaId);

    const files = await fs.readdir(path.join(tmpDir, first.ideaId));
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    expect(mdFiles).toHaveLength(2);
    expect(mdFiles).toContain(`${first.pieceId}.md`);
    expect(mdFiles).toContain(`${second.pieceId}.md`);
  });

  it("models a re-draft as a new piece with supersedes, not a mutation", async () => {
    const original = await transport.addPiece(makeHandoff({ ideaTitle: "Redrafted" }));
    const redraft = await transport.addPiece(
      makeHandoff({ ideaId: original.ideaId, ideaTitle: undefined, supersedes: original.pieceId, body: "v2" }),
    );

    const originalPiece = await transport.getPiece(original.pieceId);
    expect(originalPiece.body).not.toBe("v2"); // untouched by the redraft

    const redraftPiece = await transport.getPiece(redraft.pieceId);
    expect(redraftPiece.supersedes).toBe(original.pieceId);
    expect(redraftPiece.body).toBe("v2");
  });
});

describe("FileTransport: update_status guard", () => {
  it("allows only 'published' and appends to .status.jsonl", async () => {
    const { pieceId } = await transport.addPiece(makeHandoff());
    await transport.updateStatus(pieceId, "published");

    const piece = await transport.getPiece(pieceId);
    expect(piece.status).toBe("published");

    const log = await fs.readFile(path.join(tmpDir, ".status.jsonl"), "utf8");
    const entries = log
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { pieceId: string; status: string; by: string });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ pieceId, status: "published", by: "agent" });
  });

  it("rejects every other status as a user verdict, and never writes to the log", async () => {
    const { pieceId } = await transport.addPiece(makeHandoff());

    for (const status of ["inbox", "in-progress", "ready"] as const) {
      await expect(transport.updateStatus(pieceId, status)).rejects.toThrow(TransportError);
    }

    await expect(fs.readFile(path.join(tmpDir, ".status.jsonl"), "utf8")).rejects.toThrow();
  });

  it("fails loud on an unknown piece id instead of writing an orphaned log line", async () => {
    await expect(transport.updateStatus("pc_does_not_exist", "published")).rejects.toThrow(/not found/);
  });
});

describe("FileTransport: list_ideas counts, including .status.jsonl overrides", () => {
  it("tallies pieces per status and layers status-log overrides on top of the on-disk default", async () => {
    const a = await transport.addPiece(makeHandoff({ ideaTitle: "Counted idea" }));
    const b = await transport.addPiece(makeHandoff({ ideaId: a.ideaId, ideaTitle: undefined }));
    const c = await transport.addPiece(makeHandoff({ ideaId: a.ideaId, ideaTitle: undefined }));

    // Every piece lands as "inbox" on write — confirm the baseline first.
    let ideas = await transport.listIdeas();
    let idea = ideas.find((i) => i.id === a.ideaId);
    expect(idea?.counts.inbox).toBe(3);
    expect(idea?.total).toBe(3);

    // Publish one out from under the transport by fixturing .status.jsonl
    // directly, the way the running app or another agent call would.
    await fs.appendFile(
      path.join(tmpDir, ".status.jsonl"),
      `${JSON.stringify({ pieceId: b.pieceId, status: "published", at: Date.now(), by: "agent" })}\n`,
    );
    // A later, stale-looking line for the same piece should NOT win — last
    // line wins because the log is chronological, not because it's "bigger".
    await fs.appendFile(
      path.join(tmpDir, ".status.jsonl"),
      `${JSON.stringify({ pieceId: c.pieceId, status: "ready", at: 1, by: "app" })}\n`,
    );

    ideas = await transport.listIdeas();
    idea = ideas.find((i) => i.id === a.ideaId);
    expect(idea?.counts).toMatchObject({ inbox: 1, "in-progress": 0, ready: 1, published: 1 });
    expect(idea?.total).toBe(3);
  });

  it("filters to ideas that have at least one piece in the requested status", async () => {
    const inboxOnly = await transport.createIdea({ title: "Inbox only" });
    await transport.addPiece(makeHandoff({ ideaId: inboxOnly.id, ideaTitle: undefined }));

    const withPublished = await transport.createIdea({ title: "Has a published piece" });
    const piece = await transport.addPiece(makeHandoff({ ideaId: withPublished.id, ideaTitle: undefined }));
    await transport.updateStatus(piece.pieceId, "published");

    const published = await transport.listIdeas("published");
    expect(published.map((i) => i.id)).toEqual([withPublished.id]);

    const inbox = await transport.listIdeas("inbox");
    expect(inbox.map((i) => i.id)).toEqual([inboxOnly.id]);
  });
});

describe("FileTransport: get_piece", () => {
  it("returns not found for an unknown id", async () => {
    await expect(transport.getPiece("pc_missing")).rejects.toThrow(TransportError);
  });
});

describe("CLI push", () => {
  it("validates a handoff file and queues it via the transport", async () => {
    const filePath = path.join(tmpDir, "handoff.md");
    await fs.writeFile(
      filePath,
      "---\nfragment: 1\nidea_title: CLI pushed idea\nformat: tweet\nagent: hermes/penny\n---\nHot take.\n---\nSecond segment.\n",
      "utf8",
    );

    const result = await pushFile(filePath, transport);
    expect(result.pieceId).toMatch(/^pc_/);

    const piece = await transport.getPiece(result.pieceId);
    expect(piece.format).toBe("tweet");
    expect(piece.body).toBe("Hot take.\n---\nSecond segment.\n");
  });

  it("rejects a malformed handoff file before it ever reaches the transport", async () => {
    const filePath = path.join(tmpDir, "bad.md");
    await fs.writeFile(filePath, "not frontmatter at all", "utf8");
    await expect(pushFile(filePath, transport)).rejects.toThrow();
  });
});
