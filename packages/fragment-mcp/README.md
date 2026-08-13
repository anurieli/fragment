# fragment-mcp

An MCP server + CLI that lets any agent (Claude Code, Codex, Hermes, or anything that speaks MCP) push
content into [Fragment](../../README.md)'s inbox: create an idea, drop a draft piece under it, check on
what's queued, and mark a piece published once it's actually been posted.

It is a thin, validated wrapper around Fragment's public agent contract — see
[`docs/AGENT-API.md`](../../docs/AGENT-API.md) at the repo root for the handoff format this package writes,
and [`src/lib/content-engine/`](../../src/lib/content-engine/) for the zod schemas and types it reuses
rather than reimplements.

## Install

Not published to npm yet. Until it is, register it from a local path:

```bash
claude mcp add fragment-mcp -- node /absolute/path/to/fragment/packages/fragment-mcp/dist/bin.js
```

To connect it to a hosted Fragment **account** instead of the local inbox, add the two env vars
(see "Hosted transport" below):

```bash
claude mcp add fragment \
  --env FRAGMENT_API_URL=https://your-fragment-domain.example \
  --env FRAGMENT_API_TOKEN=frg_agent_... \
  -- node /absolute/path/to/fragment/packages/fragment-mcp/dist/bin.js
```

(Build first: `npm install && npm run build` inside this directory.) Once published, the same thing becomes:

```bash
claude mcp add fragment-mcp -- npx fragment-mcp
```

## Tools

| Tool | Args | Returns | Notes |
|---|---|---|---|
| `create_idea` | `title`, `summary?`, `agent?`, `parentId?` | `{ ideaId, title, parentId }` | Ideas nest one level deep (max depth 2); `parentId` must point at a root idea. |
| `add_piece` | `ideaId?` or `ideaTitle?`, `format`, `title?`, `content`, `priority?`, `supersedes?`, `resources?`, `scheduledAt?`, `agent?`, `model?` | `{ pieceId, ideaId }` | Append-only — always creates a **new** piece file, never edits an existing one. A re-draft passes `supersedes: <old pieceId>`. Lands with `status: inbox` regardless of what's passed. |
| `list_ideas` | `status?` | `{ ideas: [...] }` | Each idea includes per-status piece counts (`counts`) and a `total`, computed from what's currently on disk. If `status` is set, only ideas with at least one piece in that status are returned — but `counts` still shows the full breakdown. |
| `get_piece` | `pieceId` | the piece, including its current effective `status` | |
| `update_status` | `pieceId`, `status` | `{ pieceId, status }` | **Only `"published"` is accepted.** Every other status is a user verdict made inside Fragment — the tool rejects with a clear error rather than silently no-opping. |
| `add_resource` | `ownerType` (`idea` \| `piece`), `ownerId`, `kind` (`link` \| `note` \| `asset`), `title`, `url?`, `note?` | `{ resourceId, ideaId }` | Attaches a reference resource to an idea or a piece. Never copied on inheritance — an idea's resources are visible to its child ideas and their pieces, composed at read time by the app. For a piece owner, the resource is filed under that piece's idea (resolved automatically). |

All tool inputs are validated against the contract's own zod schemas (`pieceHandoffJsonSchema` for
`add_piece`, plus the shared field schemas) before anything touches disk.

## Inbox directory layout (phase 1: file transport)

```
~/.fragment/inbox/                      (override: FRAGMENT_INBOX_DIR)
├── <ideaId>/
│   ├── idea.json                       idea manifest, written once by create_idea / the first add_piece
│   │                                    that resolves to a new idea
│   ├── <pieceId>.md                    one file per piece, contract frontmatter + byte-exact body
│   └── resources.jsonl                 append-only log of add_resource calls filed under this idea:
│                                        {"id","ownerType","ownerId","kind","title","url","note","createdAt"}\n
│                                        per line. A piece-owned resource's ownerId is the piece, not this
│                                        directory — the directory is just where add_resource resolved the
│                                        owning idea to.
├── .imported/<ideaId>/<pieceId>.md     where the running Fragment app moves a piece file once imported
├── .imported/resources(-N).jsonl       where the app moves a whole resources.jsonl once its lines are
│                                        imported (uniquified on name collision, same as piece files)
└── .status.jsonl                       append-only log: {"pieceId","status","at","by"}\n per line
```

