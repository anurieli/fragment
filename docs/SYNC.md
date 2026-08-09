# Sync

How a Fragment client and the hosted server exchange writing, and what happens
when they disagree. The contract lives in `src/lib/sync/protocol.ts` and is
imported by both sides on purpose, so a change to it cannot land on one side
only.

Sync is optional. A device with no account never calls any of this, and the
engine's failure paths all end in "carry on locally".

## The delta protocol

One POST carries both directions. The client sends what it has changed and the
cursor it has reached; the server applies the changes, then answers with
everything above that cursor.

```ts
interface SyncChange {
  collection: SyncedCollection;
  id: string;
  /** The record body. Null when `deleted`. */
  doc: Record<string, unknown> | null;
  /** Client wall clock, ms. Drives last-write-wins. */
  updatedAt: number;
  deleted: boolean;
}

interface SyncRequest  { cursor: number; changes: SyncChange[] }
interface SyncResponse { cursor: number; changes: SyncChange[]; hasMore: boolean }
```

The cursor is a server-assigned monotonic `rev`. Every stored row carries one,
drawn from a single global sequence (`documents_rev_seq` in
`db/migrations/001_init.sql`), and a client's cursor is the highest `rev` it has
applied. Pulling is therefore `where user_id = $1 and rev > $2 order by rev`,
which resumes exactly where it stopped and needs no timestamps and no
full-table scan. The cursor only ever moves forward, and only as far as the
returned page reaches.

`updatedAt` is unrelated to the cursor. It is the client's wall clock, and it
exists to decide which of two concurrent edits wins.

Both directions are capped at 500 changes:

```ts
export const MAX_PUSH_CHANGES = 500;
export const MAX_PULL_CHANGES = 500;
```

A push above the cap is rejected by the parser. On the pull side the server
selects `MAX_PULL_CHANGES + 1` rows so it can set `hasMore` without a second
count query, then trims the page back to 500. The client keeps looping while
`hasMore` is true or the outbox still has entries, with a guard of 100
iterations.

The route (`src/app/api/v1/sync/route.ts`) adds two more bounds: an 8 MB body
limit, and a rate limit of 60 requests per minute counted per account rather
than per IP, because the thing worth bounding is how fast one signed-in user
can grow the shared `documents` table.

## Which collections sync

`SYNCED_COLLECTIONS` in `src/lib/sync/protocol.ts`:

`notes`, `snippets`, `noteVersions`, `pieceVersions`, `ideas`,
`contentPieces`, `resources`, `reviews`, `voices`, `voiceSamples`, `settings`.

`tableFor(collection)` in `src/lib/sync/collections.ts` resolves a collection
name straight to `db[collection]`, with no alias map in between. A collection
name is a Dexie table name. That keeps adding a collection to a two-line change
and makes a typo a runtime failure on a user's machine mid-push, which is why
`src/__tests__/sync-table-mapping.test.ts` asserts that every collection
resolves to a queryable table of the same name and turns the mistake into a
failing build.

Excluded, and why:

- `apiLogs`, `feedbackQueue`: telemetry, not the user's writing. They have
  their own one-way endpoints and should never come back down to a client.
- `images`: binary blobs. They belong in object storage with the document
  holding a key, not inlined as base64 in every delta.
- `outbox`, `syncState`: this device's sync bookkeeping. Syncing the queue of
  what this machine still owes the server, or its cursor, is meaningless on
  another machine.
- `migrations`: records whether *this device* has reshaped its own copy for the
  one-entity migration. Syncing it would let one device's failure look like
  every device's.

The first three are documented in a comment in `protocol.ts`; the last three
are asserted in `sync-table-mapping.test.ts` and explained in `src/lib/db.ts`
(v19 and v20) and `src/lib/types.ts`.

## The outbox

`src/lib/sync/outbox.ts` records what changed. The entries come from Dexie
table hooks (`creating`, `updating`, `deleting`) installed on every synced
table, not from calls sprinkled through `persistence.ts`. A hook cannot be
forgotten: every existing writer is covered without editing it, and so is the
next one somebody adds, which matters because a record that silently stops
syncing is close to invisible until a user loses work on a second device.

The table is keyed `[collection+id]` (see `src/lib/db.ts` v19). Repeat edits to
the same record collapse onto one pending row instead of queueing a duplicate
push. Within a single microtask batch the hooks also collapse by key before
writing.

Hooks fire inside the caller's transaction, whose scope does not include the
outbox table, so entries are buffered and written on the next microtask. A
failed outbox write is swallowed: the record itself is already stored, so it
syncs on its next edit rather than now, and the user's save is never broken.

Applying a pulled change is itself a Dexie write, so without a marker it would
enqueue that change straight back and every sync would echo forever. The marker
is set on the transaction, not in a module-level flag:

```ts
const REMOTE_APPLY = Symbol.for("fragment.sync.remoteApply");
```

