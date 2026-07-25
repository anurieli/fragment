# Fragment Agent API

Fragment is the content store your agents write into. An agent (Claude Code, Codex, Hermes, or anything that can write a file) drafts content pieces — LinkedIn posts, tweet threads, Substack essays — and hands them to Fragment, where they land in your **inbox** grouped under the **Idea** they belong to. You review, refine, and publish. This document is the stable public interface for that handoff.

**Contract version: `fragment: 1`.** Every handoff declares this version. Fields are only ever added within a version; breaking changes get a new version number that Fragment supports side by side. Source of truth: `src/lib/content-engine/` (types + zod schemas).

## The data model in 30 seconds

- **Idea** — a container for one line of thinking. Ideas can nest one level deep (a "North Star" idea with sub-ideas; max depth 2). Ideas have priority (0 none / 1 urgent / 2 high / 3 medium / 4 low) and can be pinned.
- **ContentPiece** — one publishable unit inside an idea: `format` is `linkedin`, `tweet`, `substack`, `essay`, or `other`; `status` flows `inbox → in-progress → ready → published`. Agent-pushed pieces always start in `inbox`. A piece's `created_at` is its canonical age — the inbox surfaces how long a piece has been waiting.
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
| `format` | yes | `linkedin` \| `tweet` \| `substack` \| `essay` \| `other` |
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

## JSON API

The same schema, camelCase, over HTTP — for agents that prefer an endpoint to a file. Ships with the local ingress feature (`POST /api/v1/agent-inbox`, gated off by default; bearer token required beyond localhost). The hosted SaaS exposes the same body at the same path. Example:

```json
{
  "fragment": 1,
  "ideaTitle": "Voice is the moat",
  "format": "linkedin",
  "body": "Everyone is automating content...",
  "priority": 2,
  "agent": "claude-code",
  "resources": [{ "kind": "link", "url": "https://example.com", "title": "Source" }]
}
```

## MCP server

`fragment-mcp` wraps this contract as MCP tools so agents don't hand-write files:

| Tool | Purpose |
|---|---|
| `create_idea` | Create an idea (title, summary, optional parent — one level of nesting max) |
| `add_piece` | Push a piece (the frontmatter fields as arguments) |
| `list_ideas` | Browse ideas with piece counts and statuses |
| `get_piece` | Read a piece back (status, content) |
| `update_status` | Move a piece between statuses |
| `add_resource` | Attach a link/note/asset to an idea or piece |

## A note on trust

Agent-pushed content is untrusted input. Fragment renders it as text, never executes it, and nothing publishes without a human clicking publish. Prompt-injection attempts in a drafted piece can annoy the reviewer, not the system.
