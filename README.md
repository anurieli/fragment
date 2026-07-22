<div align="center">

# Fragment

**A writing app that treats essays like puzzles.**

Snip your ideas into cards, rearrange them like puzzle pieces, and weave them back
into the draft. Built for long-form writing: essays, blog posts, articles.

Local-first. Your writing lives in your browser. Nothing leaves your machine unless
you connect an AI provider.

</div>

---

## Why Fragment? (the goal)

Long-form writing isn't really about typing sentences in order. It's about collecting
ideas, fragments, quotes, half-thoughts, and then figuring out how they fit together.
Most editors treat your document as one linear stream of text and leave that harder
part, the *arranging*, entirely in your head.

Fragment's goal is to make that thinking visible and physical. Your ideas become
**pieces you can pick up and move**: snip a paragraph out of the draft into a card, set
it aside, try it somewhere else, drag it back in when it clicks. AI helps by labeling
pieces, generating a line where you're stuck, or tightening a sentence, but **you stay
the author** — it never writes the essay for you or moves things behind your back.

It's built for people doing real long-form work (essays, blog posts, articles), and
it's **local-first**: your writing lives on your machine, and nothing leaves it unless
you choose to connect an AI provider. Own your words, own your process.

## What is Fragment?

Fragment is a three-panel writing tool:

1. **Sidebar** (left) — your notes.
2. **Editor** (center) — a live markdown writing surface with slash commands.
3. **Snip Bar** (right) — a staging area for the ideas you're rearranging.

The core loop: write in the editor, pull sentences and paragraphs out to the Snip
Bar as **snippets** (the little ideas you're collecting), drag them back in wherever
they belong. AI labels each snippet so you can scan what's what at a glance.

Three AI features, all optional and all context-aware:

- **Snip** — select text, snip it out as a card, drag it around, rearrange.
- **Flow** — type `/` mid-document to generate text inline without breaking your flow.
- **Refine** — highlight text for a floating toolbar: Concise, Elaborate, or a custom edit.

Plus: live markdown rendering, version history with manual snapshots, global search
across all notes (`Cmd+Shift+F`), and export to Markdown or HTML.

## Quick start (run it locally)

Fragment runs entirely in your browser with **no backend and no configuration**.

```bash
git clone https://github.com/anurieli/fragment.git
cd fragment
npm install
npm run dev
```

Open **http://localhost:3100** and start writing. That's the whole setup. Your notes
are stored locally (IndexedDB) and survive refreshes.

> Requires Node.js 20+ and npm.

## Connecting AI (optional)

Fragment works fully without AI. When you want it, open **Settings > AI > Providers**
and pick any provider. You can mix and match per feature: a fast local model for
labeling, a cloud model for generation, whatever you like. No environment variables,
no server setup: everything is configured in the app and stored locally.

### Sign in with ChatGPT (Codex)

The zero-key option. In **Settings > AI > Providers**, click **Sign in** on the
**Codex (OpenAI)** card and authorize with your ChatGPT account. It works out of the
box on your local machine: no API key to paste, no server secret to configure. Pick a
model for each feature and you're writing.

### Bring your own API key

Paste a key into the matching provider card in **Settings > AI > Providers**:

- **OpenRouter** — one key, hundreds of models (GPT, Claude, Gemini, Llama, and more).
  Get a key at [openrouter.ai](https://openrouter.ai).
- **OpenAI**, **Anthropic**, **Perplexity** — connect each provider directly.

Keys are stored locally in your browser and sent only to that provider.

### Run models locally (Ollama)

No key, no cloud, no cost.

1. Install [Ollama](https://ollama.com) and pull a model: `ollama pull llama3`
2. Make sure it's running: `ollama serve`
3. In **Settings > AI > Providers**, select **Local (Ollama)** for the features you want.

> Ollama runs on `localhost:11434` by default. Fragment auto-detects installed models.

## Commands

```bash
npm run dev          # Start the dev server (http://localhost:3100)
npm run build        # Production build
npm test             # Unit tests (Vitest)
npm run test:e2e     # End-to-end tests (Playwright)
```

## Tech stack

Next.js 16 &middot; React 19 &middot; TypeScript &middot; Tailwind CSS 4 &middot;
Tiptap 3 &middot; Zustand &middot; Dexie (IndexedDB) &middot; Lucide icons

Architecture, data model, UI specs, and interaction flows are documented in
[`PRD.md`](./PRD.md).

## Contributing

Contributions that keep Fragment simple and focused are welcome. See
[`CONTRIBUTING.md`](./CONTRIBUTING.md) to get started.

## License

[MIT](./LICENSE) &copy; Ariel Nurieli
