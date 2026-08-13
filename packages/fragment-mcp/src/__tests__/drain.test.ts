import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { drainInbox } from "../drain.js";
import { HttpTransport } from "../http-transport.js";
import { FileTransport } from "../file-transport.js";

/**
 * Draining is a migration, and the two ways a migration goes wrong are
 * duplicating what the destination already has and silently dropping what it
 * does not. Both are exercised here against a fake account, plus the
 * ordering rule that lets a re-draft retire the piece it replaced.
 */

interface FakeIdea {
  id: string;
  title: string;
}

/** Stands in for the hosted API: records what a real drain would send. */
function fakeAccount(existing: FakeIdea[] = []) {
  const ideas = [...existing];
  const pushes: { ideaId?: string; ideaTitle?: string; title?: string; supersedes?: string }[] = [];
  const resources: { ownerType: string; ownerId: string; title: string }[] = [];
  let nextId = 1;

  const transport = {
    listIdeas: async () => ideas.map((i) => ({ ...i })),
    createIdea: async ({ title }: { title: string }) => {
      const idea = { id: `hosted_idea_${nextId++}`, title };
      ideas.push(idea);
      return idea;
    },
    addPiece: async (handoff: {
      ideaId?: string;
      ideaTitle?: string;
      title?: string;
      supersedes?: string;
    }) => {
      pushes.push({
        ideaId: handoff.ideaId,
        ideaTitle: handoff.ideaTitle,
        title: handoff.title,
        supersedes: handoff.supersedes,
      });
      return { pieceId: `hosted_pc_${nextId++}`, ideaId: handoff.ideaId ?? "resolved_by_title" };
    },
    addResource: async (input: { ownerType: string; ownerId: string; title: string }) => {
      resources.push(input);
      return { resourceId: `hosted_res_${nextId++}`, ideaId: "x" };
    },
  } as unknown as HttpTransport;

  return { transport, ideas, pushes, resources };
}

