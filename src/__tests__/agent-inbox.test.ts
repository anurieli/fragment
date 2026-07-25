import { describe, it, expect } from "vitest";

import { gateAgentInbox } from "@/lib/agent-inbox/gate";
import { resolveInboxRelPath } from "@/lib/agent-inbox/paths";
import { importHandoffFiles, type AgentInboxFile } from "@/lib/agent-inbox/import";
import { serializePieceFile } from "@/lib/content-engine";
import type { ContentPiece, Idea, PieceHandoff } from "@/lib/content-engine";

// ---------------------------------------------------------------------------
// Gate matrix
// ---------------------------------------------------------------------------

describe("gateAgentInbox", () => {
  const openEnv = { isHosted: false, localIngressEnabled: true, ingressToken: undefined };

  it("closes on the hosted build regardless of everything else", () => {
    expect(
      gateAgentInbox({ isHosted: true, localIngressEnabled: true, ingressToken: "t" }, "localhost:3100", "Bearer t"),
    ).toEqual({ allowed: false });
  });

  it("closes when FRAGMENT_LOCAL_INGRESS is unset/false", () => {
    expect(
      gateAgentInbox({ isHosted: false, localIngressEnabled: false, ingressToken: "t" }, "localhost:3100", "Bearer t"),
    ).toEqual({ allowed: false });
  });

  it("opens for localhost without a token", () => {
    expect(gateAgentInbox(openEnv, "localhost:3100", null)).toEqual({ allowed: true });
    expect(gateAgentInbox(openEnv, "127.0.0.1:3100", null)).toEqual({ allowed: true });
    expect(gateAgentInbox(openEnv, "[::1]:3100", null)).toEqual({ allowed: true });
  });

  it("closes for a non-local host with no token configured", () => {
    expect(gateAgentInbox(openEnv, "myhost.example.com", null)).toEqual({ allowed: false });
  });

  it("closes for a non-local host with a missing/mismatched Authorization header", () => {
    const env = { ...openEnv, ingressToken: "secret-token" };
    expect(gateAgentInbox(env, "myhost.example.com", null)).toEqual({ allowed: false });
    expect(gateAgentInbox(env, "myhost.example.com", "Bearer wrong")).toEqual({ allowed: false });
    expect(gateAgentInbox(env, "myhost.example.com", "secret-token")).toEqual({ allowed: false });
  });

  it("opens for a non-local host with the exact bearer token", () => {
    const env = { ...openEnv, ingressToken: "secret-token" };
    expect(gateAgentInbox(env, "myhost.example.com", "Bearer secret-token")).toEqual({ allowed: true });
  });
});

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