- `add_piece` never overwrites: every call mints a fresh id and writes a new file. That's the whole
  append-only guarantee — there's no file to collide with.
- `update_status` never edits a piece file in place either. It appends a line to `.status.jsonl`; the
  piece's *effective* status is the latest matching entry in that log, falling back to the status baked
  into the piece file (always `inbox`, since that's the only status an agent can ever write) if there is
  no entry.
- `add_resource` appends to the owning idea's `resources.jsonl` instead of minting a new file per call —
  the whole file is what the running app reads and imports, then moves to `.imported/` once every line has
  been read (the same "move on import" pattern as a piece file, just at file rather than line granularity).
- **Reads are eventually consistent.** `list_ideas` and `get_piece` reconstruct current state by scanning
  both `<ideaId>/` and `.imported/<ideaId>/` for piece files and layering `.status.jsonl` on top. If the
  Fragment app is mid-import, or another agent just wrote a file, a read may briefly lag reality — there is
  no locking or transaction across the two processes.

## CLI mode

```bash
fragment-mcp push <file.md>
```

Validates the file as a contract handoff (same `parsePieceFile` the app itself uses) and writes it into
the inbox exactly like `add_piece` would. Prints:

```
queued 1 piece(s); open Fragment to import.
```

## Hosted transport (connect to a Fragment account)

`src/http-transport.ts` implements the same `Transport` interface against a Fragment server's
`/api/v1/agent/*` routes, authenticated by a per-account agent token (minted in the app under
**Settings → Account & Sync → Agent access**; shown once, revocable there any time). Configure it with
two environment variables on the process that runs fragment-mcp:

| Var | Meaning |
|---|---|
| `FRAGMENT_API_URL` | The Fragment server, e.g. `https://your-fragment-domain.example`. |
| `FRAGMENT_API_TOKEN` | An agent token for the account (`frg_agent_…`). |

Both set → hosted mode: every tool call is an HTTPS request scoped to that account, durable on
response, delivered to the user's devices by cloud sync (no running local app required). Neither set →
the local file transport below. Exactly one set → a loud startup error, never a silent fallback to
writing files nobody imports.

`fragment-mcp doctor` in hosted mode probes `GET /api/v1/agent/ping` and reports the token's name,
scopes, and account. There is no deliverability preflight in hosted mode because the HTTP response is
the delivery verdict.

## Package build (why the tsconfig looks the way it does)

This package doesn't duplicate the content-engine contract — `src/*.ts` imports it directly via a relative
path (`../../../src/lib/content-engine/...`). Since a published npm package only ships what's inside its
own directory, `tsconfig.json` sets `rootDir: "../.."` (the repo root) and extends `include` to also match
`../../src/lib/content-engine/**/*.ts`, so `tsc` compiles those files as part of *this* package's build.
The emitted layout preserves that repo-root-relative structure:

```
dist/
├── packages/fragment-mcp/src/...    this package's own compiled output (bin.js, index.js, ...)
└── src/lib/content-engine/...       the contract, compiled alongside it
```

The relative distance between the two is unchanged by the extra nesting, so the compiled imports still
resolve correctly at runtime — `bin.js` is what `package.json`'s `bin` field points at. Building this
package is self-contained: `npm run build` never touches the root of the repo, and the root's own
`tsconfig.json` excludes `packages/` so the root `tsc --noEmit` never sees this package's build output.

## Development

```bash
npm install   # inside this directory only — never touches the repo root's package.json/lockfile
npm run build # tsc -> dist/
npm test      # vitest run, own vitest.config.ts (the root's excludes packages/)
```
