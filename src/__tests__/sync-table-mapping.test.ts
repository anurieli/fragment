import { describe, it, expect } from "vitest";

import { db } from "@/lib/db";
import { SYNCED_COLLECTIONS } from "@/lib/sync/protocol";
import { tableFor } from "@/lib/sync/collections";

/**
 * tableFor resolves a collection name straight to db[name], with no alias map
 * in between. That makes adding a collection a two-line change and a silent
 * failure at the same time: name one the database does not have and sync
 * throws at runtime, on a user's machine, mid-push. This is the check that
 * turns that into a failing build.
 */
describe("synced collections map to real tables", () => {
  it("resolves every collection to a Dexie table of the same name", async () => {
    await db.open();

    for (const collection of SYNCED_COLLECTIONS) {
      const table = tableFor(collection);
      expect(table, `no Dexie table named ${collection}`).toBeTruthy();
      expect(table.name).toBe(collection);
      // Reaching the table is not enough; it has to be queryable.
      await expect(table.limit(1).toArray()).resolves.toBeInstanceOf(Array);
    }
  });

  it("carries both version collections while the migration rolls out", () => {
    expect(SYNCED_COLLECTIONS).toContain("noteVersions");
    expect(SYNCED_COLLECTIONS).toContain("pieceVersions");
  });

  it("keeps local-only bookkeeping out of sync", () => {
    // migrations records whether *this device* reshaped its own copy. Syncing
    // it would let one device's failure look like every device's.
    expect(SYNCED_COLLECTIONS).not.toContain("migrations");
    expect(SYNCED_COLLECTIONS).not.toContain("outbox");
    expect(SYNCED_COLLECTIONS).not.toContain("syncState");
  });
});
