# Fragment — Quick Start

## What is this?

Fragment is a writing tool where you treat your essay like a puzzle. Write freely, pull out pieces you want to move, and drop them back in where they belong. Three core features: **Snip**, **Flow**, and **Refine**.

## The three panels

```
[ Sidebar ]  [ Editor ]  [ Snip Bar ]
  Your         Where       Your snippet
  notes        you write   staging area
```

- **Sidebar** (left): All your notes. Click one to open it.
- **Editor** (center): Your writing surface. Markdown renders live.
- **Snip Bar** (right): Holds text fragments you've pulled out.

## First steps

1. **Create a note**: Click "New note" in the sidebar
2. **Set note context**: Fill in the "GOAL" field above the editor (and include audience/theme as needed) — e.g., "Argue that remote work is better"
3. **Generate a title**: Add a clear working title so the note has direction from the start
4. **Write**: Just type. Markdown works live — `## Heading`, `**bold**`, `> quote`, etc.

## Onboarding discussion checklist

- How to edit model configuration
- How to choose the model for the task
- What each side panel does (sidebar, editor, Snip Bar)
- How **Snip** works end-to-end (create, label, stage, and reinsert)
- How **Flow** works (slash commands for inline generation)
- How **Refine** works (highlight → concise, elaborate, or custom edit)
- How to add strong note context (goal, audience, theme)
- How to generate and refine titles
- Where image generation settings and themes live in Settings

## Snip — Moving text around

This is the core of Fragment. When a sentence or paragraph feels out of place:

1. **Select** the text in the editor
2. **Snip it**: Click "Snip" in the floating toolbar (or drag the selection to the Snip Bar)
3. The text stays in your essay AND appears as a card in the Snip Bar
4. AI automatically labels it so you can remember what it is
5. **Drag it back** wherever it belongs — a gold line shows exactly where it'll go

You can drag snippets to reorder them in the Snip Bar too.

## Flow — AI generation

On an empty line, type `/` then your instruction:
- `/write a transition between these paragraphs`
- `/expand on the argument above`
- `/summarize the key points`

Press Enter — AI generates content that fits between what's above and below, matching your writing style.

## Refine — Inline editing

Highlight any text in the editor and a floating toolbar appears:

- **Snip** — Add the selection as a snippet
- **Concise** — AI makes it tighter
- **Elaborate** — AI adds more detail
- **Edit** — Type your own instruction (e.g., "make this funnier", "rewrite as a question")

The toolbar stays beside the highlighted text and flips above or below it as needed to remain inside the visible editor.

All edits are context-aware — the AI sees the surrounding text and your note's goal/audience/tone. Undo with `Cmd+Z` if you don't like the result.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Cmd+H` | Toggle Snip Bar |
| `Cmd+\` | Toggle sidebar |
| `Cmd+Shift+F` | Search all notes |
| `/` (empty line) | Flow — AI generation |

## Settings

Click the gear icon at the bottom of the sidebar. You can:
- Enter your Gemini API key
- Toggle AI features on/off (Snip labeling, Flow, Refine)
- Change/select the AI model per feature
- Edit model configuration
- Edit the prompt templates
- Configure image generation settings
- Choose app themes
