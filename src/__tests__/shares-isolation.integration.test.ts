/**
 * The promise, tested against a real Postgres.
 *
 * "A reviewer sees their own comments and nobody else's" is a claim about
 * SQL, and SQL is not something the unit tests in shares.test.ts can check. A
 * mocked database would only confirm that the queries are the ones I wrote,
 * which is the part I am least worried about being wrong. So this suite runs
 * the actual statements against an actual server.
 *
 * Opt-in: set FRAGMENT_TEST_DATABASE_URL to a throwaway database. It is
 * skipped, not failed, when unset, so `npm test` on a laptop with no Postgres
 * stays green.
 *
 *   createdb fragment_share_test
 *   FRAGMENT_TEST_DATABASE_URL=postgres://.../fragment_share_test \
 *     npx vitest run src/__tests__/shares-isolation.integration.test.ts
 *
 * The database is dropped to empty and rebuilt from db/migrations on every
 * run, so it never accumulates state between runs and can never be pointed at
 * something real without destroying it loudly on the first statement.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const TEST_DB = process.env.FRAGMENT_TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;

suite("share isolation (real database)", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let shares: any;
  let db: any;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    db = await import("@/lib/server/db");
    shares = await import("@/lib/server/shares");

    const root = process.cwd();
    await db.query("drop schema if exists public cascade");
    await db.query("create schema public");
    for (const file of ["001_init.sql", "003_sharing.sql", "004_identities.sql"]) {
      await db.query(readFileSync(join(root, "db", "migrations", file), "utf8"));
    }
  }, 30_000);

  afterAll(async () => {
    const pool = db?.getPool?.();
    if (pool) await pool.end();
  });

  async function makeOwner(sub: string) {
    const row = await db.queryOne(
      "insert into users (email, name) values ($1, $2) returning id",
      [`${sub}@example.com`, sub],
    );
    return row.id as string;
  }

  it("keeps one reviewer's comments invisible to another", async () => {
    const ownerId = await makeOwner("owner-isolation");
    const { share } = await shares.createShare({
      userId: ownerId,
      noteId: "note-1",
      title: "On Endings",
      markdown: "The last line is the one they remember.",
    });

    const alice = await shares.identifyGuest(share.id, "alice@example.com");
    const bob = await shares.identifyGuest(share.id, "bob@example.com");

    await shares.submitReview({
      shareId: share.id,
      guestId: alice.guest.id,
      revision: 1,
      comments: [{ id: "a1", anchorText: "last line", prefix: "", suffix: "", body: "ALICE SECRET" }],
    });
    await shares.submitReview({
      shareId: share.id,
      guestId: bob.guest.id,
      revision: 1,
      comments: [{ id: "b1", anchorText: "remember", prefix: "", suffix: "", body: "BOB SECRET" }],
    });

    const aliceSees = await shares.listCommentsForGuest(alice.guest.id);
    const bobSees = await shares.listCommentsForGuest(bob.guest.id);

    expect(aliceSees.map((c: any) => c.body)).toEqual(["ALICE SECRET"]);
    expect(bobSees.map((c: any) => c.body)).toEqual(["BOB SECRET"]);
  });

  it("shows the owner everything, attributed", async () => {
    const ownerId = await makeOwner("owner-sees-all");
    const { share } = await shares.createShare({
      userId: ownerId,
      noteId: "note-2",
      title: "Draft",
      markdown: "Text.",
    });

    const alice = await shares.identifyGuest(share.id, "alice@example.com", "Alice");
    const bob = await shares.identifyGuest(share.id, "bob@example.com", "Bob");
    await shares.submitReview({
      shareId: share.id,
      guestId: alice.guest.id,
      revision: 1,
      comments: [{ id: "a1", anchorText: "", prefix: "", suffix: "", body: "from alice" }],
    });
    await shares.submitReview({
      shareId: share.id,
      guestId: bob.guest.id,
      revision: 1,
      comments: [{ id: "b1", anchorText: "", prefix: "", suffix: "", body: "from bob" }],
      editedFullText: "Bob's rewrite.",
    });

    const reviews = await shares.listReviewsForOwner(share.id, ownerId);
    expect(reviews).toHaveLength(2);

    const byEmail = Object.fromEntries(reviews.map((r: any) => [r.email, r]));
    expect(byEmail["alice@example.com"].comments[0].body).toBe("from alice");
    expect(byEmail["bob@example.com"].comments[0].body).toBe("from bob");
    expect(byEmail["bob@example.com"].editedFullText).toBe("Bob's rewrite.");
    expect(byEmail["alice@example.com"].editedFullText).toBeNull();
  });

  it("shows a different owner nothing at all", async () => {
    const ownerId = await makeOwner("owner-a");
    const strangerId = await makeOwner("owner-b");
    const { share } = await shares.createShare({
      userId: ownerId,
      noteId: "note-3",
      title: "Private",
      markdown: "Text.",
    });

    expect(await shares.listReviewsForOwner(share.id, strangerId)).toBeNull();
    expect(await shares.revokeShare(share.id, strangerId)).toBe(false);
    expect(await shares.resnapshotShare(share.id, strangerId, "hijacked", "Hijacked")).toBeNull();
  });

  it("does not let a stranger claim a reviewer's address to read their comments", async () => {
    // The attack the schema is shaped around. Alice reviews a draft. Someone
    // else holding the same link types alice@example.com hoping to be handed
    // her notes. They must get a fresh, empty identity instead.
    const ownerId = await makeOwner("owner-claim");
    const { share } = await shares.createShare({
      userId: ownerId,
      noteId: "note-4",
      title: "Draft",
      markdown: "Text.",
    });

    const alice = await shares.identifyGuest(share.id, "alice@example.com");
    await shares.submitReview({
      shareId: share.id,
      guestId: alice.guest.id,
      revision: 1,
      comments: [{ id: "a1", anchorText: "", prefix: "", suffix: "", body: "ALICE SECRET" }],
    });

    const impostor = await shares.identifyGuest(share.id, "alice@example.com");

    expect(impostor.guest.id).not.toBe(alice.guest.id);
    expect(await shares.listCommentsForGuest(impostor.guest.id)).toEqual([]);
    // And the impostor's token must not resolve to Alice's row.
    const resolved = await shares.findGuestByToken(impostor.token, share.id);
    expect(resolved?.id).toBe(impostor.guest.id);
  });

  it("does not let a guest token from one share work on another", async () => {
    const ownerId = await makeOwner("owner-cross");
    const first = await shares.createShare({
      userId: ownerId, noteId: "n1", title: "One", markdown: "A.",
    });
    const second = await shares.createShare({
      userId: ownerId, noteId: "n2", title: "Two", markdown: "B.",
    });

    const guest = await shares.identifyGuest(first.share.id, "alice@example.com");

    expect(await shares.findGuestByToken(guest.token, first.share.id)).not.toBeNull();
    expect(await shares.findGuestByToken(guest.token, second.share.id)).toBeNull();
  });

  it("stops resolving a revoked or expired link", async () => {
    const ownerId = await makeOwner("owner-revoke");
    const { share, token } = await shares.createShare({
      userId: ownerId, noteId: "n1", title: "One", markdown: "A.",
    });

    expect(await shares.findShareByToken(token)).not.toBeNull();
    await shares.revokeShare(share.id, ownerId);
    expect(await shares.findShareByToken(token)).toBeNull();

    // Feedback already given survives the door closing.
    const reviews = await shares.listReviewsForOwner(share.id, ownerId);
    expect(reviews).not.toBeNull();
  });

  it("stores only the hash, so the table yields no working links", async () => {
    const ownerId = await makeOwner("owner-hash");
    const { token } = await shares.createShare({
      userId: ownerId, noteId: "n1", title: "One", markdown: "A.",
    });
    const rows = await db.query("select token_hash from shares");
    expect(rows.some((r: any) => r.token_hash === token)).toBe(false);
  });

  it("resubmitting replaces that reviewer's set without touching anyone else's", async () => {
    const ownerId = await makeOwner("owner-resubmit");
    const { share } = await shares.createShare({
      userId: ownerId, noteId: "n1", title: "One", markdown: "A.",
    });
    const alice = await shares.identifyGuest(share.id, "alice@example.com");
    const bob = await shares.identifyGuest(share.id, "bob@example.com");

    await shares.submitReview({
      shareId: share.id, guestId: alice.guest.id, revision: 1,
      comments: [
        { id: "a1", anchorText: "", prefix: "", suffix: "", body: "first" },
        { id: "a2", anchorText: "", prefix: "", suffix: "", body: "second" },
      ],
    });
    await shares.submitReview({
      shareId: share.id, guestId: bob.guest.id, revision: 1,
      comments: [{ id: "b1", anchorText: "", prefix: "", suffix: "", body: "bob's" }],
    });

    // Alice deletes one locally and edits the other, then sends again.
    await shares.submitReview({
      shareId: share.id, guestId: alice.guest.id, revision: 1,
      comments: [{ id: "a1", anchorText: "", prefix: "", suffix: "", body: "first, revised" }],
    });

    const aliceSees = await shares.listCommentsForGuest(alice.guest.id);
    expect(aliceSees.map((c: any) => c.body)).toEqual(["first, revised"]);
    // Bob is untouched by Alice's delete-what-is-missing pass.
    const bobSees = await shares.listCommentsForGuest(bob.guest.id);
    expect(bobSees.map((c: any) => c.body)).toEqual(["bob's"]);
  });

  it("submitting nothing clears only the sender's comments", async () => {
    const ownerId = await makeOwner("owner-empty");
    const { share } = await shares.createShare({
      userId: ownerId, noteId: "n1", title: "One", markdown: "A.",
    });
    const alice = await shares.identifyGuest(share.id, "alice@example.com");
    const bob = await shares.identifyGuest(share.id, "bob@example.com");
    await shares.submitReview({
      shareId: share.id, guestId: alice.guest.id, revision: 1,
      comments: [{ id: "a1", anchorText: "", prefix: "", suffix: "", body: "alice" }],
    });
    await shares.submitReview({
      shareId: share.id, guestId: bob.guest.id, revision: 1,
      comments: [{ id: "b1", anchorText: "", prefix: "", suffix: "", body: "bob" }],
    });

    await shares.submitReview({
      shareId: share.id, guestId: alice.guest.id, revision: 1, comments: [],
    });

    expect(await shares.listCommentsForGuest(alice.guest.id)).toEqual([]);
    expect(await shares.listCommentsForGuest(bob.guest.id)).toHaveLength(1);
  });

  it("reissues an invited reviewer's link instead of forking their identity", async () => {
    const ownerId = await makeOwner("owner-invite");
    const { share } = await shares.createShare({
      userId: ownerId, noteId: "n1", title: "One", markdown: "A.",
    });

    const first = await shares.inviteGuests(share.id, ownerId, ["Alice@Example.com"]);
    const second = await shares.inviteGuests(share.id, ownerId, ["alice@example.com"]);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0].token).not.toBe(first[0].token);

    // One person, not two.
    const reviews = await shares.listReviewsForOwner(share.id, ownerId);
    expect(reviews).toHaveLength(1);

    // The reissued link works and the superseded one does not.
    expect(await shares.findGuestByToken(second[0].token, share.id)).not.toBeNull();
    expect(await shares.findGuestByToken(first[0].token, share.id)).toBeNull();
  });

  it("refuses to invite through a share the caller does not own", async () => {
    const ownerId = await makeOwner("owner-inv-a");
    const strangerId = await makeOwner("owner-inv-b");
    const { share } = await shares.createShare({
      userId: ownerId, noteId: "n1", title: "One", markdown: "A.",
    });
    expect(await shares.inviteGuests(share.id, strangerId, ["mallory@example.com"])).toEqual([]);
  });

  it("bumps the revision when the owner refreshes the snapshot", async () => {
    const ownerId = await makeOwner("owner-resnap");
    const { share, token } = await shares.createShare({
      userId: ownerId, noteId: "n1", title: "One", markdown: "First draft.",
    });
    expect(share.revision).toBe(1);

    const updated = await shares.resnapshotShare(share.id, ownerId, "Second draft.", "One");
    expect(updated.revision).toBe(2);

    // Same link, new text: reviewers are not asked to re-bookmark anything.
    const reloaded = await shares.findShareByToken(token);
    expect(reloaded.snapshotMarkdown).toBe("Second draft.");
  });
});
