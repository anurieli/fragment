# Architecture

Fragment is a writing app for long-form work: you write in an editor, snip
passages out into cards, rearrange them, and weave them back in with AI help.
It is local-first, so the browser's own IndexedDB database is where the writing
lives, and everything hosted (accounts, sync, share links) is added on top of a
client that already works without it.

## Two repos

There are two Fragment repos, and this is the hosted one.

- `anurieli/fragment` is the public, open-source client: editor, Snip / Flow /
  Refine, the Content Engine, the agent intake MCP, IndexedDB storage. It has
  no accounts, no cloud storage, and no sync, by design.
- `anurieli/fragment-cloud` (this repo, private) is the hosted SaaS side:
  landing page, accounts and auth, Postgres as the convergence copy, sync,
  hosted agent ingress, managed AI proxy, billing, admin.

As of the note in [`README.md`](../README.md), this repo is a full working copy
of the client rather than a slim overlay on top of it, so shared client code
has to be applied to both repos by hand. Hardening that seam is tracked as
ARI-138. This repo is the one that deploys to production.

Which shape a build runs as is decided by `NEXT_PUBLIC_FRAGMENT_HOSTED` and
read through `src/lib/edition.ts` (`getEdition()`, `isHosted()`).

## Layers

**Next.js App Router.** `src/app/`. `src/app/page.tsx` is the front door: the
self-host and desktop builds go straight to `AppShell`, the hosted build shows
the landing page to a visitor with neither a `fragment_entered` nor a
`fragment_session` cookie. `src/app/layout.tsx` is the root layout,
`src/app/api/**/route.ts` holds every server route, and `src/app/r/[token]/*`
holds the reviewer-facing share pages. Every route is catalogued in
[`docs/API.md`](./API.md); do not duplicate that list elsewhere.

**React UI.** `src/components/`, with `src/components/app-shell.tsx` as the
composition root that mounts the sidebar, editor, helper bar, timeline,
settings, and the long-lived hooks. Feature logic sits in `src/hooks/`
(`use-persistence`, `use-auto-save`, `use-cloud-sync`, `use-agent-inbox`,
`use-slash-command`, `use-inline-edit`, and the rest).

**Zustand stores.** `src/stores/`. `app-store.ts` holds ephemeral UI state,
`data-store.ts` holds notes, snippets and versions, `content-store.ts` holds
ideas, fragments and resources, plus `settings-store.ts`, `voice-store.ts`,
`review-store.ts`, and `sync-store.ts` (a mirror of the sync engine's snapshot
so components can read it). `content-selectors.ts` and
`resources-selectors.ts` are pure functions over those arrays, with `now`
injected by the caller so they stay testable.

**Dexie / IndexedDB persistence.** `src/lib/db.ts` declares the schema, which
is at version 20. `src/lib/persistence.ts` is the only module that talks to
Dexie for application data; stores call `saveNote`, `savePiece`, `saveIdea`,
`saveResource`, and friends rather than touching tables directly. Notes also
get a `localStorage` recovery copy, and packaged Tauri builds get a filesystem
backup through `src/lib/fs-backup.ts`.

**Sync engine.** `src/lib/sync/`: `protocol.ts` (the wire contract, shared by
client and server), `collections.ts` (collection to table mapping and field
stripping), `outbox.ts` (Dexie hooks that record what changed),
`engine.ts` (the loop), `api.ts` (the HTTP calls). Full detail in
[`docs/SYNC.md`](./SYNC.md).

**Postgres server side.** `src/lib/server/`: `db.ts` (the pool, and the rule
that `DATABASE_URL` unset is a supported configuration), `session.ts` and
`identity.ts` (server-side sessions, provider-agnostic identities),
`google-auth.ts`, `sync-store.ts` (the server half of delta sync),
`shares.ts` (share links and per-reviewer comment isolation), `csrf.ts`,
`linear.ts` (in-app feedback files straight to Linear). Schema lives in
`db/migrations/*.sql`, applied by `npm run db:migrate`
(`scripts/db-migrate.mjs`).