describe("resolveInboxRelPath", () => {
  const inboxDir = "/home/user/.fragment/inbox";

  it("resolves a plain relative path inside the inbox dir", () => {
    expect(resolveInboxRelPath(inboxDir, "post.md")).toBe("/home/user/.fragment/inbox/post.md");
  });

  it("resolves a nested relative path inside the inbox dir", () => {
    expect(resolveInboxRelPath(inboxDir, "idea_x1/post.md")).toBe(
      "/home/user/.fragment/inbox/idea_x1/post.md",
    );
  });

  it("rejects a traversal segment", () => {
    expect(resolveInboxRelPath(inboxDir, "../post.md")).toBeNull();
    expect(resolveInboxRelPath(inboxDir, "idea_x1/../../post.md")).toBeNull();
    expect(resolveInboxRelPath(inboxDir, "../../etc/passwd")).toBeNull();
  });

  it("rejects an absolute path", () => {
    expect(resolveInboxRelPath(inboxDir, "/etc/passwd")).toBeNull();
  });

  it("rejects an empty path", () => {
    expect(resolveInboxRelPath(inboxDir, "")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// importHandoffFiles
// ---------------------------------------------------------------------------

function makeHandoff(overrides: Partial<PieceHandoff> = {}): PieceHandoff {
  return {
    fragment: 1,
    ideaTitle: "Voice is the moat",
    format: "linkedin",
    status: "inbox",
    origin: "agent",
    body: "Draft body.",
    priority: 0,
    resources: [],
    ...overrides,
  };
}

function makeFile(handoff: PieceHandoff, relPath = "post.md", mtime = 1000): AgentInboxFile {
  return {
    fileName: relPath.split("/").pop() ?? relPath,
    relPath,
    content: serializePieceFile(handoff),
    mtime,
  };
}

function makeIdea(overrides: Partial<Idea> = {}): Idea {
  return {
    id: "idea_1",
    title: "Voice is the moat",
    parentId: null,
    priority: 0,
    origin: "user",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makePiece(overrides: Partial<ContentPiece> = {}): ContentPiece {
  return {
    id: "piece_1",
    ideaId: "idea_1",
    format: "linkedin",
    status: "inbox",
    origin: "agent",
    body: "Old body.",
    seen: false,
    priority: 0,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `generated_${idCounter}`;
}

describe("importHandoffFiles", () => {
  it("creates a new idea by title when none matches", () => {
    idCounter = 0;
    const file = makeFile(makeHandoff({ ideaTitle: "Brand new idea" }));
    const result = importHandoffFiles([file], { ideas: [], pieces: [], now: 5000, generateId: nextId });

    expect(result.ideasToCreate).toHaveLength(1);
    expect(result.ideasToCreate[0]).toMatchObject({ title: "Brand new idea", parentId: null });
    expect(result.piecesToUpsert).toHaveLength(1);
    expect(result.piecesToUpsert[0].ideaId).toBe(result.ideasToCreate[0].id);
    expect(result.acks).toEqual(["post.md"]);
    expect(result.skips).toEqual([]);
  });

  it("reuses an existing idea matched by id (ideaId), never creating a duplicate", () => {
    idCounter = 0;
    const idea = makeIdea({ id: "idea_existing" });
    const file = makeFile(makeHandoff({ ideaId: "idea_existing", ideaTitle: undefined }));
    const result = importHandoffFiles([file], {
      ideas: [idea],
      pieces: [],
      now: 5000,
      generateId: nextId,
    });

    expect(result.ideasToCreate).toEqual([]);
    expect(result.piecesToUpsert).toHaveLength(1);
    expect(result.piecesToUpsert[0].ideaId).toBe("idea_existing");
  });

  it("reuses an existing idea matched by normalized title", () => {
    idCounter = 0;
    const idea = makeIdea({ id: "idea_existing", title: "Voice  is the   Moat" });
    const file = makeFile(makeHandoff({ ideaTitle: "voice is the moat" }));
    const result = importHandoffFiles([file], {
      ideas: [idea],
      pieces: [],
      now: 5000,
      generateId: nextId,
    });

    expect(result.ideasToCreate).toEqual([]);
    expect(result.piecesToUpsert[0].ideaId).toBe("idea_existing");
  });

  it("LWW: a locally newer piece is never clobbered, but the file is still acked", () => {
    const idea = makeIdea();
    const localPiece = makePiece({ id: "piece_1", updatedAt: 99_999, body: "User's edited body" });
    const file = makeFile(makeHandoff({ id: "piece_1", updatedAt: 5000 }), "post.md");

    const result = importHandoffFiles([file], {
      ideas: [idea],
      pieces: [localPiece],
      now: 100_000,
      generateId: nextId,
    });

    expect(result.piecesToUpsert).toEqual([]);
    expect(result.ideasToCreate).toEqual([]);
    expect(result.acks).toEqual(["post.md"]);
    expect(result.skips).toEqual([{ relPath: "post.md", reason: "local-newer" }]);
  });

  it("idempotent re-import: identical updatedAt is a no-op skip that still acks", () => {
    const idea = makeIdea();
    const localPiece = makePiece({ id: "piece_1", updatedAt: 5000 });
    const file = makeFile(makeHandoff({ id: "piece_1", updatedAt: 5000 }), "post.md");

    const result = importHandoffFiles([file], {
      ideas: [idea],
      pieces: [localPiece],
      now: 100_000,
      generateId: nextId,
    });

    expect(result.piecesToUpsert).toEqual([]);
    expect(result.acks).toEqual(["post.md"]);
    expect(result.skips).toEqual([{ relPath: "post.md", reason: "unchanged" }]);
  });

  it("re-importing the exact same file twice across two calls never duplicates the idea or piece", () => {
    idCounter = 0;
    // A real re-push is idempotent only when the agent pins `id` (and
    // `updated_at`) itself — see docs/AGENT-API.md. Without a pinned id
    // Fragment would generate a fresh one on every import, by design.
    const file = makeFile(
      makeHandoff({ id: "piece_fixed", ideaTitle: "Brand new idea", updatedAt: 5000 }),
    );
    const first = importHandoffFiles([file], { ideas: [], pieces: [], now: 5000, generateId: nextId });

    // Fold the first import's output back into state, as the real hook would
    // after persisting it, then re-import the identical file.
    const ideasAfter = first.ideasToCreate;
    const piecesAfter = first.piecesToUpsert;
    const second = importHandoffFiles([file], {
      ideas: ideasAfter,
      pieces: piecesAfter,
      now: 5000,
      generateId: nextId,
    });

    expect(second.ideasToCreate).toEqual([]);
    expect(second.piecesToUpsert).toEqual([]);
    expect(second.acks).toEqual(["post.md"]);
    expect(second.skips).toEqual([{ relPath: "post.md", reason: "unchanged" }]);
  });

  it("supersedes: tombstones the superseded piece when it exists and is still in inbox", () => {
    const idea = makeIdea();
    const oldPiece = makePiece({ id: "piece_old", status: "inbox" });
    const file = makeFile(
      makeHandoff({ id: "piece_new", supersedes: "piece_old", updatedAt: 5000 }),
      "post.md",
    );

    const result = importHandoffFiles([file], {
      ideas: [idea],
      pieces: [oldPiece],
      now: 100_000,
      generateId: nextId,
    });

    const newPiece = result.piecesToUpsert.find((p) => p.id === "piece_new");
    const tombstoned = result.piecesToUpsert.find((p) => p.id === "piece_old");
    expect(newPiece).toBeDefined();
    expect(newPiece?.deletedAt).toBeUndefined();
    expect(tombstoned).toBeDefined();
    expect(tombstoned?.deletedAt).toBe(100_000);
    expect(tombstoned?.updatedAt).toBe(100_000);
  });

  it("supersedes: leaves a superseded piece alone once it has moved past inbox status", () => {
    const idea = makeIdea();
    const oldPiece = makePiece({ id: "piece_old", status: "in-progress" });
    const file = makeFile(
      makeHandoff({ id: "piece_new", supersedes: "piece_old", updatedAt: 5000 }),
      "post.md",
    );

    const result = importHandoffFiles([file], {
      ideas: [idea],
      pieces: [oldPiece],
      now: 100_000,
      generateId: nextId,
    });

    const tombstoned = result.piecesToUpsert.find((p) => p.id === "piece_old");
    expect(tombstoned).toBeUndefined();
    const newPiece = result.piecesToUpsert.find((p) => p.id === "piece_new");
    expect(newPiece).toBeDefined();
    expect(newPiece?.status).toBe("inbox");
  });

  it("supersedes: a no-op (not an error) when the superseded piece doesn't exist", () => {
    const idea = makeIdea();
    const file = makeFile(
      makeHandoff({ id: "piece_new", supersedes: "piece_ghost", updatedAt: 5000 }),
      "post.md",
    );

    const result = importHandoffFiles([file], {
      ideas: [idea],
      pieces: [],
      now: 100_000,
      generateId: nextId,
    });

    expect(result.piecesToUpsert).toHaveLength(1);
    expect(result.piecesToUpsert[0].id).toBe("piece_new");
  });

  it("skips a malformed file without acking it, leaving it in the inbox", () => {
    const file: AgentInboxFile = {
      fileName: "broken.md",
      relPath: "broken.md",
      content: "not frontmatter at all",
      mtime: 1000,
    };

    const result = importHandoffFiles([file], { ideas: [], pieces: [], now: 5000, generateId: nextId });

    expect(result.acks).toEqual([]);
    expect(result.skips).toHaveLength(1);
    expect(result.skips[0].relPath).toBe("broken.md");
    expect(result.skips[0].reason).toBe("parse-error");
  });

  it("defaults agent files to status inbox, origin agent, seen false", () => {
    idCounter = 0;
    const file = makeFile(makeHandoff({ status: "inbox", origin: "agent" }));
    const result = importHandoffFiles([file], { ideas: [], pieces: [], now: 5000, generateId: nextId });

    expect(result.piecesToUpsert[0]).toMatchObject({ status: "inbox", origin: "agent", seen: false });
  });
});