A global boolean would be wrong the moment a user edit lands while a pull is in
flight; it would suppress a real local change and lose it.

`clearPushed` removes an entry only when its `updatedAt` is still at or below
the value that was sent. An edit made while the request was in flight bumps the
entry past that value and survives.

## The engine loop

`src/lib/sync/engine.ts`.

`syncNow()` is single-flight. A second caller while a run is in progress sets
`rerunRequested` rather than starting a parallel run, and the in-flight run
repeats when it finishes, so its changes are not dropped.

Order of a run:

1. `isCloudReachable()`. No cloud configured means status `disabled` and
   nothing else.
2. `fetchCurrentUser()`. No session means status `signed-out`.
3. Account check. If `syncState.userId` is set and differs from the signed-in
   user, the engine stops with `account-mismatch` rather than guessing whose
   data the device holds. `resetSyncLink()` is the escape hatch and deletes no
   writing.
4. First link. If `syncState.userId` is unset, `seedOutboxFromLocal()` queues
   every local record in every synced collection, so writing that predates
   sign-in becomes the starting content of the account instead of being
   stranded in the browser it was written in. Then the account id is recorded.
5. Loop: take up to `MAX_PUSH_CHANGES` pending entries oldest first, read each
   record's current body, run it through `sanitizeForSync`, POST, apply the
   response, clear the pushed entries, save the new cursor. Continue while
   `hasMore` or the outbox is non-empty. If a round trip pushes nothing and
   pulls nothing, stop, so a permanently rejected entry cannot spin forever.

`buildChanges` handles a record queued as an edit but gone by the time it is
read: the truthful thing to send is the deletion, so it becomes a tombstone.

`applyRemote` writes pulled changes inside one transaction tagged as a remote
apply. Before writing each record it checks the outbox: a local edit still
waiting to be pushed and newer than what arrived wins, because it is about to
be sent and overwriting it would destroy a change the user made.

A sync is triggered by: an outbox write (through `setOutboxListener`, debounced
1.5 seconds so a burst of keystrokes becomes one round trip), a 30 second
interval, the `online` event, the tab becoming visible, and once at
`startSyncEngine()`.

The engine has no React dependency and runs from module scope.
`src/stores/sync-store.ts` mirrors its snapshot into Zustand, and
`src/hooks/use-cloud-sync.ts` refetches the stores when `dataRevision`
increments, which happens only when remote changes actually landed.

## Conflict resolution

Last-write-wins per whole record, on `updatedAt`. The higher `updatedAt`
survives intact; the older version is discarded, not merged.

Enforcement is server-side, in the `ON CONFLICT` clause in
`src/lib/server/sync-store.ts`:

```sql
on conflict (user_id, collection, id) do update
   set doc = excluded.doc, updated_at = excluded.updated_at,
       deleted = excluded.deleted, rev = nextval('documents_rev_seq')
 where excluded.updated_at > documents.updated_at
```

The comparison is strictly greater, so equal timestamps leave the stored row
alone. A push the server declines has to come back down, otherwise the client
keeps a losing value it believes it saved; `applySync` collects the rejected
keys and appends the winning rows to the response, covering the case where the
winner's `rev` sits at or below the client's cursor.

The server also collapses repeats of the same record before the write, keeping
the newest, because Postgres refuses to let one `INSERT ... ON CONFLICT` touch
the same row twice and a client that queued two edits to one note between
flushes would otherwise fail the whole batch.

The rationale, paraphrased from the comment at the top of `protocol.ts`: whole
record last-write-wins is the honest trade for a writing app. Two devices
editing the same note at the same time is rare, and a merge that interleaved
characters from both would corrupt prose in ways a writer cannot undo, whereas
losing the older of two versions is recoverable from version history.

Push and pull run in one server transaction. A push that committed while its
pull failed would advance the client's cursor past changes it never received,
and those records would never be delivered again.

## Tombstones

Two different deletions exist, and they are not the same mechanism.

**Protocol tombstone.** On the wire it is `{ doc: null, deleted: true }`. The
parser drops any body on a tombstone unconditionally, because keeping it would
leave deleted content readable on the server after the user removed it. Server
side the row stays, soft: `doc` null, `deleted` true, and a fresh `rev` so
every other device pulls the deletion. Locally the client hard deletes the
Dexie row (`table.delete(change.id)` in `applyRemote`), and for notes it also
removes the `localStorage` and filesystem recovery copies through
`removeNoteBackupArtifacts`.

**Application soft delete.** Ideas and fragments carry an optional `deletedAt`
timestamp (`Idea.deletedAt`, `ContentPiece.deletedAt` in
`src/lib/content-engine/contract.ts`). Setting it is an ordinary field update:
the row stays in Dexie, the outbox `updating` hook fires, and the record syncs
as a normal change with `deleted: false`. The protocol does not know these rows
are deleted, and it does not need to. `deletePieceRow` in
`src/lib/persistence.ts` is the hard delete, and its comment notes that the
store's normal reject path tombstones instead.

