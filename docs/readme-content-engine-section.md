<!--
Ready-to-paste README section for the Content Engine (Press / Pieces / Pass).
Ariel: weave this into README.md by hand — this file is not wired into any
build step and nothing else references it. Written to match README.md's
existing voice (short declarative sentences, a light editorializing aside
here and there, no em dashes). Every claim below is grounded in shipped
code — see docs/AGENT-API.md for the wire-level detail this section only
summarizes.
-->

## Your agents can write here too

Fragment is also a content database with a review inbox. Point any
MCP-capable agent at it and it can draft LinkedIn posts, tweet threads, and
essays directly into your queue:

```bash
claude mcp add fragment -- npx fragment-mcp
```

> `fragment-mcp` isn't published to npm yet — for now, register it from a
> local build:
> `claude mcp add fragment-mcp -- node /absolute/path/to/fragment/packages/fragment-mcp/dist/bin.js`
> (build it first: `cd packages/fragment-mcp && npm install && npm run build`).
> The `npx fragment-mcp` form above is what it becomes once published.

Agents draft. You stay the editor. Everything an agent pushes lands in your
inbox as a normal, editable draft, never live, never sent anywhere on its
own. Nothing publishes without you.

### Two writing spaces

Every idea has two spaces, side by side: **Write** is the long-form editor
you already know. **Pieces** is a short-form feed for that same idea, the
LinkedIn posts, tweets, and Substack drafts that idea produces. Agents write
into Pieces; you triage it like an inbox and decide what's worth shipping.

### Publish by copy

Fragment doesn't hold API keys for every platform, so it hands you the text
instead: one click copies a piece formatted for its destination (LinkedIn,
X, Substack), whitespace preserved exactly, and opens that platform's own
composer where one exists. For Substack, Fragment then watches your feed's
RSS in the background and marks the piece published the moment it actually
goes live, no manual "did it work?" step. Kit (formerly ConvertKit) gets a
real one-click integration: publish a draft or schedule a send straight from
Fragment. LinkedIn works the same way through Composio, once you connect an
account in Settings.

### Pass — send a draft to anyone

Click **Send for review** and Fragment downloads a single self-contained
HTML file with your draft inside it. Send that file to anyone, an editor,
a co-founder, your mom, and they open it in a browser and start commenting:
highlight a passage, leave a note, no account, no install, nothing to sign
up for. When they're done, they send back a small file with their comments,
and importing it drops every comment right onto the matching text in your
document.
