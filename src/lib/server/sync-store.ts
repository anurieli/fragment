import { transaction } from "./db";
import {
  MAX_PULL_CHANGES,
  type SyncChange,
  type SyncResponse,
  type SyncedCollection,
} from "@/lib/sync/protocol";

/**
 * The server half of delta sync: apply what a client pushed, then hand back
 * everything it has not seen.
 *
 * Both halves run in one transaction. A push that committed while its
 * accompanying pull failed would advance the client's cursor past changes it
 * never received, and those records would then never be delivered again.
 */

interface DocumentRow {
  collection: string;
  id: string;
  doc: Record<string, unknown> | null;
  updated_at: string;
  deleted: boolean;
  rev: string;
}

function rowToChange(row: DocumentRow): SyncChange {
  return {
    collection: row.collection as SyncedCollection,
    id: row.id,
    doc: row.doc,
    // bigint arrives from pg as a string; the wire format is a number.
    updatedAt: Number(row.updated_at),
    deleted: row.deleted,
  };
}

/**
 * Collapse repeats of the same record, keeping the newest.
 *
 * Postgres refuses to let one INSERT ... ON CONFLICT touch the same row twice,
 * so a client that queued two edits to one note between flushes would
 * otherwise fail the entire batch.
 */
function dedupeChanges(changes: SyncChange[]): SyncChange[] {
  const byKey = new Map<string, SyncChange>();
  for (const change of changes) {
    const key = `${change.collection}:${change.id}`;
    const existing = byKey.get(key);
    if (!existing || change.updatedAt >= existing.updatedAt) {
      byKey.set(key, change);
    }
  }
  return [...byKey.values()];
}

export async function applySync(
  userId: string,
  cursor: number,
  incoming: SyncChange[],
): Promise<SyncResponse> {
  const changes = dedupeChanges(incoming);

  return transaction(async (client) => {
    const accepted = new Set<string>();

    if (changes.length > 0) {
      // One statement for the whole batch. `doc` travels as text and is cast
      // per row, because a jsonb[] bind parameter has to be array-quoted by
      // hand and JSON bodies are exactly the strings that get that wrong.
      const result = await client.query<{ collection: string; id: string }>(
        `insert into documents (user_id, collection, id, doc, updated_at, deleted, rev)
         select $1,
                c.collection,
                c.id,
                c.doc::jsonb,
                c.updated_at,
                c.deleted,
                nextval('documents_rev_seq')
           from unnest($2::text[], $3::text[], $4::text[], $5::bigint[], $6::boolean[])
                as c(collection, id, doc, updated_at, deleted)
         on conflict (user_id, collection, id) do update
            set doc        = excluded.doc,
                updated_at = excluded.updated_at,
                deleted    = excluded.deleted,
                rev        = nextval('documents_rev_seq')
          where excluded.updated_at > documents.updated_at
         returning collection, id`,
        [
          userId,
          changes.map((c) => c.collection),
          changes.map((c) => c.id),
          changes.map((c) => (c.doc === null ? null : JSON.stringify(c.doc))),
          changes.map((c) => Math.trunc(c.updatedAt)),
          changes.map((c) => c.deleted),
        ],
      );

      for (const row of result.rows) accepted.add(`${row.collection}:${row.id}`);
    }

    // Pull one more than the page size to learn whether more remains without
    // a second count query.
    const pulled = await client.query<DocumentRow>(
      `select collection, id, doc, updated_at, deleted, rev
         from documents
        where user_id = $1 and rev > $2
        order by rev
        limit $3`,
      [userId, cursor, MAX_PULL_CHANGES + 1],
    );

    const hasMore = pulled.rows.length > MAX_PULL_CHANGES;
    const page = hasMore ? pulled.rows.slice(0, MAX_PULL_CHANGES) : pulled.rows;

    // The cursor may only move forward, and only as far as this page reaches.
    const nextCursor = page.reduce((max, row) => Math.max(max, Number(row.rev)), cursor);

    const out = page.map(rowToChange);
    const seen = new Set(out.map((c) => `${c.collection}:${c.id}`));

    // A push the server declined — because it held a newer version — must come
    // back down, otherwise the client keeps a losing value it believes it saved.
    // Usually the winning row is already in the page above; this covers the
    // case where its rev sits at or below the client's cursor.
    const rejected = changes
      .map((c) => `${c.collection}:${c.id}`)
      .filter((key) => !accepted.has(key) && !seen.has(key));

    if (rejected.length > 0) {
      const winners = await client.query<DocumentRow>(
        `select collection, id, doc, updated_at, deleted, rev
           from documents
          where user_id = $1
            and (collection || ':' || id) = any($2::text[])`,
        [userId, rejected],
      );
      for (const row of winners.rows) out.push(rowToChange(row));
    }

    return { cursor: nextCursor, changes: out, hasMore };
  });
}