## Validation

`parseSyncRequest` in `protocol.ts` is a trust boundary: the endpoint takes
writes from anyone holding a session cookie. It returns an error string instead
of throwing, so the route can answer 400 with something specific. It checks:

- the body is an object;
- `cursor` is a finite number and not negative;
- `changes` is an array of at most `MAX_PUSH_CHANGES` entries;
- each change is an object;
- `collection` is in `SYNCED_COLLECTIONS`. Unknown names are rejected outright:
  without that check a caller could write unbounded junk into the `documents`
  table under names the client will never read back;
- `id` is a non-empty string of at most 200 characters;
- `updatedAt` is a finite number;
- `doc` is a plain object unless `deleted` is true.

Record bodies are opaque beyond that. Nothing inspects the fields inside `doc`,
on either side. `documents.doc` is `jsonb` and the server does not model what a
note or an idea contains, which is what lets the Dexie schema move forward
without a server migration behind every field.

A single bad change rejects the whole batch. `parseSyncRequest` returns on the
first failure and the route answers 400, so nothing in that request is applied.

There is **no protocol version field on the wire.** `SyncRequest` carries
`cursor` and `changes` and nothing else, and the parser never checks a version.
This is a known limitation. There is no place to put a "this client speaks
version N" statement, no negotiation, and no way for the server to answer
"upgrade first". Related: `applyRemote` calls `tableFor(change.collection)` for
whatever the server returns, without re-checking membership, so a build whose
Dexie schema lacks a table the server sends has nothing to write into.

Ownership is not part of the payload. Every row read or written is scoped to
the session's user id, taken from the session cookie and never from the request
body; there is no parameter by which a caller can name whose documents to
touch.

## The one-entity transition

A migration is in progress that merges `Note` into `ContentPiece`, so that a
fragment holds its own text. Dexie is at v20, which added the groundwork; the
UI has not switched over, and the data migration is run by hand through
`window.fragmentMigration` (see `src/lib/migration/console.ts`). Nothing below
describes a finished state.

Both version collections sync at once:

```ts
"noteVersions",
// Version history keyed to fragments rather than notes. Runs alongside
// noteVersions while the one-entity migration rolls out: a device that has
// not migrated yet still writes noteVersions, and both have to reach every
// device or a version saved on one machine would be missing on another.
"pieceVersions",
```

The migration is additive and deterministic. It copies text into fragments and
leaves every note, version, and review in place, so the worst case is a library
holding two copies of itself rather than one holding none. It derives every
write from a plan that is a pure function of the rows it is handed
(`src/lib/migration/plan.ts`), with ids like `mig-<noteId>` and
`migp-<noteId>`, so two devices running it against the same library produce
byte-identical rows under identical ids and sync merges them into one copy
instead of racing. The plan also reads existing state off the rows themselves,
through `legacyNoteId`, rather than off the local `migrations` bookkeeping row,
because that row is local-only and can be absent on a device whose data arrived
already migrated by sync.

The consequence for the wire: **a device running older code and a device
running newer code can currently share an account, and nothing in the protocol
distinguishes them.** There is no version field, no capability list, and no
per-collection negotiation. A migrated device pushes `contentPieces` rows with
`body` and `legacyNoteId` set and `noteId` cleared, plus `pieceVersions` rows;
an unmigrated device pushes `contentPieces` rows that still point at a note,
plus `noteVersions` rows. The server stores both without noticing, because
`doc` is opaque to it. That is why `noteVersions` and `pieceVersions` are both
in `SYNCED_COLLECTIONS` and why `snippets` and `reviews` gained `pieceId`
indexes alongside `noteId` in v20: both keys are live at once until every
device has moved across.

Retiring `notes`, `noteVersions`, and the `noteId` link is a separate decision,
to be made once every device has moved across.

## Testing

```bash
npm test             # unit tests, including the sync suite
npm run verify:sync  # live end-to-end check against a real server and Postgres
```

Unit coverage: `src/__tests__/sync-protocol.test.ts` (what the parser must
refuse, not just what it accepts), `src/__tests__/sync-collections.test.ts`
(credentials stripped on the way up, restored on the way down),
`src/__tests__/sync-table-mapping.test.ts` (every collection resolves to a real
Dexie table).

`scripts/verify-sync.mjs` is deliberately not a Vitest file. Everything that
makes sync hard lives where a mocked test cannot reach: the `ON CONFLICT`
clause that decides which edit wins, the session lookup, the per-user scoping
of every row. Those are SQL and HTTP, so the script drives SQL and HTTP. It
creates a throwaway user, syncs as two devices against it, and deletes it
again. It needs `DATABASE_URL` and a running server:

```bash
npm run build && npx next start -p 3012 &
npm run verify:sync
```

Override the target with `FRAGMENT_TEST_BASE` (default
`http://127.0.0.1:3012`). Run it after any change to the sync route, the
protocol, or the schema.
