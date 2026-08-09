# Contributing to Fragment

Thanks for your interest in Fragment. It's a small, local-first writing app, and
contributions that keep it simple and focused are very welcome.

## Ground rules

- **Keep it simple.** Fragment is for people writing long-form work: essays, blog
  posts, articles. Features that don't serve that writer, or that add friction to
  the core "snip an idea, move it, weave it back in" loop, are unlikely to land.
- **One change, one purpose.** Small, reviewable pull requests beat large ones.
- **Discuss before you build.** For anything beyond a bug fix or small polish, open
  an issue first so we can agree on the approach before you spend time on it.

## Getting set up

This is `fragment-cloud`, the private hosted edition. Unlike the public client, it
has a backend: Postgres, Google sign-in, and sync.

```bash
git clone https://github.com/anurieli/fragment-cloud.git
cd fragment-cloud
npm install
cp .env.example .env.local   # then fill it in, see CLOUD.md
npm run dev
```

Open http://localhost:3100. Writing works offline against IndexedDB with no
configuration, but accounts, sync, and share links need the environment variables
and database described in [`CLOUD.md`](./CLOUD.md). To use AI, open
**Settings > AI** and either paste an API key (OpenRouter, OpenAI, Anthropic,
Perplexity), point it at a local **Ollama** instance, or click **Sign in with
ChatGPT** for Codex.

## Project layout

Read [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md), then
[`docs/DATA-MODEL.md`](./docs/DATA-MODEL.md), [`docs/SYNC.md`](./docs/SYNC.md) and
[`docs/API.md`](./docs/API.md) before making structural changes.
[`PRD.md`](./PRD.md) is product history and predates accounts, sync, and the
Content Engine; do not treat it as the architecture. In short:

- `src/app/` — Next.js App Router pages and API route handlers
- `src/components/` — UI (editor, sidebar, Snip Bar, settings, etc.)
- `src/stores/` — Zustand state (`app-store`, `data-store`, `content-store`, `settings-store`)
- `src/lib/` — types, persistence (Dexie), sync, AI provider runtime, utilities
- `src/lib/server/` — hosted-only server code (Postgres, auth, sessions, shares)
- `src/hooks/` — feature hooks (Snip labeling, Flow generation, Refine editing)
- `db/migrations/` — SQL migrations, applied with `npm run db:migrate`
- `packages/fragment-mcp/` — the MCP server agents use to file ideas

## Docs change with the code

A pull request that alters the schema, an HTTP route, or the sync wire updates
the doc that describes it in the same change:

| You changed | Update |
|---|---|
| A Dexie table, an entity field, or a SQL migration | `docs/DATA-MODEL.md` |
| A route handler, its auth, or its request/response shape | `docs/API.md` |
| `SYNCED_COLLECTIONS`, the outbox, or the sync engine | `docs/SYNC.md` |
| A new subsystem, or how existing ones connect | `docs/ARCHITECTURE.md` |
| The agent handoff format or an MCP tool | `docs/AGENT-API.md` |

Docs that lag the code are worse than no docs, because the reader cannot tell
which parts still hold. Keeping them in the same commit is the only version of
this rule that survives contact with a busy week.

## Development workflow

```bash
npm run dev          # Start the dev server (http://localhost:3100)
npm test             # Unit tests (Vitest)
npm run test:e2e     # End-to-end tests (Playwright)
npm run build        # Production build
npm run lint         # ESLint (Next core-web-vitals + TypeScript rules)
```

Before opening a pull request, please make sure `npm run build`, `npm test` and
`npm run lint` all pass.

## Code standards

- **TypeScript, strict mode.** Avoid `any` (Tiptap storage access is the one
  pragmatic exception).
- **Named exports only**, ESM imports.
- **Zustand** for ephemeral UI state, **Dexie** (IndexedDB) for anything that must
  survive a refresh.
- Match the style of the surrounding code: naming, comment density, and idiom.
- No `console.log` in committed code.

## Reporting bugs and requesting features

Use [GitHub Issues](https://github.com/anurieli/fragment/issues). For bugs, include
your browser, steps to reproduce, and what you expected. For feature ideas, describe
the writing problem you're trying to solve, not just the mechanism.

## Sign your commits (DCO)

Contributions must be made under the [Developer Certificate of Origin](https://developercertificate.org/):
a simple statement that you wrote the change (or have the right to submit it) and agree
it can be shipped under this project's license. You certify it by **signing off** each
commit:

```bash
git commit -s -m "your message"
```

This appends a `Signed-off-by: Your Name <your@email>` line. Please make sure the name
and email match the ones you commit with. Pull requests with unsigned commits will be
asked to add the sign-off.

## License and brand

By contributing, you agree that your contributions are licensed under the
[MIT License](./LICENSE) that covers this project's code. Note that the Fragment name,
logo, and brand are reserved and are not covered by the MIT License; see
[`TRADEMARK.md`](./TRADEMARK.md).
