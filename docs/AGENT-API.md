# Fragment Agent API

Fragment is the content store your agents write into. An agent (Claude Code, Codex, Hermes, or anything that can write a file) drafts content pieces — LinkedIn posts, tweet threads, Substack essays — and hands them to Fragment, where they land in your **inbox** grouped under the **Idea** they belong to. You review, refine, and publish. This document is the stable public interface for that handoff.

Claude Code users: the repo ships an agent skill for this workflow at `.claude/skills/fragment-push/`. Point an agent at it (or copy it into your own skills directory) and it knows the handoff discipline described below.

**Contract version: `fragment: 1`.** Every handoff declares this version. Fields are only ever added within a version; breaking changes get a new version number that Fragment supports side by side. Source of truth: `src/lib/content-engine/` (types + zod schemas).

## The data model in 30 seconds

- **Idea** — a container for one line of thinking. Ideas can nest one level deep (a "North Star" idea with sub-ideas; max depth 2). Ideas have priority (0 none / 1 urgent / 2 high / 3 medium / 4 low) and can be pinned.
- **ContentPiece** — one unit inside an idea: `format` is `linkedin`, `tweet`, `substack`, `essay`, `script`, or `other`; `status` flows `inbox → in-progress → ready → published`. A piece can never exist without an idea — an idea is the relatable, learnable thought a piece is built on, and every piece names its idea. `script` is long-form content that is used elsewhere rather than published from Fragment (video scripts, talk notes); the publish menu does not apply to it. Agent-pushed pieces always start in `inbox`. A piece's `created_at` is its canonical age — the inbox surfaces how long a piece has been waiting.
- **Resource** — a link, note, or asset attached to an idea or a piece (inspiration, sources). Children inherit their parents' resources at read time.

## Handoff format: markdown + YAML frontmatter

Drop a `.md` file per piece into the Fragment inbox directory:

```
~/.fragment/inbox/<any-name>.md
```

The running Fragment app imports it, acknowledges it by moving the file to `~/.fragment/inbox/.imported/`, and reports outcomes to `~/.fragment/inbox/.status.jsonl`. (Local ingress must be enabled in the app; see the README.)

### Example: LinkedIn post

```markdown
---
fragment: 1
idea_title: "Voice is the moat"
format: linkedin
title: "Post 1 of 4"
priority: 2
agent: claude-code
model: claude-fable-5
resources:
  - kind: link
    url: https://example.com/source-talk
    title: "Conference talk this riffs on"
---
Everyone is automating content. Almost no one is keeping their voice.

Here is the distinction that matters...
```

### Example: tweet thread

One piece per thread. Segments are separated by a line containing only `---`:

```markdown
---
fragment: 1
idea_id: idea_x1y2z3
format: tweet
agent: hermes/penny
---
Hot take: your writing tool should store ideas, not files.
---
Files fragment thinking. Ideas have structure: a core essay, derivatives, sources.
---
That's what we built. 🧵 below.
```

### Frontmatter fields

