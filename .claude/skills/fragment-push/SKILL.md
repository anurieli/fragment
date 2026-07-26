---
name: fragment-push
description: >
  Push drafted content into Fragment, the user's writing app. Fragment is the
  content store: agents draft pieces (LinkedIn posts, tweet threads, Substack
  essays, scripts) and hand them off; the user reviews, refines, and publishes
  from the Fragment UI. Use whenever: (1) you have drafted social or long-form
  content the user should review and publish; (2) the user says "put this in
  Fragment", "push to my inbox", or "draft pieces for idea X"; (3) a content
  workflow ends with deliverable posts/essays. NOT for: publishing directly to
  platforms (the user publishes from Fragment).
---

# Pushing content into Fragment

Fragment's agent inbox is a drop folder at `~/.fragment/inbox/` (override with
`FRAGMENT_INBOX_DIR`) on the machine where the Fragment app runs. The app
imports new files within ~10 seconds while it is open, acknowledges them by
moving them to `.imported/`, and reports outcomes to `.status.jsonl`. Local
ingress must be enabled in the app. Full API reference: `docs/AGENT-API.md`.

## Preferred: the MCP tools

If your session has the `fragment` MCP server (`packages/fragment-mcp`, stdio:
`node packages/fragment-mcp/dist/bin.js`), use its tools:

1. `list_ideas` first. Every piece MUST belong to an idea; reuse an existing
   idea when the thought matches, don't create near-duplicates.
2. `create_idea` only when the line of thinking is genuinely new. An idea is a
   relatable, learnable thought, not a topic label. Ideas nest max 2 levels.
3. `add_piece` per piece: `format` is one of `linkedin | tweet | substack |
   essay | script | other`; the body is byte-exact markdown (Fragment never
   reformats it). Tweet threads: separate tweets with a line containing only
   `---`.
4. `add_resource` for sources/inspiration links tied to the idea or piece.
5. Never call `update_status` except to mark `published` after the user
   actually posted something; all other status moves are theirs.

**Remote setup:** the MCP server writes to its local filesystem. If the
Fragment app runs on a different machine than your agent, register the server
as a remote stdio command so it runs where the inbox lives, e.g.:

```
claude mcp add fragment -- ssh <user>@<host> node /path/to/fragment/packages/fragment-mcp/dist/bin.js
```

## Fallback: drop a file

Write `~/.fragment/inbox/<name>.md` with YAML frontmatter:

```markdown
---
fragment: 1
idea_title: "Voice is the moat"
format: linkedin
title: "Short label for the piece"
priority: 2
agent: <your-name>
model: <your-model>
---
The piece body, exactly as it should read.
```

Or use the CLI: `node packages/fragment-mcp/dist/bin.js push <file.md>`.

## Rules

- Write in the user's voice, not a generic AI voice.
- One file / one `add_piece` call per piece. A LinkedIn post and its
  tweet-thread twin are two pieces under the same idea.
- Don't delete or edit anything in `.imported/` or `.status.jsonl`.
- Pieces land in the user's inbox for review; never assume they were published.