async function writePiece(
  dir: string,
  id: string,
  frontmatter: Record<string, string>,
  body: string,
): Promise<void> {
  const lines = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`);
  await fs.writeFile(
    path.join(dir, `${id}.md`),
    `---\nfragment: 1\nid: ${id}\n${lines.join("\n")}\n---\n${body}`,
    "utf8",
  );
}

describe("drainInbox", () => {
  let inbox: string;
  const savedInboxDir = process.env.FRAGMENT_INBOX_DIR;

  beforeEach(async () => {
    inbox = await fs.mkdtemp(path.join(os.tmpdir(), "fragment-drain-"));
    process.env.FRAGMENT_INBOX_DIR = inbox;
  });

  afterEach(async () => {
    if (savedInboxDir === undefined) delete process.env.FRAGMENT_INBOX_DIR;
    else process.env.FRAGMENT_INBOX_DIR = savedInboxDir;
    await fs.rm(inbox, { recursive: true, force: true });
  });

  it("reuses an idea the account already has instead of cloning it", async () => {
    const dir = path.join(inbox, "idea_local1");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "idea.json"),
      JSON.stringify({ id: "idea_local1", title: "  Build It For Yourself First " }),
      "utf8",
    );

    const account = fakeAccount([{ id: "hosted_existing", title: "Build it for yourself first" }]);
    const result = await drainInbox(account.transport);

    // Matched on normalized title, so no second copy is minted.
    expect(result.ideasCreated).toEqual([]);
    expect(result.ideasMatched.map((i) => i.ideaId)).toEqual(["hosted_existing"]);
    expect(account.ideas).toHaveLength(1);
  });

  it("creates ideas the account does not have, and routes pieces to the new id", async () => {
    const dir = path.join(inbox, "idea_local2");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "idea.json"),
      JSON.stringify({ id: "idea_local2", title: "A brand new idea" }),
      "utf8",
    );
    await writePiece(dir, "pc_a", { idea_id: "idea_local2", format: "linkedin" }, "body a");

    const account = fakeAccount();
    const result = await drainInbox(account.transport);

    expect(result.ideasCreated).toHaveLength(1);
    expect(result.piecesPushed).toHaveLength(1);
    // The piece travels with the account's id, never the local one.
    expect(account.pushes[0].ideaId).toBe("hosted_idea_1");
    expect(account.pushes[0].ideaId).not.toBe("idea_local2");
  });

  it("pushes oldest first and remaps supersedes, so a re-draft retires its original", async () => {
    const dir = path.join(inbox, "idea_local3");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "idea.json"),
      JSON.stringify({ id: "idea_local3", title: "Supersede me" }),
      "utf8",
    );
    // Written newest-first on disk on purpose: the sort has to fix the order.
    await writePiece(
      dir,
      "pc_new",
      {
        idea_id: "idea_local3",
        format: "script",
        created_at: "2026-08-13T14:12:00.000Z",
        supersedes: "pc_old",
      },
      "revision",
    );
    await writePiece(
      dir,
      "pc_old",
      { idea_id: "idea_local3", format: "script", created_at: "2026-08-13T14:08:00.000Z" },
      "first draft",
    );

    const account = fakeAccount();
    await drainInbox(account.transport);

    expect(account.pushes).toHaveLength(2);
    // Oldest went first, and had nothing to supersede.
    expect(account.pushes[0].supersedes).toBeUndefined();
    // The revision points at the id the account minted for the original,
    // which is what lets the account tombstone it.
    expect(account.pushes[1].supersedes).toBe("hosted_pc_2");
  });

  it("drops a supersedes link that points outside this drain", async () => {
    const dir = path.join(inbox, "idea_local4");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "idea.json"),
      JSON.stringify({ id: "idea_local4", title: "Dangling" }),
      "utf8",
    );
    await writePiece(
      dir,
      "pc_only",
      { idea_id: "idea_local4", format: "linkedin", supersedes: "pc_never_delivered" },
      "body",
    );

    const account = fakeAccount();
    await drainInbox(account.transport);

    // A local id the account has never seen would be a dangling reference.
    expect(account.pushes[0].supersedes).toBeUndefined();
  });

  it("acknowledges drained files, so a second drain is a no-op", async () => {
    const dir = path.join(inbox, "idea_local5");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "idea.json"),
      JSON.stringify({ id: "idea_local5", title: "Once only" }),
      "utf8",
    );
    await writePiece(dir, "pc_once", { idea_id: "idea_local5", format: "linkedin" }, "body");

    const first = fakeAccount();
    await drainInbox(first.transport);
    expect(first.pushes).toHaveLength(1);
    expect(await fs.readdir(dir)).not.toContain("pc_once.md");

    // The idea still matches by title, and no piece is sent twice.
    const second = fakeAccount(first.ideas);
    const result = await drainInbox(second.transport);
    expect(second.pushes).toHaveLength(0);
    expect(result.ideasCreated).toEqual([]);
  });

  it("leaves an unparseable file in place and reports it", async () => {
    const dir = path.join(inbox, "idea_local6");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "broken.md"), "this has no frontmatter at all", "utf8");

    const account = fakeAccount();
    const result = await drainInbox(account.transport);

    expect(result.failures).toHaveLength(1);
    // Still on disk: a corrected file can be re-run rather than lost.
    expect(await fs.readdir(dir)).toContain("broken.md");
  });

  it("changes nothing on a dry run", async () => {
    const dir = path.join(inbox, "idea_local7");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "idea.json"),
      JSON.stringify({ id: "idea_local7", title: "Untouched" }),
      "utf8",
    );
    await writePiece(dir, "pc_dry", { idea_id: "idea_local7", format: "linkedin" }, "body");

    const account = fakeAccount();
    const result = await drainInbox(account.transport, { dryRun: true });

    expect(result.piecesPushed).toHaveLength(1);
    expect(account.pushes).toHaveLength(0);
    expect(account.ideas).toHaveLength(0);
    expect(await fs.readdir(dir)).toContain("pc_dry.md");
  });
});

describe("FileTransport.deliveryWarning", () => {
  it("warns when nothing has ever imported from the folder", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fragment-warn-"));
    try {
      const transport = new FileTransport(dir);
      const warning = await transport.deliveryWarning();
      expect(warning).toContain("has NOT reached");
      expect(warning).toContain("FRAGMENT_API_TOKEN");
      expect(warning).toContain("drain");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("stays quiet once the folder shows evidence of an import", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fragment-warn-ok-"));
    try {
      await fs.mkdir(path.join(dir, ".imported"), { recursive: true });
      const transport = new FileTransport(dir);
      expect(await transport.deliveryWarning()).toBeNull();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
