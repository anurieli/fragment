/**
 * Provider-agnostic identity, tested against a real Postgres.
 *
 * `findOrCreateUser` is the function migration 004 exists for: it replaced
 * `codex_sub` as the sole identity key with an `identities(provider, subject)`
 * mapping, specifically so Google can exist alongside Codex/ChatGPT without
 * either lying about a NOT NULL column or colliding on it. The behaviour that
 * matters — same pair reuses the user, different pairs never merge on email
 * alone — is a claim about the `identities` table's unique constraint and the
 * lookup query, which only a real database can confirm.
 *
 * Opt-in: set FRAGMENT_TEST_DATABASE_URL to a throwaway database. Skipped,
 * not failed, when unset.
 *
 *   createdb fragment_identity_test
 *   FRAGMENT_TEST_DATABASE_URL=postgres://.../fragment_identity_test \
 *     npx vitest run src/__tests__/identity.integration.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const TEST_DB = process.env.FRAGMENT_TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;

suite("provider-agnostic identity (real database)", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let identity: any;
  let db: any;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    db = await import("@/lib/server/db");
    identity = await import("@/lib/server/identity");

    const root = process.cwd();
    await db.query("drop schema if exists public cascade");
    await db.query("create schema public");
    for (const file of ["001_init.sql", "004_identities.sql"]) {
      await db.query(readFileSync(join(root, "db", "migrations", file), "utf8"));
    }
  }, 30_000);

  afterAll(async () => {
    const pool = db?.getPool?.();
    if (pool) await pool.end();
  });

  it("creates a new user for a first-seen (provider, subject)", async () => {
    const user = await identity.findOrCreateUser({
      provider: "openai",
      subject: "sub-1",
      email: "a@example.com",
      name: "A",
    });
    expect(user.email).toBe("a@example.com");
    expect(user.name).toBe("A");

    const rows = await db.query("select provider, subject from identities where user_id = $1", [
      user.id,
    ]);
    expect(rows).toEqual([{ provider: "openai", subject: "sub-1" }]);
  });

  it("reuses the same user on a repeat sign-in with the same identity", async () => {
    const first = await identity.findOrCreateUser({
      provider: "openai",
      subject: "sub-2",
      email: "b@example.com",
      name: "B",
    });
    const second = await identity.findOrCreateUser({
      provider: "openai",
      subject: "sub-2",
      email: "b@example.com",
      name: "B",
    });
    expect(second.id).toBe(first.id);

    const rows = await db.query("select count(*)::int as n from identities where user_id = $1", [
      first.id,
    ]);
    expect(rows[0].n).toBe(1);
  });

  it("does NOT merge two different providers just because the email matches", async () => {
    // The behaviour this migration deliberately does not implement.
    // Account linking is real scope (ARI-229), not something to infer from a
    // shared address, since addresses get reused and reassigned.
    const openai = await identity.findOrCreateUser({
      provider: "openai",
      subject: "shared-sub",
      email: "shared@example.com",
      name: "Same Person",
    });
    const google = await identity.findOrCreateUser({
      provider: "google",
      subject: "different-subject-same-email",
      email: "shared@example.com",
      name: "Same Person",
    });
    expect(google.id).not.toBe(openai.id);
  });

  it("keeps two providers with the same subject string as separate users", async () => {
    // (provider, subject) is the key, not subject alone — a Google `sub` and
    // an OpenAI `sub` are namespaced separately and must never collide.
    const a = await identity.findOrCreateUser({
      provider: "openai",
      subject: "collision",
      email: "x@example.com",
      name: null,
    });
    const b = await identity.findOrCreateUser({
      provider: "google",
      subject: "collision",
      email: "y@example.com",
      name: null,
    });
    expect(b.id).not.toBe(a.id);
  });

  it("refreshes the display cache from a later sign-in without erasing it with nulls", async () => {
    const first = await identity.findOrCreateUser({
      provider: "openai",
      subject: "sub-refresh",
      email: "old@example.com",
      name: "Old Name",
    });
    const updated = await identity.findOrCreateUser({
      provider: "openai",
      subject: "sub-refresh",
      email: "new@example.com",
      name: null,
    });
    expect(updated.id).toBe(first.id);
    expect(updated.email).toBe("new@example.com");
    // A sign-in that supplies no name must not blank out a name we already had.
    expect(updated.name).toBe("Old Name");
  });
});
