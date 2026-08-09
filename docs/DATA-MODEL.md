# Fragment Data Model

What Fragment stores, where it stores it, and which rules hold it together.

This describes the model **as it is on disk today**, on the `one-entity-model`
branch. The Dexie schema is at v20. A migration that merges `Note` into
`ContentPiece` exists and is tested, but it does not run on its own and the UI
has not switched over. Section 6 covers that transition and marks what is not
yet shipped.

Source of truth for every claim below: `src/lib/content-engine/contract.ts`,
`src/lib/types.ts`, `src/lib/db.ts`, `src/lib/persistence.ts`,
`src/lib/sync/`, `src/lib/migration/`, and `db/migrations/`.

---

## 1. The entities in plain language

Ten entities carry the user's writing. Everything else in the database is
settings, telemetry, or sync bookkeeping.

**Idea** (`Idea`, `src/lib/content-engine/contract.ts`) is a container. It holds
fragments and can hold child ideas. Nesting is one level deep: a child idea's
parent must itself be a root idea, so the maximum depth is 2. The rule is
enforced at write time by `assertIdeaParentAllowed`, which refuses a parent that
already has a parent, and refuses a parent that is deleted.

**ContentPiece** (`ContentPiece`, same file) is a single piece of writing that
belongs to exactly one idea. The migration code and the one-entity work call it
a "fragment"; the shipped UI still labels it a "Piece". Today its text lives in
one of two places and never both:

- inline in `body`, as markdown, for short-form pieces, or
- in a linked `Note`, referenced by `noteId`, for long-form pieces.

`pieceContentHome` enforces that exactly one of the two is set. Neither set, or
both set, throws a `ContractError`.

**Note** (`Note`, `src/lib/types.ts`) is a long-form document: title, optional
subtitle, markdown content, and a writing brief made of `goal`, `audience`,
`tone`, `remember`, plus a voice selection. A note becomes part of an idea when
a piece links it via `noteId`. A note with no piece pointing at it is a
standalone note.

**Snippet** (`Snippet`, `src/lib/types.ts`), called a "snip" in the UI, is a cut
of text parked in the Snip Bar. A snippet has one *home*, either a note or an
idea, computed by `snippetHome` in `src/lib/snip-scope.ts`. `order` is
sequential within a home, never across homes.

The satellites:

- **NoteVersion**: a saved snapshot of a note, keyed by `noteId`.
- **PieceVersion**: the same record keyed by `pieceId` instead. Written only by
  the one-entity migration today.
- **StoredReview**: a reviewer's returned comments after import, keyed by
  `noteId`.
- **Resource**: a link, note, or asset attached to an idea or a piece.
- **BrandVoice**: a named writing voice with an optional distilled
  `VoiceProfile`.
- **VoiceSample**: a raw writing sample belonging to one voice.

---

## 2. Field reference

### Idea