**AI provider runtime.** `src/lib/ai/provider-runtime.ts` holds the
provider-neutral request building, streaming, and model listing.
`src/lib/ai-client.ts` is the client-side entry point: in a browser it calls
the Next.js proxy routes (`/api/generate`, `/api/edit`, `/api/label`,
`/api/analyze-voice`, `/api/models`, `/api/validate-key`), and inside a Tauri
webview, where those routes do not exist because the build is a static export,
it calls the provider directly through the same runtime. Codex/ChatGPT
connection code sits in `src/lib/codex-auth.ts`,
`src/lib/codex-token-manager.ts`, and `/api/auth/codex/*`.

**Agent ingress and MCP.** `src/lib/agent-inbox/` reads handoff files from a
local inbox directory (default `~/.fragment/inbox`, override
`FRAGMENT_INBOX_DIR`) and imports them into the content store. `gate.ts` is the
access rule: closed on the hosted build, closed unless
`FRAGMENT_LOCAL_INGRESS=true`, open on localhost, otherwise requiring an exact
bearer token, and a closed gate answers 404 rather than 401 so the endpoint's
existence is not disclosed. `packages/fragment-mcp/` is the MCP server and CLI
that agents use to write those files. The wire format is
[`docs/AGENT-API.md`](./AGENT-API.md), with the schemas in
`src/lib/content-engine/`.

**Publishing.** `src/lib/publish/`: markdown to clean HTML, per-platform
character limits, clipboard payloads, composer URLs, LinkedIn escaping, Kit
broadcasts, and Substack RSS verification. The hosted LinkedIn post route is
`/api/v1/publish/linkedin`; the Composio wiring is `src/lib/composio/`.

**Sharing and review.** `src/lib/review/` builds the standalone review file,
parses reviewer returns, and resolves anchored comments against a live
document. `src/lib/sharing/` is the browser's view of hosted shares; every rule
about who may read whose comments is enforced server-side in
`src/lib/server/shares.ts`, and nothing in `src/lib/sharing/` is a security
boundary.

## How a keystroke reaches Postgres

```
  Editor (Tiptap)
        |  updateNoteContent / updatePiece...
        v
  Zustand store                     src/stores/data-store.ts
        |                           src/stores/content-store.ts
        |  saveNote / savePiece
        v
  persistence.ts                    src/lib/persistence.ts
        |  db.notes.put(...)
        v
  Dexie table  ----------------->  localStorage + Tauri fs backup
        |  creating / updating / deleting hook
        v
  outbox table                      src/lib/sync/outbox.ts
    key [collection+id]             (repeat edits collapse onto one row)
        |  onQueued -> requestSync(), 1.5s debounce
        v
  sync engine                       src/lib/sync/engine.ts
        |  buildChanges + sanitizeForSync
        v
  POST /api/v1/sync                 src/app/api/v1/sync/route.ts
        |  parseSyncRequest, session lookup, rate limit
        v
  applySync                         src/lib/server/sync-store.ts
        |  insert ... on conflict, rev = nextval(documents_rev_seq)
        v
  documents table                   db/migrations/001_init.sql
```

The same round trip carries the pull. The response's changes go back through
`applyRemote` in `engine.ts`, into Dexie, and the stores refetch when
`dataRevision` increments (`src/hooks/use-cloud-sync.ts`).

## Local-first, and what it costs the server

Writing works with no account. `AppShell` mounts `useCloudSync()`
unconditionally, and the engine's first check is `isCloudReachable()`; with no
session it settles on `signed-out` and does nothing else. Every path in
`engine.ts` fails into "carry on locally" rather than into an error the writer
has to act on.

The server is content-opaque. `documents` has `user_id`, `collection`, `id`,
`doc jsonb`, `updated_at`, `deleted`, and `rev`. It does not model what a note
or an idea contains. That is what lets the Dexie schema move from v19 to v20
and beyond without a server migration behind every field.

Credentials do not sync. `STRIPPED_FIELDS` in `src/lib/sync/collections.ts`
lists what is removed from a record on the way out:

```ts
const STRIPPED_FIELDS: Partial<Record<SyncedCollection, string[]>> = {
  settings: [
    "providerCredentials",
    "userProfile.kitApiKey",
    "userProfile.composioApiKey",
    "userProfile.linkedInConnectedAccountId",
  ],
};
```

The settings record itself does sync, because writing style, profile, and
feature preferences are exactly what you want already configured on a second
device. What is stripped is anything that can act on the writer's behalf: the
provider API keys they pasted into their own machine, the Kit key that controls
their mailing list, and the Composio key plus LinkedIn account id that together
amount to permission to post as them. Syncing those would turn a writing sync
feature into a credential store. `mergeFromSync` puts the local values back when
the same record returns from another device, so a stripped field does not erase
what is on this machine.