| Field | Required | Notes |
|---|---|---|
| `fragment` | yes | Contract version. Must be `1`. |
| `format` | yes | `linkedin` \| `tweet` \| `substack` \| `essay` \| `script` \| `other` |
| `idea_id` / `idea_title` | one of | `idea_id` targets an existing idea (import fails if it doesn't exist). `idea_title` matches an existing idea by title (case/whitespace-insensitive) or creates a new root idea. |
| `idea_summary` | no | Used only when a new idea is created. |
| `id` | no | Piece id. Provide one to make re-pushes idempotent; otherwise Fragment generates it. |
| `status` | no | Defaults to `inbox`. Agents should not push `published`. |
| `origin` | no | Defaults to `agent`. |
| `title` | no | Piece label shown in the workspace. |
| `priority` | no | `0`–`4` (0 none, 1 urgent, 2 high, 3 medium, 4 low). Defaults to `0`. |
| `created_at` / `updated_at` | no | ISO-8601. `created_at` is the piece's canonical age; defaults to import time. |
| `scheduled_at` | no | ISO-8601 target publish time (informational badge in v1). |
| `agent` / `model` | no | Who drafted this. Shown in the UI, kept in `agentMeta`. |
| `supersedes` | no | Id of a piece this one replaces. Conflict model is append-only: push a new piece that supersedes the old one; never expect to overwrite. |
| `resources` | no | Array of `{ kind: link\|note\|asset, title, url?, note? }` attached to the piece. |

### Body rules

- The body is **everything after the closing `---`**, preserved byte-exact: spaces, blank lines, and newlines survive import → edit → publish untouched.
- Write plain markdown. For `tweet`, separate thread segments with a `---` line.
- Long-form (`essay`, `substack`) bodies are imported into a full Fragment note; short-form bodies stay inline.

## Import semantics

- **Upsert by `id`**, last-write-wins on `updated_at` — but a piece edited more recently *inside* Fragment is never overwritten by a stale agent push (the import is skipped and reported in `.status.jsonl`).
- Re-importing an identical file is a no-op (idempotent).
- Deleted ideas and pieces are tombstoned; pushes cannot resurrect them.
- Pieces referencing `idea_title` that matches nothing create a **new root idea** with `priority: 0`.

### resources.jsonl (attaching resources without the MCP tool)

`add_resource`'s wire format is a JSON Lines file, one resource per line, appended under the owning idea's directory:

```
~/.fragment/inbox/<ideaId>/resources.jsonl
```

Each line: `{"id"?, "ownerType": "idea"|"piece", "ownerId", "kind": "link"|"note"|"asset", "title", "url"?, "note"?, "createdAt"?}\n`. `id` and `createdAt` are optional on the wire (a hand-written line still imports) — `fragment-mcp`'s `add_resource` tool always fills both, which is what makes re-importing the same file idempotent (a line whose `id` is already known is skipped). A whole `resources.jsonl` is read and imported in full on every poll — there's no `since` filter the way there is for piece files, because the idempotent-by-id upsert makes that safe and cheap.

## How the import actually happens today (read this before assuming an HTTP push endpoint exists)

There is **no HTTP endpoint that accepts a piece body directly.** The only way to hand Fragment a piece today is to write a `.md` file into the inbox directory — via `fragment-mcp`'s tools/CLI (which write straight to disk), or by hand. What varies is how the **running Fragment app** notices those files and imports them into its store:

- **Desktop (Tauri):** the app reads `~/.fragment/inbox` directly off the filesystem. No HTTP involved.
- **Browser / self-hosted server:** a browser can't read your local filesystem, so the app polls its own Next.js server every 10 seconds:
  - `GET /api/v1/agent-inbox?since=<epoch-ms>` — lists pending `.md` handoff files (and every idea's `resources.jsonl`, always in full) that a `since` cursor hasn't seen yet. Recurses through per-idea subdirectories; never follows a client-supplied path.
  - `POST /api/v1/agent-inbox/ack` — body `{ imported?: string[], statusEvents?: {pieceId, status, at}[] }`. Once the app has folded a batch of files into its local store, it acks each `relPath` (the route moves that file into `.imported/`) and appends any local status changes (e.g. the user manually marking a piece published) to `.status.jsonl` tagged `by: "user"`.

Both routes are gated identically by `gateAgentInbox` (`src/lib/agent-inbox/gate.ts`) — see the security section below. **fragment-mcp itself never calls either route** — its `FileTransport` writes and reads the inbox directory directly, the same directory the browser-mode app is polling over HTTP. The gated HTTP routes exist so the *browser tab* can see what an agent already wrote to disk, not so an agent can push over HTTP.

**M2 seam:** `fragment-mcp`'s `HttpTransport` (`packages/fragment-mcp/src/http-transport.ts`) is a typed stub for a future hosted push API — every method currently throws `"not implemented yet"`. Until the hosted Fragment API ships, every `fragment-mcp` install talks to a local `FRAGMENT_INBOX_DIR`, full stop.

## Eventual consistency

Reads are not transactional. `list_ideas` and `get_piece` (and the app's own polling importer) reconstruct current state by scanning files on disk and layering `.status.jsonl` on top — there is no locking between an agent process and the running Fragment app. Concretely:

- A piece you just pushed with `add_piece` may not show up in `list_ideas`/`get_piece` from a *different* process for a few seconds, until that process's next read.
- The Fragment app itself only picks up new files every 10 seconds (browser mode) or on its own poll tick (desktop).
- `update_status` appends to `.status.jsonl` rather than editing a piece file — the piece's effective status is always "the latest matching log entry, or the file's baked-in status if there is none." A `get_piece` right after your own `update_status` call in the *same* process is consistent; from elsewhere, it's eventually so.

Design for this: treat every read as a snapshot that might be a few seconds stale, not a source of truth to poll tightly against.

## MCP server

`fragment-mcp` wraps this contract as MCP tools so agents don't hand-write files. Install (not on npm yet — register a local build):

```bash
cd packages/fragment-mcp && npm install && npm run build   # -> dist/bin.js
claude mcp add fragment-mcp -- node /absolute/path/to/fragment/packages/fragment-mcp/dist/bin.js
```

Once published, the same thing becomes `claude mcp add fragment-mcp -- npx fragment-mcp`.

| Tool | Input | Output | Notes |
|---|---|---|---|
| `create_idea` | `title` (required), `summary?`, `agent?`, `parentId?` | `{ ideaId, title, parentId }` | `parentId` must point at an existing **root** idea — nesting is capped at depth 2, and Fragment rejects a `parentId` that's itself a child. |
| `add_piece` | `ideaId?` or `ideaTitle?` (one required), `format` (required), `title?`, `content` (required — the markdown body), `priority?` (0-4), `supersedes?`, `resources?`, `scheduledAt?`, `agent?`, `model?` | `{ pieceId, ideaId }` | Append-only: always creates a **new** piece file, never edits an existing one. Lands with `status: inbox` no matter what's passed. A re-draft sets `supersedes` to the id of the piece it replaces, rather than overwriting it. |
| `list_ideas` | `status?` (only return ideas with at least one piece in this status) | `{ ideas: [{ id, title, summary, parentId, priority, origin, createdAt, updatedAt, counts: {inbox, "in-progress", ready, published}, total }] }` | `counts` always shows the full per-status breakdown, even when `status` narrowed which ideas are returned. |
| `get_piece` | `pieceId` (required) | The piece: `{ id, ideaId, format, status, origin, title, priority, scheduledAt, agent, model, supersedes, createdAt, updatedAt, body, resources }` | `status` is the *effective* status — `.status.jsonl` layered on top of the file's baked-in `inbox`. |
| `update_status` | `pieceId` (required), `status` (required — must be `"published"`) | `{ pieceId, status }` | The **only** status transition an agent may make. Every other value is rejected with a clear error — every other status is a user verdict made inside Fragment. Errors loudly on an unknown `pieceId` rather than silently appending an orphaned log line. |
| `add_resource` | `ownerType` (`idea`\|`piece`, required), `ownerId` (required), `kind` (`link`\|`note`\|`asset`, required), `title` (required), `url?`, `note?` | `{ resourceId, ideaId }` | Appends to the owning idea's `resources.jsonl` (never a new file per call). For a piece owner, the idea that piece belongs to is resolved automatically — `ideaId` in the response is that resolved idea, not the piece. |

All tool inputs are validated against the contract's own zod schemas before anything touches disk — a malformed call fails with a descriptive error, not a partially-written file.

### CLI mode

```bash
fragment-mcp push <file.md>
```

Validates the file as a contract handoff (the same `parsePieceFile` the app itself uses) and writes it into the inbox exactly like `add_piece` would. Prints, on success:

```
queued 1 piece(s); open Fragment to import.
  piece <pieceId> -> idea <ideaId> (<inboxDir>)
```

(Verified by actually running this against a scratch `FRAGMENT_INBOX_DIR` while writing this document — the frontmatter round-trips byte-exact through `parsePieceFile` → `serializePieceFile`.)

## Security: enabling ingress

The HTTP routes above (and the LinkedIn-publish proxy) are closed by default and gated by these env vars, all resolved server-side in `src/lib/agent-inbox/gate.ts`:

| Var | Effect |
|---|---|
| `FRAGMENT_LOCAL_INGRESS` | Must be exactly `"true"` to open the gate at all. Unset or anything else: every gated route 404s, always. Never true on the hosted SaaS build regardless of this value — local ingress reads a local filesystem the hosted build doesn't have. |
| `FRAGMENT_INGRESS_TOKEN` | Bearer token required for any request whose `Host` header isn't `localhost`/`127.0.0.1`/`::1` (or in the allowed-hosts list below). Localhost requests need no token. A non-localhost request with no token configured, or a mismatched `Authorization: Bearer <token>`, is rejected. |
| `FRAGMENT_INGRESS_ALLOWED_HOSTS` | Comma-separated hostnames (ports ignored) treated like localhost: no token required. For serving Fragment to your own browser through a reverse proxy or private-network name (a tailnet/VPN hostname, a LAN name) — the browser's own inbox polling can't attach a bearer token, and without this the gate 404s it. Only list names that are private to you: a `Host` header is caller-controlled, so this trusts your network path, not the caller. |
| `FRAGMENT_INBOX_DIR` | Overrides the inbox location. Defaults to `~/.fragment/inbox`. Must match between whatever writes files (fragment-mcp, a hand-written script) and the running Fragment app, or they'll be looking at different directories. |

A closed gate always responds `404`, never `401`/`403` — so a scan can't distinguish "ingress disabled" from "route doesn't exist."

Example `.env.local` for local self-hosted use with an agent running on the same machine:

```
# Same machine only — Fragment app and agent both talk to localhost, no token needed.
FRAGMENT_LOCAL_INGRESS=true
```

Example for an agent on a different machine on your network (or a remote agent host, like a fleet VPS) reaching a self-hosted Fragment server:

```
FRAGMENT_LOCAL_INGRESS=true
FRAGMENT_INGRESS_TOKEN=a-long-random-string-you-generate
# FRAGMENT_INBOX_DIR=/custom/path      # optional; defaults to ~/.fragment/inbox
```

The remote agent then sends `Authorization: Bearer a-long-random-string-you-generate` on every request. Treat this token like any bearer credential — anyone who has it can read and ack your inbox.

Example for a server you reach in your own browser via a private hostname (VPN/tailnet or LAN) instead of localhost:

```
FRAGMENT_LOCAL_INGRESS=true
FRAGMENT_INGRESS_ALLOWED_HOSTS=my-server.my-tailnet.ts.net
```

Without this, the app loads fine but silently never imports: its own polling arrives with the private hostname in `Host`, the gate treats it as remote, and 404s it.

## A note on trust and prompt injection

Agent-pushed content is untrusted input, full stop. Fragment renders a piece's markdown as text and never executes it, and nothing publishes to a real platform without a human explicitly clicking publish (or, for the Substack loop, a human-initiated attempt that Fragment later confirms against the public RSS feed — never a background auto-publish).

The sharper edge: **once you pull an agent-pushed piece's text into your document, or otherwise treat it as material you're drafting from, it can become AI context.** Fragment's own AI features (Flow's slash-command generation, Refine's inline edits) send the surrounding document text to whatever provider you've configured, and that surrounding text can include content an agent wrote. A prompt-injection attempt embedded in a drafted piece ("ignore prior instructions and...") is just more markdown to Fragment and to any AI call that later includes it as context — it has no special authority, but it also isn't filtered out.

The practical rule: **your review before a piece leaves `inbox` is the trust boundary**, not the moment it's imported (import itself is automatic — that's the inbox's whole point). Read a piece before promoting it, before dragging its content into a note you're actively drafting with AI assistance, and before publishing it anywhere. Never wire up automatic accept/promote/publish for agent-pushed content — the `update_status` tool intentionally only lets an agent report `"published"` after *it* posted something, precisely so "accept" always stays a human action taken inside Fragment.