```ts
interface Idea {
  id: string;
  title: string;
  summary?: string;
  parentId: string | null;
  priority: Priority;
  pinnedAt?: number;
  voiceId?: string;
  origin: PieceOrigin;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | `string` | yes | Stable id, 1 to 64 chars per `idSchema`. |
| `title` | `string` | yes | Display name. |
| `summary` | `string` | no | One-line description shown in the idea workspace header. |
| `parentId` | `string \| null` | yes (nullable) | Parent idea, or `null` for a root idea. A non-null value must name a root idea. |
| `priority` | `0 \| 1 \| 2 \| 3 \| 4` | yes | 0 none, 1 urgent, 2 high, 3 medium, 4 low (Linear convention). |
| `pinnedAt` | `number` | no | Epoch ms when pinned. Absent means not pinned. |
| `voiceId` | `string` | no | A specific voice. Note the narrower type than `ContentPiece.voiceId`: an idea has no explicit "no voice" state. |
| `origin` | `"agent" \| "user"` | yes | Who created it. |
| `createdAt` / `updatedAt` | `number` | yes | Epoch ms. |
| `deletedAt` | `number` | no | Soft delete. See "Two kinds of deletion" below. |

### ContentPiece

```ts
interface ContentPiece {
  id: string;
  ideaId: string;
  format: ContentFormat;
  status: PieceStatus;
  origin: PieceOrigin;
  title?: string;
  noteId?: string;
  body?: string;
  subtitle?: string;
  goal?: string;
  audience?: string;
  tone?: string;
  remember?: string;
  voiceId?: string | null;
  legacyNoteId?: string;
  seen: boolean;
  priority: Priority;
  order: number;
  scheduledAt?: number;
  publish?: PublishRecord;
  publishAttemptedAt?: number;
  agentMeta?: AgentMeta;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | `string` | yes | Stable id. |
| `ideaId` | `string` | yes | The idea this piece belongs to. Every piece has one. |
| `format` | `"linkedin" \| "tweet" \| "substack" \| "essay" \| "script" \| "other"` | yes | `LONGFORM_FORMATS` (`essay`, `substack`, `script`) are the ones `isLongformFormat` reports as belonging in the editor rather than a feed card. Format is about shape, not storage. |
| `status` | `"inbox" \| "in-progress" \| "ready" \| "published"` | yes | Triage state. |
| `origin` | `"agent" \| "user"` | yes | Who created it. |
| `title` | `string` | no | Display title. |
| `noteId` | `string` | no | Content home A: the linked note holding this piece's text. |
| `body` | `string` | no | Content home B: markdown held inline. Exactly one of `noteId` / `body` is set. |
| `subtitle` | `string` | no | One-line dek under the title. Added for the one-entity model. |
| `goal`, `audience`, `tone`, `remember` | `string` | no | The writing brief. Added for the one-entity model; carried over from the absorbed note. |
| `voiceId` | `string \| null` | no | Three states, see below. |
| `legacyNoteId` | `string` | no | The note this piece's text came from. Set once by the migration and never afterwards. |
| `seen` | `boolean` | yes | False while a piece is still untriaged in the inbox. |
| `priority` | `0 \| 1 \| 2 \| 3 \| 4` | yes | Same scale as `Idea.priority`. |
| `order` | `number` | yes | Position within its feed. |
| `scheduledAt` | `number` | no | Epoch ms the piece is scheduled for. |
| `publish` | `PublishRecord` | no | Set if and only if `status === "published"`. See `assertPublishGuard`. |
| `publishAttemptedAt` | `number` | no | Stamped when a Substack publish attempt fires; cleared on the piece's next status change. While set and status is not yet `published`, the piece is awaiting an RSS verification match. |
| `agentMeta` | `AgentMeta` | no | `{ agent, model?, pushedAt, supersedes? }` for agent-pushed pieces. `supersedes` points at the piece this one replaces; re-drafts arrive as new pieces, never as in-place overwrites. |
| `createdAt` / `updatedAt` | `number` | yes | Epoch ms. |
| `deletedAt` | `number` | no | Soft delete. |

`PublishRecord` is `{ platform: ContentFormat; method: "composio" | "copy" | "manual" | "kit"; publishedAt: number; url?: string; verified: boolean }`. `verified` is false while awaiting go-live confirmation.

#### `voiceId` has three states

`voiceId` is declared `string | null | undefined` on `ContentPiece`, `Note`,
`NoteVersion`, and `PieceVersion`. The three states are distinct and all three
are meaningful:

| Value | Meaning |
|---|---|
| `undefined` (absent) | Inherit the default voice from `BrandVoiceSettings.defaultVoiceId`. |
| `null` | Explicitly no voice. The writer turned voice off for this record. |
| `"<voice id>"` | That specific `BrandVoice`. |

Because absence carries meaning, code that copies these records has to preserve
the difference between "absent" and "null". The migration's verification gate
checks this directly rather than folding it into a general presence check:
`describeContextMismatch` in `src/lib/migration/verify.ts` compares
`note.voiceId !== piece.voiceId` on its own line, separate from the hashed
comparison used for the other brief fields.

#### Two kinds of deletion

`deletedAt` on `Idea` and `ContentPiece` is an **application-level soft
delete**. The row stays in Dexie. Reads filter on `deletedAt === undefined`, and
undo simply strips the field back off, which is what
`src/stores/content-store.ts` does when it destructures `const { deletedAt:
_deletedAt, ...rest }`. Deleting an idea cascades soft deletes to its child
ideas and its pieces.

A **sync tombstone** is a different thing. It is the `deleted: true` flag on an
`OutboxEntry` and on a `SyncChange`, and it means the row is gone locally and
must be removed on the server. A tombstone carries no document body:
`parseSyncRequest` drops `doc` whenever `deleted` is true, so deleted content is
not left readable on the server. The server records it as `documents.deleted =
true`.

So a soft-deleted piece still syncs as a normal record whose `deletedAt` field
happens to be set. Only a hard delete, such as `deletePieceRow` or the
`table.delete` inside `applyRemote`, produces a tombstone.

### Note

```ts
interface Note {
  id: string;
  title: string;
  subtitle?: string;
  content: string;
  goal: string;
  audience: string;
  tone: string;
  remember: string;
  voiceId?: string | null;
  createdAt: number;
  updatedAt: number;
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | `string` | yes | Stable id. |
| `title` | `string` | yes | May be an empty string; the migration derives a title from the first content line when it is. |
| `subtitle` | `string` | no | One-line dek under the title in the editor. Optional because pre-existing notes have none. |
| `content` | `string` | yes | The markdown document. |
| `goal`, `audience`, `tone`, `remember` | `string` | yes | The writing brief. Backfilled to `""` by the Dexie v10 upgrade. |
| `voiceId` | `string \| null` | no | Three states, as above. |
| `createdAt` / `updatedAt` | `number` | yes | Epoch ms. |

A `Note` has no `deletedAt`. Note deletion is a hard delete.

### Snippet

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | `string` | yes | Stable id. |
| `noteId` | `string \| null` | yes (nullable) | The note this snippet was cut from, or `null` when it was cut from a short-form piece. |
| `content` | `string` | yes | The cut text. |
| `label` | `string \| null` | yes (nullable) | AI-generated label, `null` before one exists. |
| `labelStatus` | `"idle" \| "loading" \| "done" \| "error"` | yes | Labeling state. |
| `createdAt` | `number` | yes | Epoch ms. |
| `order` | `number` | yes | Position within its home. |
| `ideaId` | `string` | no | The idea this snippet belongs to. Existing rows are not backfilled. |
| `pieceId` | `string` | no | The fragment it was cut from. Present alongside `noteId` during the migration window. |

### NoteVersion

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | `string` | yes | Stable id. |
| `noteId` | `string` | yes | The note this snapshot belongs to. |
| `title` | `string` | yes | Snapshot of the note title. |
| `subtitle` | `string` | no | Snapshot of `Note.subtitle`. |
| `content` | `string` | yes | Snapshot of the markdown. |
| `goal`, `audience`, `tone`, `remember` | `string` | yes | Snapshot of the brief. |
| `voiceId` | `string \| null` | no | Snapshot of the voice selection, three states preserved. |
| `name` | `string` | yes | The version's display name. |
| `trigger` | `VersionTrigger` | yes | One of `manual`, `export-md`, `export-html`, `download-md`, `download-html`, `download-pdf`, `download-docx`. |
| `wordCount` | `number` | yes | Word count at snapshot time. |
| `createdAt` | `number` | yes | Epoch ms. |

### PieceVersion

Identical to `NoteVersion` except for the key fields:

| Field | Type | Required | Meaning |
|---|---|---|---|
| `pieceId` | `string` | yes | The fragment this snapshot belongs to. Replaces `noteId`. |
| `legacyNoteId` | `string` | no | The note id this row was carried over from, so a fragment's timeline stays continuous across the migration. |

Every other field (`id`, `title`, `subtitle`, `content`, `goal`, `audience`,
`tone`, `remember`, `voiceId`, `name`, `trigger`, `wordCount`, `createdAt`)
matches `NoteVersion`.

### StoredReview

`StoredReview extends ReviewReturn`, so it carries both sets of fields.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | `string` | yes | Stable id. |
| `noteId` | `string` | yes | The note the review is about. |
| `pieceId` | `string` | no | The fragment the review is about. Present alongside `noteId` during the migration window so old share links keep resolving. |
| `receivedAt` | `number` | yes | When the review file was imported, not the reviewer's own timestamp. |
| `docId` | `string` | yes | Document id from the `.fragment-review.json` file. |
| `reviewerName` | `string` | yes | Reviewer's self-reported name. |
| `timestamp` | `number` | yes | The reviewer's own timestamp. |
| `comments` | `ReviewComment[]` | yes | `{ id, anchorText, prefix, suffix, body }` each. Empty `anchorText` means a general comment rather than one anchored to a selection; `prefix` and `suffix` disambiguate duplicate `anchorText` occurrences. |
| `editedFullText` | `string` | no | The reviewer's edited copy of the whole draft, when editing was allowed. |
| `reviewerEmail` | `string` | no | Hosted reviews only. Never set for emailed or imported `.fragment-review.json` files, which carry no verified address. |

### Resource

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | `string` | yes | Stable id. |
| `ownerType` | `"idea" \| "piece"` | yes | What kind of thing owns it. |
| `ownerId` | `string` | yes | The owning idea or piece. |
| `kind` | `"link" \| "note" \| "asset"` | yes | What the resource is. |
| `url` | `string` | no | Present for links and assets. |
| `title` | `string` | yes | Display title. |
| `note` | `string` | no | Free-text annotation. |
| `createdAt` | `number` | yes | Epoch ms. |

### BrandVoice

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | `string` | yes | Stable id. Referenced by `voiceId` on pieces, notes, and versions. |
| `name` | `string` | yes | Display name. |
| `description` | `string` | yes | User-written. Feeds analysis and is the pre-analysis fallback context. |
| `template` | `string` | yes | Structure guide, injected verbatim into generation prompts. |
| `profile` | `VoiceProfile \| null` | yes (nullable) | The distilled profile, `null` before analysis. `VoiceProfile` is `{ summary, traits[], exampleExcerpts[], doGuidance[], dontGuidance[] }` and never contains raw samples. |
| `profileStale` | `boolean` | yes | True when samples changed since the last analysis. |
| `profileUpdatedAt` | `number \| null` | yes (nullable) | When the profile was last produced. |
| `analyzedSampleCount` | `number` | yes | How many samples the current profile was built from. |
| `createdAt` / `updatedAt` | `number` | yes | Epoch ms. |

### VoiceSample

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | `string` | yes | Stable id. |
| `voiceId` | `string` | yes | The voice this sample belongs to. |
| `title` | `string` | yes | Display title. |
| `source` | `"paste" \| "file"` | yes | How the sample arrived. |
| `text` | `string` | yes | The raw sample. |
| `charCount` | `number` | yes | Length of `text`. |
| `createdAt` | `number` | yes | Epoch ms. |

---

## 3. The local schema (Dexie v20)

The database is named `fragment` and is declared in `src/lib/db.ts`. Version 20
was added by ARI-171 and is purely additive: it introduces `pieceVersions` and
`migrations`, adds a `pieceId` index to `snippets` and `reviews`, and adds a
`legacyNoteId` index to `contentPieces`. Nothing is rewritten in the upgrade
callback, because the data migration runs after the database is open, under its
own verification gate.

Index strings verbatim from the `this.version(20).stores({ ... })` block:

| Table | Index string | Holds | Synced |
|---|---|---|---|
| `notes` | `id, updatedAt` | Long-form documents. | yes |
| `snippets` | `id, noteId, order, ideaId, pieceId` | Snips in the Snip Bar. | yes |
| `settings` | `id` | The single `AppSettings` row. | yes, with fields stripped |
| `noteVersions` | `id, noteId, createdAt` | Version history keyed to notes. | yes |
| `pieceVersions` | `id, pieceId, createdAt` | Version history keyed to fragments. | yes |
| `images` | `id, noteId, createdAt` | Declared for `StoredImage`. **Currently unused by any code.** | no |
| `apiLogs` | `id, timestamp, route, provider, status, noteId, synced` | Per-request AI call telemetry. | no |
| `feedbackQueue` | `id, status, createdAt` | Pending in-app feedback submissions. | no |
| `voices` | `id, updatedAt` | Brand voices. | yes |
| `voiceSamples` | `id, voiceId, createdAt` | Raw writing samples. | yes |
| `ideas` | `id, parentId, pinnedAt, priority, updatedAt, createdAt` | Idea containers. | yes |
| `contentPieces` | `id, ideaId, noteId, legacyNoteId, status, format, priority, scheduledAt, updatedAt, createdAt, [ideaId+status], [status+format], [status+priority]` | Fragments. | yes |
| `resources` | `id, ownerId, ownerType, createdAt` | Links, notes, and assets. | yes |
| `reviews` | `id, noteId, receivedAt, pieceId` | Imported reviewer returns. | yes |
| `outbox` | `[collection+id], collection, updatedAt` | Local changes waiting to be pushed. | no |
| `syncState` | `id` | One row, id `main`: cursor, `lastSyncedAt`, `userId`. | no |
| `migrations` | `id, status` | One-off data-migration bookkeeping. | no |

### Local-only tables

Six tables never leave the device: `apiLogs`, `feedbackQueue`, `images`,
`outbox`, `syncState`, `migrations`. None of them appears in
`SYNCED_COLLECTIONS` in `src/lib/sync/protocol.ts`, and the reasons are
recorded there and in `src/lib/types.ts`:

- `apiLogs` and `feedbackQueue` are telemetry, not the user's writing. They have
  their own one-way endpoints and should never come back down to a client.
- `images` holds binary blobs, which belong in object storage with the document
  holding a key rather than inlined as base64 in every delta.
- `outbox` and `syncState` are the sync mechanism itself. Syncing them would be
  circular.
- `migrations` records whether *this device* has finished reshaping its own
  copy. That is not a fact other devices need, and syncing it would let one
  device's failure look like everyone's.

`images` is declared on the `FragmentDB` class and given an index string, but no
code reads or writes `db.images`. The only other reference to `StoredImage` is
its type declaration in `src/lib/types.ts`.

### Pre-migration snapshots

`src/lib/migration/snapshot.ts` keeps its backups in a **separate IndexedDB
database**, `fragment-migration-backup`, with a single `snapshots` table indexed
`id, capturedAt`. It is separate on purpose: a backup stored inside `fragment`
would share a fate with the thing it is insuring against. At most
`KEEP_SNAPSHOTS` (3) snapshots are retained.

---

## 4. The server schema

The server lives in Postgres. Migrations are plain SQL files in
`db/migrations/`, applied by `scripts/db-migrate.mjs` (`npm run db:migrate`).

### `documents` is schemaless on purpose

Every synced record from every Dexie collection lands in one table, created in
`db/migrations/001_init.sql`:

```sql
create sequence if not exists documents_rev_seq;

create table if not exists documents (
  user_id     uuid not null references users(id) on delete cascade,
  collection  text not null,
  id          text not null,
  doc         jsonb,
  updated_at  bigint not null,
  deleted     boolean not null default false,
  rev         bigint not null default nextval('documents_rev_seq'),
  primary key (user_id, collection, id)
);

create index if not exists documents_user_rev_idx on documents(user_id, rev);
```

The server does not model a note's or an idea's internals. Its job is ownership,
ordering, and transport; the client owns the shape. `doc` is opaque jsonb, and
the record is keyed by `(user_id, collection, id)`.

The practical consequence: **adding or renaming a client collection needs no SQL
migration.** The Dexie schema can go from v19 to v20 to v30 without a server
change behind every field. `pieceVersions`, added at v20, syncs today with no
corresponding SQL. The only server-side gate is
`SYNCED_COLLECTIONS` in `src/lib/sync/protocol.ts`, which both sides share:
`parseSyncRequest` rejects unknown collection names outright, so a caller cannot
write unbounded junk into `documents` under names the client will never read
back.

`rev` comes from one global sequence, so a client's cursor is the highest `rev`
it has applied and pulling is `where user_id = $1 and rev > $2` ordered by
`rev`. `updated_at` is the client's wall clock in milliseconds and exists for a
different job: deciding which of two concurrent edits wins. Fragment resolves
that last-write-wins per record, the higher `updatedAt` surviving whole.

### `shares` and its `note_id`

`db/migrations/003_sharing.sql` creates the hosted review loop. The parent table:

```sql
create table if not exists shares (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  note_id           text not null,
  token_hash        text unique not null,
  title             text not null,
  snapshot_markdown text not null,
  revision          integer not null default 1,
  allow_edits       boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  revoked_at        timestamptz,
  expires_at        timestamptz
);
```

`note_id` is a plain `text` column with no foreign key, because notes live in
the client's IndexedDB and the server never models them. It is the client-side
note id, and it is why `ContentPiece.legacyNoteId` matters: existing share rows
are keyed by note id, so a fragment that used to be a note has to keep that id
reachable. Indexes are `shares_user_idx on shares(user_id, created_at desc)` and
`shares_note_idx on shares(user_id, note_id)`.

`snapshot_markdown` freezes the draft at the moment of sharing, so reviewers do
not watch the document move under them and anchors resolve against the text they
were captured on. Re-sharing takes a fresh snapshot and bumps `revision`.
`token_hash` stores the SHA-256 of the URL secret, never the token, so reading
the table yields no working share links.

The other sharing tables:

- `share_guests`: a reviewer. No account, no row in `users`. Email plus a
  per-share token is the whole identity, and the email is **not** verified. There
  is deliberately no unique constraint on `(share_id, email)` for
  self-identified guests, so two browsers produce two rows even for one person;
  a unique partial index `share_guests_invited_email_idx on share_guests(share_id,
  email) where invited` deduplicates owner-sent invitations only.
- `share_comments`: one row per reviewer comment, mirroring `ReviewComment` one
  column per field, plus `revision` and a `unique (guest_id, client_id)` so
  resubmitting a review replaces that guest's set rather than duplicating it.
  `guest_id` is the isolation boundary for reads.
- `share_edits`: a reviewer's edited copy of the whole draft, one row per guest
  per submission, kept as history rather than overwritten.

### Migration files, in order

| File | What it does |
|---|---|
| `001_init.sql` | Creates `users`, `sessions`, `documents` (with `documents_rev_seq` and `documents_user_rev_idx`), `devices`, `feedback`, and `api_logs`. Enables the `pgcrypto` extension. |
| `002_billing_ready.sql` | Adds `stripe_customer_id`, `plan`, and `plan_status` to `users`; creates `credit_grants`, the append-only `credit_ledger`, and `stripe_events` for webhook dedupe. No billing code exists yet. |
| `003_sharing.sql` | Creates `shares`, `share_guests`, `share_comments`, and `share_edits` for the hosted review loop. |
| `004_identities.sql` | Creates `identities (provider, subject)` unique per pair, backfills every existing user as an `openai` identity, and drops `users.codex_sub`. Identity becomes provider-agnostic. |
| `005_drop_feedback.sql` | Drops the `feedback` table created in `001_init.sql`. Feedback now files straight to Linear via `src/lib/server/linear.ts`. |

### Other server tables

- `users`: one row per person. `email` and `name` are a display cache supplied by
  whichever identity last provided them, not the source of truth.
- `sessions`: server-side sessions rather than stateless JWTs, so signing out of
  a lost device actually revokes it. `id` is the SHA-256 of the cookie value.
- `devices`: how the app identifies an install before anyone signs in, which is
  why `user_id` is nullable and nulls out rather than cascading.
- `api_logs`: the server-side sink for AI call telemetry.
- `credit_grants`, `credit_ledger`, `stripe_events`: the billing-ready schema.
  Amounts are integer micro-USD; balance is derived from the ledger, never
  authored.
- `identities`: one row per provider identity linked to a user.

---

## 5. Invariants and where they are enforced

| Invariant | Function | Location | Enforced at |
|---|---|---|---|
| A piece has exactly one content home: `noteId` XOR `body` | `pieceContentHome` | `src/lib/content-engine/contract.ts` | `savePiece` in `src/lib/persistence.ts`, and as a `.refine()` on `contentPieceSchema` |
| Ideas nest at most one level deep | `assertIdeaParentAllowed` | `src/lib/content-engine/contract.ts` | `saveIdea` in `src/lib/persistence.ts`, checked against the actual stored parent row |
| `publish` is set if and only if `status === "published"` | `assertPublishGuard` | `src/lib/persistence.ts` | `savePiece`, plus five call sites in `src/stores/content-store.ts` that want a synchronous throw before committing an in-memory update |

`pieceContentHome` returns `"note"` or `"body"` and throws a `ContractError`
when both or neither is set. `assertIdeaParentAllowed` throws when the proposed
parent is soft-deleted or already has a parent of its own. `assertPublishGuard`
throws when the publish record and the published status disagree in either
direction.

### Caveat: `applyRemote` bypasses these guards

`applyRemote` in `src/lib/sync/engine.ts` writes pulled changes straight into
Dexie:

```ts
const merged = mergeFromSync(collection, change.doc, local) as Record<string, unknown> & {
  id: string;
};
await table.put({ ...merged, id: change.id });
```

It calls `tableFor(collection)` and then `table.put` or `table.delete` directly.
It does not go through `savePiece` or `saveIdea`, so none of the three guards
above run on inbound sync writes. A record that violates an invariant on one
device, or that was written by a client on a different schema version, lands on
disk here unchecked.

Two related details of that function, both deliberate:

- The transaction is tagged with `markTransactionAsRemoteApply` so the outbox
  hooks ignore these writes. Without it, applying a change would queue it
  straight back for pushing and every sync would echo.
- A local outbox entry newer than the incoming change wins and the change is
  skipped, because it is about to be sent and overwriting it would destroy an
  edit the user made.

---

## 6. The one-entity transition (in progress, not shipped)

The direction: a fragment holds its own text, and `Note` stops being a separate
entity. The groundwork is on disk at Dexie v20 and the migration code is written
and tested. **It does not run automatically, and the UI has not switched over.**
`runOneEntityMigration` is referenced only by `src/lib/migration/console.ts`,
which exposes it as a devtools handle, and by
`src/__tests__/migration-run.test.ts`. As the console module states, the app does
not run the migration on its own yet; until the UI can read the new shape,
starting it is a deliberate act.

### What already exists

`ContentPiece` has gained `subtitle`, `goal`, `audience`, `tone`, `remember`,
`voiceId`, and `legacyNoteId`. **All seven are optional**, so today's rows are
valid with none of them set. They are the fields a fragment needs once it holds
what a note used to hold.

`pieceVersions` mirrors `noteVersions` field for field, keyed by `pieceId`
instead of `noteId` and carrying an optional `legacyNoteId`. Both tables are in
`SYNCED_COLLECTIONS`, and the comment there gives the reason: a device that has
not migrated yet still writes `noteVersions`, and both have to reach every
device or a version saved on one machine would be missing on another.

Snippets and reviews carry both keys during the window. `Snippet` has `noteId`
and an optional `pieceId`; `StoredReview` has `noteId` and an optional
`pieceId`. Both `snippets` and `reviews` index on both keys at v20.

### Deterministic ids

Two prefixes, defined in `src/lib/migration/plan.ts`:

```ts
export const MIGRATED_IDEA_PREFIX = "mig-";
export const MIGRATED_PIECE_PREFIX = "migp-";
```

A note that no live fragment points at is promoted: it becomes an idea with id
`mig-<noteId>` holding one long-form fragment with id `migp-<noteId>`. A note a
fragment already links is absorbed instead: the existing fragment takes the
note's text and keeps its own id, its idea, and its position in the feed.

Determinism is what makes this safe under sync. Two devices running the
migration independently against the same library produce byte-identical rows
under identical ids, so the server merges them into one copy instead of ending
up with two parallel libraries. The same reasoning drives `byAgeThenId` in
`plan.ts`: when two fragments link one note, the older is the primary absorber
and the other takes a copy, with the id as a tie-break so every device reaches
the same answer.

The whole plan is a pure function of the rows it is handed
(`buildMigrationPlan`), which also means it can be computed and shown before
anything is touched, and the verification gate can grade the result against the
plan rather than against a second guess at the rules.

### Additive, and verified before it is kept

Nothing in `src/lib/migration/run.ts` deletes a note, a version, or a review.
Text is copied into fragments and every original stays in place. The worst case
is a library holding two copies of itself, never one holding none. Retiring the
old rows is a separate decision, made later.

The run sequence:

1. Capture a snapshot into the separate `fragment-migration-backup` database. A
   backup that fails is a migration that does not start.
2. Write a `migrations` row with status `running`.
3. Build the plan from the current rows.
4. Inside one Dexie transaction over `ideas`, `contentPieces`, `noteVersions`,
   `pieceVersions`, `reviews`, and `snippets`: write the plan, read back what is
   actually on disk, and run `verifyMigration` against the notes as they were
   before any of it ran.
5. If verification refuses, throw `VerificationRefused`, which rolls the whole
   transaction back. The `migrations` row is stamped `failed` with the failure
   list, and the library is left exactly as it was found.
6. Otherwise stamp the row `complete` with the plan counts.

`verifyMigration` compares against the pre-migration snapshot, never against the
migration's own idea of what it did. Its failure codes are `missing-piece`,
`body-mismatch`, `context-mismatch`, `missing-idea`, `wrong-idea`,
`missing-legacy-id`, `satellite-missing`, `satellite-unmoved`, and
`count-mismatch`. It stops collecting at 50 failures.

Re-running is safe. The planner reads migration state off the rows themselves
via `legacyNoteId` rather than off the local `migrations` row, so a device whose
*data* already arrived migrated by sync re-verifies instead of duplicating.

### What changes when the transition completes

From the code's own statements about the end state:

- Every fragment holds its own text in `body`. `noteId` is cleared in favour of
  `legacyNoteId`, which records where the text came from and is set once and
  never afterwards.
- `legacyNoteId` is what keeps old share links, review threads, and file backups
  resolving, since all of them are keyed by note id.
- The exactly-one-content-home rule still holds for any single row throughout,
  because both shapes remain valid on disk until the UI reads the new one.
- Retiring the `notes` and `noteVersions` rows is a later, separate decision,
  taken once every device has moved across.

Until then, both shapes are valid, and this document describes the pre-migration
shape as the live one.

---

## 7. Glossary

| User-facing word | Code identifier | Notes |
|---|---|---|
| idea | `Idea`, Dexie table `ideas` | Same word in the UI and the code. |
| fragment | `ContentPiece`, Dexie table `contentPieces` | "Fragment" is the name used throughout the one-entity migration code. The shipped UI still labels these "Pieces", and `docs/FEATURES.md` documents them under that name. |
| draft | a long-form fragment | Today a draft is a `ContentPiece` whose content home is a linked `Note` (`format: essay`, `status: in-progress`). After the transition it is a fragment holding its own long-form `body`. |
| snip | `Snippet`, Dexie table `snippets` | The Snip Bar shows snippets. "Snip" is also one of Fragment's three headline feature names. |

The sync wire and the MCP contract both say **piece**, not fragment, and this is
deliberate. `SYNCED_COLLECTIONS` names the collection `contentPieces`;
`fragment-mcp` exposes `add_piece`, `get_piece`, `create_idea`, `list_ideas`,
`update_status`, and `add_resource`; the handoff schemas are
`pieceHandoffJsonSchema` and `pieceHandoffFrontmatterSchema`, keyed on
`fragment: 1` as the contract version. These are public commitments: as
`src/lib/content-engine/contract.ts` puts it, every field there is shared by the
Dexie store, the local ingress API, `fragment-mcp`, and the future hosted API.
Version bumps are additive, and breaking changes require a new `fragment`
version handled side by side. Renaming the wire word to match a UI word would be
a breaking change that buys nothing.