## Identity

A Fragment account and an AI connection are separate things. The account is
Google sign-in and a revocable server-side session; it establishes who owns the
cloud library. An AI connection (an API key, a local Ollama, or the
experimental ChatGPT/Codex path) authorizes Snip, Flow, Refine, title
generation, and Brand Voice analysis. Signing in to ChatGPT does not create a
Fragment account, and signing in to Fragment does not grant AI usage.

`src/lib/server/identity.ts` is explicit that Codex is deliberately not an
identity provider: its credential exists only to route AI calls and must never
reach `signIn`. See [`CLOUD.md`](../CLOUD.md) for the full account,
environment, and deployment picture; it is the source of truth for that and
should not be restated here.

## The entity model

Ideas, fragments (`ContentPiece`), and resources are defined in
`src/lib/content-engine/contract.ts`; notes, snippets, versions, voices, and
settings in `src/lib/types.ts`.

A one-entity migration is in progress. It merges the `Note` entity into
`ContentPiece`, so that a fragment holds its own text in `body` instead of
pointing at a note through `noteId`. Dexie v20 added the groundwork:
`pieceVersions`, a `legacyNoteId` index on `contentPieces`, and `pieceId`
indexes on `snippets` and `reviews`. The v20 upgrade is purely additive and
rewrites nothing; the data migration runs afterwards, under its own
verification gate, in `src/lib/migration/`.

The UI has not switched over. `src/lib/migration/console.ts` says so directly:
the app does not run the migration on its own, and starting it is a deliberate
act through `window.fragmentMigration` in a devtools console
(`dryRun()`, `report()`, `download()`, `snapshots()`, `restore(id)`,
`migrateNow()`, `status()`). The migration is additive, deterministic across
devices, and verified inside the transaction that writes it, so a failed check
throws and Dexie rolls the whole thing back. Until it completes, both shapes
are valid on disk: a long-form fragment may still link a note, and the
`pieceContentHome` rule (exactly one of `noteId` or `body`) still holds for any
single row.

For field-by-field detail, see [`docs/DATA-MODEL.md`](./DATA-MODEL.md).

## Where to look

| Task | Directory |
|---|---|
| A page, layout, or HTTP route | `src/app/` |
| UI components | `src/components/` |
| Feature logic bound to React | `src/hooks/` |
| In-memory app state | `src/stores/` |
| Local schema and tables | `src/lib/db.ts` |
| Reads and writes against Dexie | `src/lib/persistence.ts` |
| Sync protocol, outbox, engine | `src/lib/sync/` |
| Postgres, sessions, shares | `src/lib/server/` |
| SQL schema | `db/migrations/` |
| AI providers and proxying | `src/lib/ai/`, `src/lib/ai-client.ts` |
| Idea / fragment / resource types and schemas | `src/lib/content-engine/` |
| Agent handoff import | `src/lib/agent-inbox/`, `packages/fragment-mcp/` |
| Publishing to platforms | `src/lib/publish/` |
| Review files and share links | `src/lib/review/`, `src/lib/sharing/` |
| One-entity migration | `src/lib/migration/` |
| Unit tests | `src/__tests__/` |
| Browser end-to-end tests | `e2e/` |
| Operational scripts | `scripts/` |

## Commands

```bash
npm run dev          # dev server on http://localhost:3100
npm test             # unit tests (Vitest)
npm run test:e2e     # Playwright
npm run lint
npm run build
npm run db:migrate   # apply db/migrations against DATABASE_URL
npm run verify:sync  # live two-device sync check, needs a running server
```

## Related documents

- [`docs/API.md`](./API.md), every HTTP route
- [`docs/SYNC.md`](./SYNC.md), the sync wire format and convergence rules
- [`docs/DATA-MODEL.md`](./DATA-MODEL.md), the entity model
- [`docs/AGENT-API.md`](./AGENT-API.md), the agent handoff contract
- [`docs/FEATURES.md`](./FEATURES.md), feature behaviour and QA reference
- [`CLOUD.md`](../CLOUD.md), accounts, environment, deployment
- [`CONTRIBUTING.md`](../CONTRIBUTING.md), setup and code standards
