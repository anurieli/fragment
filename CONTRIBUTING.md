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

```bash
git clone https://github.com/anurieli/fragment.git
cd fragment
npm install
npm run dev
```

Open http://localhost:3100. That's it: Fragment runs entirely in your browser
(IndexedDB) with no backend and no configuration. To use AI, open **Settings > AI**
and either paste an API key (OpenRouter, OpenAI, Anthropic, Perplexity), point it at
a local **Ollama** instance, or click **Sign in with ChatGPT** for Codex.

## Project layout

The architecture, data model, UI specs, and interaction flows are documented in
[`PRD.md`](./PRD.md). Read it before making structural changes. In short:

- `src/app/` — Next.js App Router pages and API route handlers
- `src/components/` — UI (editor, sidebar, Snip Bar, settings, etc.)
- `src/stores/` — Zustand state (`app-store`, `data-store`, `settings-store`)
- `src/lib/` — types, persistence (Dexie), AI provider runtime, utilities
- `src/hooks/` — feature hooks (Snip labeling, Flow generation, Refine editing)

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
