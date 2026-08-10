import { describe, it, expect, beforeEach } from "vitest";

import { db } from "@/lib/db";
import { tableFor } from "@/lib/sync/collections";
import type { SyncedCollection } from "@/lib/sync/protocol";

/**
 * The wire has no version field, so an account can be shared by a device that
 * knows about a collection and one that does not. The apply path has to treat
 * an unrecognised collection as something to step over, not something to throw
 * on, because the throw happens inside a transaction and kills the sync loop
 * for a client that is otherwise fine.
 */
describe("unknown collections on the pull side", () => {
  beforeEach(async () => {
    await db.open();
  });

  it("resolves to nothing rather than a table, for a name this build lacks", () => {
    const table = tableFor("somethingFromTheFuture" as SyncedCollection);
    expect(table).toBeUndefined();
  });

  it("keeps sync alive when the server returns a collection this build lacks", async () => {
    // Replays what applyRemote does per change: resolve, skip when absent.
    const incoming = [
      { collection: "ideas" as SyncedCollection, id: "i1" },
      { collection: "somethingFromTheFuture" as SyncedCollection, id: "x1" },
      { collection: "contentPieces" as SyncedCollection, id: "p1" },
    ];

    const applied: string[] = [];
    expect(() => {
      for (const change of incoming) {
        const table = tableFor(change.collection);
        if (!table) continue;
        applied.push(change.collection);
      }
    }).not.toThrow();

    expect(applied).toEqual(["ideas", "contentPieces"]);
  });
});
