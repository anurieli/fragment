# Fragment — Product Requirements Document

## What is Fragment?

Fragment is a writing tool that treats essays like puzzles. Instead of writing linearly from top to bottom, Fragment lets you break your writing apart, move pieces around, and reassemble them — the way thinking actually works.

The interface has three panels:

1. **Sidebar** (left) — your collection of notes
2. **Editor** (center) — the writing surface with live markdown
3. **Snip Bar** (right) — a staging area for text fragments you're rearranging

The core workflow: you write in the editor, pull sentences and paragraphs out to the Snip Bar as snippets, then drag them back in wherever they belong. AI labels each snippet so you can scan what's what at a glance.

### Core Features (User-Facing Names)

Fragment has three headline features. These names are used on the website, in marketing, and in user research:

| Feature | Name | Description |
|---------|------|-------------|
| Snippets + Snip Bar | **Snip** | Select text, snip it out as a card, drag it around, rearrange your ideas like puzzle pieces |
| Slash command generation | **Flow** | Type `/` mid-document to generate text inline — beginning, middle, or end — without breaking your writing flow |
| Inline editing | **Refine** | Highlight text → floating toolbar with Snip, Concise, Elaborate, or custom Edit. All edits are context-aware — they respect surrounding text and the full document |

---

## Screens & Layout

### Overall Structure

The app is a single full-viewport page with three columns:

```
┌──────────┬─────────────────────────────────────┬──────────────┐
│          │  Title                    [Snip] [H] │              │
│ Sidebar  │  GOAL: ________________________     │  Snip Bar    │
│ (260px)  │                                     │  (320px)     │
│          │  Editor                              │              │
│ Notes    │  (live markdown)                     │  Snippets    │
│ list     │                                     │              │
│          │                                     │              │
│          │                                     │              │
│          │                                     │              │
└──────────┴─────────────────────────────────────┴──────────────┘
```

Both the sidebar and Snip Bar are collapsible. When collapsed, they animate to `width: 0` over 200ms. Toggle icons appear in the editor toolbar when a panel is hidden.

### Screen 1: Sidebar (Left Panel)

**Purpose**: Browse and manage your notes.

**Components**:
- **Header**: App name "Fragment" in display font + collapse toggle icon
- **New note button**: Prominent button at the top. Creates a blank note and opens it in the editor.
- **Note list**: Scrollable list of all notes, sorted by last modified (newest first)
  - Each note item shows:
    - **Title** (or "Untitled" if empty) — 13px, medium weight
    - **Content preview** — first 60 characters of the markdown content, stripped of formatting characters — 11px, muted color
    - **Timestamp** — relative time ("3m ago", "2h ago", "Mar 15") in mono font — 10px, faint color
    - **Delete button** — trash icon, hidden by default, revealed on hover over the note item. Red on hover.
  - **Active state**: The currently open note has a `surface-2` background and `border-active` (gold-tinted) border
  - **Hover state**: Non-active notes get `surface-2` background on hover
- **Empty state**: When no notes exist — file icon + "No notes yet" + "Create one to start writing"
- **Search bar**: Text input at the top of the list (below the new note button). Filters notes by title and content as you type. See [Search](#search) section.
- **Settings button**: Gear icon at the bottom-left of the sidebar (pinned to bottom, outside the scroll area). Opens the settings modal. See [Settings](#settings) section.

### Screen 2: Editor (Center Panel)

**Purpose**: The writing surface.

**Components**:
- **Toolbar** (52px height, pinned to top):
  - Left side: Sidebar reopen icon (when sidebar is collapsed) + title input field
  - Right side: "Snip" button (appears only when text is selected) + Snip Bar reopen icon (when Snip Bar is collapsed)
- **Goal input**: Below toolbar. Mono-font label "GOAL" + text input. Placeholder: "What are you writing about?" This field feeds context to the AI labeling system. It's a one-liner that describes the essay's purpose.
- **Tiptap editor**: The main writing area. Fills all remaining vertical space.
  - Live markdown rendering — typing `##` followed by a space immediately renders as a heading, `**text**` renders bold, etc.
  - Gold caret
  - Gold text selection highlight
  - Gold drop cursor when dragging snippets over the editor
  - Placeholder text: "Start writing..." (shown when editor is empty)
  - Bottom padding of 40vh so the writing line never sits at the very bottom of the screen
  - Horizontal padding of 4rem for comfortable reading width
- **Slash command** (`/`): Typing `/` at the beginning of a line or after a newline opens an inline AI generation prompt. See [Slash Command AI Generation](#slash-command-ai-generation) section.

### Screen 3: Snip Bar (Right Panel)

**Purpose**: Hold text fragments while you figure out where they belong. User-facing name: **Snip**.

**Components**:
- **Header**: Puzzle icon + "SNIPPETS" label (uppercase, secondary color) + snippet count (mono, faint) + collapse toggle
- **Drop zone**: The entire scrollable area accepts drops. When a drag is hovering over it, the background transitions to `gold-muted` and a dashed gold border placeholder appears at the bottom ("Drop here").
- **Snippet cards**: Stacked vertically with 8px gap. Each card contains:
  - **AI label** (top): One-liner describing the snippet. Gold mono text, 10px. Shows loading spinner while AI is processing, or error icon if labeling failed.
  - **Grip handle**: Vertical dots icon on the left of the label row. Visual affordance for dragging.
  - **Delete button**: X icon on the right of the label row. Hidden by default, revealed on card hover.
  - **Content preview**: First ~5 lines of the snippet text. 12px, secondary color, preserves whitespace.
  - **Hover popup**: After hovering for 400ms, a popup appears to the LEFT of the card showing the full snippet text. Max height 384px with scroll. Disappears on mouse leave. The popup itself is hoverable (so you can scroll it).
  - **Drag behavior**: The entire card is draggable. Cursor changes to `grab` on hover, `grabbing` when dragging.
- **Snippet reordering**: Snippets can be dragged to reorder within the helper bar. A gold insertion line shows where the snippet will land, matching the same visual language as the editor's drop cursor. Dropping between existing snippets reorders them. The `order` field on each snippet is updated.
- **Empty state**: When no snippets exist — dashed border container filling the panel, puzzle icon, "No snippets yet", "Select text in the editor and drag it here, or use the Snip button".

---

## Data Objects

### Note

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier. Generated via `nanoid(12)`. |
| `title` | `string` | User-editable note title. Defaults to empty string. |
| `content` | `string` | The note's body as a markdown string. Serialized from the Tiptap editor. |
| `goal` | `string` | One-liner describing the essay's purpose. Used as AI context. |
| `createdAt` | `number` | Unix timestamp (ms) of when the note was created. |
| `updatedAt` | `number` | Unix timestamp (ms) of last modification. Used for sorting. |

### Snippet

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier. Generated via `nanoid(12)`. |
| `noteId` | `string` | Foreign key to the parent Note. Snippets are scoped per-note. |
| `content` | `string` | The extracted text (markdown). |
| `label` | `string \| null` | AI-generated one-liner label. `null` while loading or on error. |
| `labelStatus` | `"idle" \| "loading" \| "done" \| "error"` | Current state of the AI labeling process. |
| `createdAt` | `number` | Unix timestamp (ms) of when the snippet was created. |
| `order` | `number` | Position in the Snip Bar. Used for sorting. Updated on reorder and on drop-position insertion. |

### SlashCommand (ephemeral, not persisted)

| Field | Type | Description |
|-------|------|-------------|
| `prompt` | `string` | The user's instruction (everything after `/`). |
| `contextAbove` | `string` | All document content above the cursor position. |
| `contextBelow` | `string` | All document content below the cursor position. |
| `goal` | `string` | The note's goal field, for essay-level context. |
| `cursorPos` | `number` | The ProseMirror document position where the result will be inserted. |

### AppSettings (persisted, single row)

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Always `"default"`. Single settings row. |
| `openRouterApiKey` | `string` | User-provided OpenRouter API key. Stored in IndexedDB. Required for cloud models only. |
| `snippetLabeling.enabled` | `boolean` | Whether AI labels are generated for new snippets. Default `true`. |
| `snippetLabeling.provider` | `"openrouter" \| "ollama"` | AI provider for labeling. `"openrouter"` = cloud (paid), `"ollama"` = local (free). Default `"openrouter"`. |
| `snippetLabeling.model` | `string` | Model ID for labeling. Default `"google/gemini-2.0-flash-001"` (OpenRouter format). |
| `snippetLabeling.maxEssayContext` | `number` | Max chars of essay sent as labeling context. Default `4000`. |
| `snippetLabeling.promptTemplate` | `string` | Editable system prompt for labeling. Has default value with `{goal}`, `{essayContent}`, `{snippetContent}` template variables. |
| `slashCommand.enabled` | `boolean` | Whether `/` triggers AI generation. Default `true`. |
| `slashCommand.provider` | `"openrouter" \| "ollama"` | AI provider for generation. Default `"openrouter"`. |
| `slashCommand.model` | `string` | Model ID for generation. Default `"google/gemini-2.0-flash-001"` (OpenRouter format). |
| `slashCommand.maxContextAbove` | `number` | Max chars above cursor. Default `3000`. |
| `slashCommand.maxContextBelow` | `number` | Max chars below cursor. Default `3000`. |
| `slashCommand.promptTemplate` | `string` | Editable system prompt for generation. Has default value with `{goal}`, `{contextAbove}`, `{contextBelow}`, `{userInstruction}` template variables. |

---

## Terminology

- **Note** — A document the user writes in. Has a title, goal, and markdown content. Lives in the sidebar. Opened in the editor.
- **Snippet** — A fragment of text extracted from a note into the Snip Bar. Can be dragged, reordered, and dropped back in. AI-labeled.
- **Snip Bar** — The right panel that holds snippets. Toggles with `Cmd+H`. Internally called "helper bar" in code, but user-facing name is **Snip Bar**.
- **Snip** — The feature name for the snippet system: selecting text, snipping it, dragging it, rearranging it.
- **Flow** — The feature name for slash command generation: type `/` mid-document to generate context-aware text inline.
- **Refine** — The feature name for inline editing: highlight text → floating toolbar with Concise, Elaborate, or custom Edit, all context-aware.
- **Goal** — A one-liner at the top of each note describing what the note is about. Fed to AI as context.
- **Slash Command** — Typing `/` at the start of a line to trigger AI generation (the **Flow** feature).

---

## Functionality

### Creating a Note

A new note is created via the "New note" button in the sidebar. It initializes with empty title, content, and goal. The note opens immediately in the editor. The sidebar item appears at the top of the list (it has the most recent `updatedAt`).

There is no keyboard shortcut for creating a new note — it's an intentional sidebar action.

### Editing a Note

The editor is a Tiptap 3 instance with `tiptap-markdown` providing live markdown rendering. What this means in practice:

- Type `# ` → renders as H1 (large display font)
- Type `## ` → renders as H2
- Type `### ` → renders as H3
- Type `**text**` → renders as bold
- Type `*text*` → renders as italic
- Type `` `code` `` → renders as inline code
- Type `> ` → renders as blockquote (gold left border)
- Type `- ` or `1. ` → renders as list
- Type `---` → renders as horizontal rule
- Type `[text](url)` → renders as clickable link (gold)

The content is serialized back to markdown for storage. Every edit triggers a debounced (500ms) save to IndexedDB.

Title and goal are separate input fields above the editor. They save on every change (debounced 300ms).

### Creating Snippets (Editor → Snip Bar)

There are two ways to create a snippet:

**Method 1: Snip button**
1. Select text in the editor
2. A "Snip" button with a scissors icon appears in the toolbar (animated in with `fadeIn`)
3. Click it
4. The selected text is copied to the Snip Bar as a new snippet
5. Text remains in the editor (copy, not cut)
6. If the Snip Bar was closed, it opens automatically

**Method 2: Drag and drop**
1. Select text in the editor
2. Drag the selection toward the Snip Bar
3. The Snip Bar shows drop feedback (gold background, "Drop here" placeholder)
4. Release
5. Snippet is created at the drop position
6. Text remains in the editor

In both cases, the snippet immediately enters `labelStatus: "loading"` and an async AI labeling request fires.

### Snippet Drop Position in Snip Bar

When a new snippet is dragged into the Snip Bar from the editor, its position in the snippet list is determined by WHERE it's dropped — not just appended to the end. A gold insertion line appears between existing snippet cards as the user drags over them, showing exactly where the new snippet will land. The `order` field is set accordingly. If dropped at the bottom or onto the empty state, it appends.

### Inserting Snippets (Snip Bar → Editor)

1. Drag a snippet card from the Snip Bar
2. Move it over the editor area
3. A gold drop cursor (line) appears in the editor at the nearest text position, showing exactly where the text will be inserted
4. Release
5. The snippet's markdown content is inserted at that position in the document
6. The snippet remains in the Snip Bar — it's not consumed. You can reuse it multiple times.

### Reordering Snippets (within Snip Bar)

Snippets can be dragged to reorder within the Snip Bar:
1. Grab a snippet card by its grip handle (or anywhere on the card)
2. Drag it vertically within the Snip Bar
3. A gold insertion line appears between other snippet cards showing the target position
4. Release to reorder
5. All affected snippet `order` values are updated and persisted

The visual feedback (gold insertion line) matches the editor's drop cursor — same color, same visual language.

### Deleting Snippets

Hover over a snippet card → an X icon appears at the top-right of the label row. Click to remove the snippet. Immediate removal from UI and IndexedDB. No confirmation dialog.

### Deleting Notes

Hover over a note in the sidebar → a trash icon appears. Click to delete the note and all its associated snippets. If the deleted note was the active note, the most recently modified remaining note becomes active. If no notes remain, the editor shows the empty state.

### Snippet Hover Popup

When a snippet's content is longer than 5 lines or 200 characters, hovering over the card for 400ms triggers a popup:
- Positioned to the LEFT of the card (so it doesn't overflow off-screen)
- Shows the complete snippet text
- Max height 384px with vertical scroll
- The popup itself is hoverable (mouse can enter it to scroll without it disappearing)
- Disappears when mouse leaves both the card and the popup

---

## Search

### Local Search (Cmd+F)

Standard browser-style find-in-document. Searches within the current note's editor content. This leverages the browser's native or Tiptap's built-in search functionality — a search bar appears at the top of the editor with match highlighting and prev/next navigation.

### Global Search (Cmd+Shift+F)

Searches across ALL notes by title and content. Opens a search overlay/modal:
- Text input with placeholder "Search all notes..."
- Results appear as a list below the input, updating as you type (debounced 200ms)
- Each result shows: note title, a content snippet with the matched text highlighted, and the timestamp
- Clicking a result closes the search overlay and opens that note in the editor
- Escape closes the overlay

---

## Slash Command AI Generation

Typing `/` at the start of a new line (or at the start of the document) opens an inline AI prompt input. This is a Tiptap extension-level feature.

### How It Works

**Trigger**: User types `/` as the first character of an empty line, or at the start of the document.

**UI**: A small inline input field appears at the cursor position, styled with a gold border and a subtle glow. Placeholder text: "Tell the AI what to write..." The `/` character is consumed (not shown in the document).

**User flow**:
1. User types their instruction, e.g., "write a transition between these two ideas" or "expand on the argument above" or "summarize the key points so far"
2. User presses Enter to submit
3. The input field shows a loading spinner while the AI generates
4. A **preview panel** appears showing the generated content — the text is not inserted yet
5. The user reviews the preview and chooses one of three actions:
   - **Insert** (click button or press `Enter`) — inserts the content at the cursor position as normal editable text
   - **Discard** (click button or press `Escape`) — dismisses the preview and returns to the prompt input so the user can try a different instruction
   - **Redo** (click button or press `⌘R`) — regenerates with the same prompt, replacing the preview with a new result

**Preview panel UI**: A card with a gold-bordered header showing the original prompt, a scrollable body (max 240px) displaying the generated text, and a footer with keyboard shortcut hints (`↵ insert`, `esc discard`, `⌘R redo`). Header has Redo, Discard, and Insert action buttons.

**Cancel**: Press Escape to dismiss the slash command input or preview without inserting anything.

### AI Process (Behind the Scenes)

When the user submits a slash command, the system constructs a prompt dynamically:

1. **Context above**: Everything in the document ABOVE the cursor position (the `/` line). This is the "what came before."
2. **Context below**: Everything in the document BELOW the cursor position. This is the "what comes after."
3. **Goal**: The note's goal field, providing essay-level intent.
4. **User instruction**: Whatever the user typed after `/`.

The API constructs this into a prompt:

```
You are a writing assistant helping the user write an essay.

Essay goal: "{goal}"

Here is what the user has written so far ABOVE the insertion point:
---
{contextAbove}
---

Here is what comes AFTER the insertion point:
---
{contextBelow}
---

The user wants you to generate content to insert between the above and below sections.

User instruction: "{userInstruction}"

Write the content that should go between the two sections. Match the tone, style, and voice of the surrounding text. Return ONLY the generated content — no explanations, no markdown code fences, just the text to insert.
```

**Endpoint**: `POST /api/generate`

**Model**: Configurable per-process. Default: `google/gemini-2.0-flash-001` via OpenRouter. Can also use local models via Ollama.

**Insertion**: After the user approves the generated content in the preview panel, the text is inserted at the cursor position as normal document content. The user can immediately edit, delete, or rearrange it like any other text.

---

## AI Processes

Fragment uses AI in three places (one per core feature: **Snip**, **Flow**, **Refine**). All are asynchronous, non-blocking, and use server-side route handlers. Each AI process can independently use either **OpenRouter** (cloud, any model) or **Ollama** (local, free). The provider and model are configurable per-process in Settings. For OpenRouter, the API key can be set in Settings UI or in `.env.local` as `OPENROUTER_API_KEY`.

### 1. Snippet Labeling (Snip)

**Purpose**: Automatically generate a short descriptive label for each snippet so the user can quickly scan the Snip Bar.

**Trigger**: Fires immediately when a new snippet is created (via snip button or drag-and-drop).

**Process**:
1. Client sends `POST /api/label` with:
   - `snippetContent`: the snippet text
   - `essayContent`: the full note content (truncated to 4000 chars)
   - `goal`: the note's goal field
2. Server constructs a prompt asking for a 5-10 word label
3. The configured model generates the label
4. Server returns `{ label: "..." }`
5. Client updates the snippet's `label` field and sets `labelStatus: "done"`

**Error handling**: On failure, `labelStatus` is set to `"error"` and an alert icon is shown. The snippet is still fully functional — the label is a nice-to-have, not a blocker.

**Fallback**: If using OpenRouter and no API key is configured, the endpoint returns `"AI labeling unavailable"` with status 200 (non-blocking). If using Ollama and it's not running, the endpoint returns `"Ollama not reachable"` with status 503.

### 2. Slash Command Generation (Flow)

**Purpose**: Generate contextual content at the cursor position based on surrounding text and user instruction.

**Trigger**: User types `/`, enters a prompt, and presses Enter.

**Process**:
1. Client extracts:
   - Content above cursor position
   - Content below cursor position
   - Note's goal field
   - User's typed instruction
2. Client sends `POST /api/generate` with these fields
3. Server constructs a prompt with all four context pieces
4. The configured model generates the content
5. Server returns `{ content: "..." }`
6. Client shows the generated text in a **preview panel** for user approval
7. On accept: client inserts the text at the cursor position in the editor
8. On discard: preview is dismissed, user returns to the prompt input
9. On redo: client re-runs the same request to generate a new result

**Error handling**: On failure, show a brief inline error message at the cursor position that auto-dismisses after 3 seconds. The slash command input reappears so the user can retry.

### 3. Inline Editing (Refine)

**Purpose**: Context-aware editing of selected text. The user highlights text, chooses an editing action (concise, elaborate, or custom), and AI rewrites the selection while respecting the surrounding document context. This is the flagship differentiator — all edits are aware of the full document.

**Trigger**: Selecting text in the editor. A floating toolbar (bubble menu) appears above the selection with four actions:

1. **Snip** — Add the selection as a snippet to the Snip Bar (same as the old Snip button, now accessible from the bubble menu)
2. **Concise** — AI rewrites the selection to be tighter, removing redundancy while preserving meaning
3. **Elaborate** — AI expands the selection with more detail, examples, or nuance
4. **Edit** — Opens a custom text input where the user types any instruction (e.g., "make this funnier", "rewrite as a question", "add a statistic")

**Process**:
1. Client extracts:
   - Selected text
   - Content before the selection
   - Content after the selection
   - Note's goal, audience, tone, and remember fields
   - The editing instruction (preset or custom)
2. Client sends `POST /api/edit` with these fields
3. Server constructs a prompt with all context pieces
4. The configured model generates the edited text
5. Server returns `{ content: "..." }`
6. Client replaces the selected text with the AI result

**Error handling**: On failure, the selection is preserved (no text is replaced). The bubble menu returns to idle state.

**UI states**:
- **Idle**: Shows Snip | Concise | Elaborate | Edit buttons
- **Loading**: Shows spinner with "Editing…" text
- **Custom input**: Text input field with submit arrow, Escape to cancel

**Endpoint**: `POST /api/edit`

**Model**: Configurable per-process. Default: `google/gemini-2.0-flash-001` via OpenRouter.

---

## Settings

A settings panel accessible via a gear icon in the sidebar header (bottom-left of sidebar). Opens as a modal overlay centered on screen.

### Settings Data Model

```typescript
type AIProvider = "openrouter" | "ollama";

interface AppSettings {
  openRouterApiKey: string;    // Obfuscated in UI display. Only needed for OpenRouter provider.
  snippetLabeling: {
    enabled: boolean;          // Toggle AI labeling on/off
    provider: AIProvider;      // "openrouter" (cloud) or "ollama" (local). Default: "openrouter"
    model: string;             // Default: "google/gemini-2.0-flash-001" (OpenRouter format)
    maxEssayContext: number;   // Max chars of essay sent as context. Default: 4000
    promptTemplate: string;    // The system prompt used for labeling. Editable.
  };
  slashCommand: {
    enabled: boolean;          // Toggle slash command generation on/off (Flow)
    provider: AIProvider;      // "openrouter" (cloud) or "ollama" (local). Default: "openrouter"
    model: string;             // Default: "google/gemini-2.0-flash-001" (OpenRouter format)
    maxContextAbove: number;   // Max chars of content above cursor. Default: 3000
    maxContextBelow: number;   // Max chars of content below cursor. Default: 3000
    promptTemplate: string;    // The system prompt used for generation. Editable.
  };
  inlineEdit: {
    enabled: boolean;          // Toggle inline editing on/off (Refine)
    provider: AIProvider;      // "openrouter" (cloud) or "ollama" (local). Default: "openrouter"
    model: string;             // Default: "google/gemini-2.0-flash-001" (OpenRouter format)
    maxContextChars: number;   // Max chars of context before/after selection. Default: 3000
    promptTemplate: string;    // The system prompt used for editing. Editable.
  };
}
```

Persisted in IndexedDB via a `settings` table in Dexie (single row, key `"default"`).

### Settings UI

The modal has three sections, each as a collapsible card:

#### 1. API Configuration
- **OpenRouter API Key**: Password-style input field (dots by default, eye icon to reveal). Placeholder: "Enter your OpenRouter API key". Saved to IndexedDB (not `.env.local` — this lets the user configure it from the UI without touching code). The server-side route checks for the key in this order: (1) key sent in request body from client settings, (2) `process.env.OPENROUTER_API_KEY` from `.env.local`. Only required when using OpenRouter as provider — not needed for local Ollama models.
- **Status indicator**: Small dot next to the key field — green if key is set, gray if not.

#### 2. Snippet Labeling Settings
These control the AI process that labels snippets in the Snip Bar.

- **Enabled toggle**: On/off switch. When off, new snippets are created with `labelStatus: "idle"` and no AI request fires. Label shows "—" instead.
- **Provider toggle**: Segmented control — "OpenRouter" (cloud icon) or "Local" (hard drive icon). Determines whether labeling uses a cloud model via OpenRouter or a locally running model via Ollama.
- **Model selector**: Searchable dropdown. Dynamically fetches available models from the selected provider. OpenRouter models are grouped by provider (Google, Anthropic, OpenAI, etc.). Ollama models show installed local models.
- **Essay context limit**: Number input. How many characters of the full essay to include as context when labeling. Default 4000. Range: 0–10000. Setting to 0 means the AI only sees the snippet text and the goal, not the surrounding essay.
- **Prompt template**: Multi-line text area showing the system prompt. Pre-filled with the default labeling prompt. The user can edit this to change how labels are generated. Template variables available:
  - `{goal}` — the note's goal field
  - `{essayContent}` — the essay text (truncated to the context limit)
  - `{snippetContent}` — the snippet being labeled
- **Reset to default**: Button to restore the original prompt template.

#### 3. Slash Command Generation Settings (Flow)
These control the AI process behind the `/` command.

- **Enabled toggle**: On/off switch. When off, typing `/` at line start does nothing (behaves as normal text).
- **Provider toggle**: Same as snippet labeling — independently configurable. You can use OpenRouter for generation and Ollama for labeling, or vice versa.
- **Model selector**: Same as snippet labeling — fetches from the selected provider.
- **Context above limit**: Number input. Max characters of document content above the cursor to send as context. Default 3000.
- **Context below limit**: Number input. Max characters of document content below the cursor to send as context. Default 3000.
- **Prompt template**: Multi-line text area. Pre-filled with the default generation prompt. Template variables:
  - `{goal}` — the note's goal field
  - `{contextAbove}` — text above cursor (truncated to limit)
  - `{contextBelow}` — text below cursor (truncated to limit)
  - `{userInstruction}` — what the user typed after `/`
- **Reset to default**: Button to restore the original prompt template.

#### 4. Inline Edit Settings (Refine)
These control the AI process behind the floating edit toolbar that appears on text selection.

- **Enabled toggle**: On/off switch. When off, selecting text does not show the Refine bubble menu.
- **Provider toggle**: Independently configurable.
- **Model selector**: Fetches from the selected provider.
- **Context around selection**: Number input. Max characters of document content before and after the selection to send as context. Default 3000.
- **Prompt template**: Multi-line text area. Pre-filled with the default inline edit prompt. Template variables:
  - `{selectedText}` — the highlighted text
  - `{contextBefore}` — text before the selection (truncated to limit)
  - `{contextAfter}` — text after the selection (truncated to limit)
  - `{instruction}` — the editing instruction (concise, elaborate, or custom)
  - `{goal}`, `{audience}`, `{tone}`, `{remember}` — note metadata
- **Reset to default**: Button to restore the original prompt template.

### Settings Persistence

Settings are stored in IndexedDB alongside notes and snippets. On app mount, settings are loaded into a Zustand slice (`settings-store`). Changes in the settings modal are applied immediately (no "Save" button — each field auto-saves on change with a brief "Saved" indicator).

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+H` | Toggle the Snip Bar (right panel) |
| `Cmd+F` | Local search — find within current note |
| `Cmd+Shift+F` | Global search — find across all notes |
| `/` (at line start) | Open slash command AI generation prompt |
| `Escape` | Close search overlay, dismiss slash command, deselect |

**Not mapped**: `Cmd+N` is intentionally NOT a shortcut. Note creation is a sidebar action, not a keyboard shortcut.

Standard editor shortcuts are handled by Tiptap:
- `Cmd+B` — bold
- `Cmd+I` — italic
- `Cmd+Z` — undo
- `Cmd+Shift+Z` — redo
- `Cmd+K` — link (if Link extension supports it)

---

## Persistence

### Storage Engine

IndexedDB via Dexie. Three tables:

**`notes`**: Primary key `id`, indexed on `updatedAt` (for sorted queries).

**`snippets`**: Primary key `id`, indexed on `noteId` (for filtering by note) and `order` (for sorting within a note).

**`settings`**: Primary key `id` (always `"default"`). Single row storing all app settings including API key, AI model preferences, prompt templates, and feature toggles.

### Write Strategy

The in-memory state (Zustand) is the source of truth for the UI. Dexie is the persistence layer. Writes flow one way: Zustand → Dexie.

- **Content edits**: Debounced 500ms. The user sees instant updates; IndexedDB catches up.
- **Title/goal edits**: Debounced 300ms.
- **Structural changes** (create note, delete note, create snippet, delete snippet, reorder snippet): Written to IndexedDB immediately.

### Save Guards

To prevent data loss:
- **`beforeunload`**: Flushes the current note to IndexedDB synchronously when the browser tab is closing.
- **`visibilitychange`**: Flushes when the user switches to another tab (`document.visibilityState === "hidden"`).
- **Note switch**: When the user clicks a different note in the sidebar, the current note's content is flushed before loading the new note.

### Hydration

On app mount:
1. Load all notes from IndexedDB, sorted by `updatedAt` descending
2. Set the most recent note as active
3. Load that note's snippets
4. Mark the app as hydrated (shows the UI instead of the loading screen)

When the active note changes, the snippets for the new note are loaded from IndexedDB.

---

## How to Use Fragment

### Getting Started
1. Open the app
2. Click "New note" in the sidebar
3. Optionally set a goal in the "GOAL" field (e.g., "Argue that remote work improves productivity")
4. Start writing in the editor using markdown

### Writing with Live Markdown
Just type. Markdown syntax is rendered in real-time:
- `## My Section` becomes a styled heading as you type
- `**important**` becomes **important**
- `> a thought` becomes a styled blockquote
- Everything else works: lists, code, links, horizontal rules

### Breaking Apart Your Writing
When you have a paragraph or sentence that feels out of place:
1. Select the text
2. Click the "Snip" button in the floating toolbar (or drag it to the Snip Bar)
3. The text stays in your essay AND appears as a snippet card in the Snip Bar
4. AI automatically labels it so you can remember what it is

### Rearranging Ideas
- Drag snippet cards up and down in the Snip Bar to organize your thought order
- Drag a snippet from the Snip Bar back into the editor — a gold line shows exactly where it'll go
- Hover over a snippet to see its full content in a popup
- Delete snippets you don't need anymore with the X button

### Using AI Generation
1. Press Enter to start a new line
2. Type `/` at the beginning of the line
3. An input field appears — type what you want (e.g., "write a counterargument to the point above")
4. Press Enter
5. AI generates content that fits between what's above and below, matching your writing style

### Managing Multiple Notes
- Click any note in the sidebar to switch to it
- Each note has its own set of snippets
- Use `Cmd+F` to search within the current note
- Use `Cmd+Shift+F` to search across all notes
- `Cmd+H` toggles the Snip Bar

---

## Technical Implementation

### Stack
- Next.js 16 (App Router)
- React 19
- TypeScript (strict)
- Tailwind CSS 4 (CSS-first config)
- Tiptap 3 + tiptap-markdown
- Zustand v5
- Dexie (IndexedDB)
- OpenRouter (cloud AI, any model) + Ollama (local AI)
- lucide-react

### File Structure

```
src/
├── app/
│   ├── layout.tsx                 # Root: fonts (DM Serif Display, Outfit, JetBrains Mono), metadata
│   ├── page.tsx                   # Renders <AppShell />
│   ├── globals.css                # Design tokens, editor styles, animations
│   └── api/
│       ├── label/route.ts         # POST: Snip — snippet labeling
│       ├── generate/route.ts      # POST: Flow — slash command generation
│       ├── edit/route.ts          # POST: Refine — inline editing of selected text
│       └── models/route.ts        # GET: Fetch available models from OpenRouter or Ollama
├── components/
│   ├── app-shell.tsx              # Three-panel layout container
│   ├── sidebar/
│   │   └── sidebar.tsx            # Note list, new note, search, delete
│   ├── editor/
│   │   ├── editor.tsx             # Tiptap wrapper, toolbar, goal input, Flow + Refine integration
│   │   ├── inline-edit-menu.tsx   # Refine: floating bubble menu on text selection
│   │   └── extensions/
│   │       ├── snippet-drop.ts    # ProseMirror plugin: handle drops from Snip Bar
│   │       └── slash-command.ts   # Tiptap extension: / trigger, inline input, AI generation (Flow)
│   ├── helper-bar/
│   │   ├── helper-bar.tsx         # Snip Bar: drop zone, snippet list, reorder logic
│   │   └── snippet-card.tsx       # Draggable card with AI label, preview, hover popup
│   ├── search/
│   │   └── global-search.tsx      # Cmd+Shift+F overlay: search all notes
│   └── settings/
│       ├── settings-modal.tsx     # Settings overlay with collapsible sections
│       ├── api-settings.tsx       # OpenRouter API key input with status indicator
│       ├── provider-toggle.tsx    # OpenRouter / Local segmented control
│       ├── model-selector.tsx     # Dynamic model picker (fetches from OpenRouter or Ollama, grouped by provider)
│       ├── labeling-settings.tsx  # Snip: snippet labeling provider, toggle, model, prompt
│       ├── generation-settings.tsx # Flow: slash command provider, toggle, model, context, prompt
│       └── inline-edit-settings.tsx # Refine: inline edit provider, toggle, model, context, prompt
├── stores/
│   ├── app-store.ts               # UI state (sidebar, Snip Bar, modals, drag flags)
│   ├── data-store.ts              # Data state: notes + snippets CRUD
│   └── settings-store.ts          # Settings state: AI config, API key, prompt templates
├── hooks/
│   ├── use-persistence.ts         # IndexedDB hydration + save guards
│   ├── use-label-snippet.ts       # Snip: AI labeling async logic
│   ├── use-slash-command.ts       # Flow: extract context, call /api/generate, insert
│   └── use-inline-edit.ts         # Refine: context-aware editing of selected text
└── lib/
    ├── types.ts                   # Note, Snippet, AppSettings interfaces
    ├── db.ts                      # Dexie schema (notes, snippets, settings tables)
    ├── persistence.ts             # Dexie CRUD operations
    ├── defaults.ts                # Default prompt templates for Snip, Flow, and Refine
    └── utils.ts                   # nanoid, debounce, truncate, formatDate
```

### Drag-and-Drop MIME Types

The app uses custom MIME types in `dataTransfer` to distinguish drag sources:

| MIME Type | Set By | Read By | Payload |
|-----------|--------|---------|---------|
| `application/x-fragment-snippet` | Editor (on dragstart of selection) | Snip Bar (on drop) | `{ content: string }` |
| `application/x-fragment-insert` | Snippet card (on dragstart) | Editor (on handleDrop) | `{ content: string, id: string }` |
| `application/x-fragment-reorder` | Snippet card (on dragstart within Snip Bar) | Snip Bar (on drop between cards) | `{ id: string, currentOrder: number }` |
| `text/plain` | Always set as fallback | External apps | Raw text content |

### Design System

Visual identity extracted from PromptPipe. Warm dark palette with gold accent. Subtle SVG fractal noise grain overlay at 0.3 opacity. All tokens defined in `src/app/globals.css` via `@theme inline`.

#### Colors
| Token | Value | Usage |
|-------|-------|-------|
| `bg` | `#111110` | Primary background |
| `bg-warm` | `#16150f` | Warm background variant |
| `surface` | `#1a1914` | Sidebar/Snip Bar background |
| `surface-2` | `#201f18` | Cards, hover states, inputs |
| `surface-3` | `#28271e` | Nested elements, hover popups |
| `surface-hover` | `#2f2e24` | Active hover state |
| `gold` | `#f0c446` | Primary accent, CTA, caret, active borders |
| `gold-hover` | `#f5d06a` | Gold hover state |
| `gold-muted` | `rgba(240, 196, 70, 0.15)` | Selection highlight, drop zone bg |
| `gold-strong` | `rgba(240, 196, 70, 0.25)` | Strong gold emphasis |
| `text-primary` | `#e8e4d9` | Body text |
| `text-secondary` | `#a8a48e` | Labels, secondary text |
| `text-muted` | `#6b6753` | Metadata, timestamps |
| `text-faint` | `#4a4737` | Placeholders, lowest emphasis |
| `border` | `rgba(255, 245, 200, 0.06)` | Default borders |
| `border-strong` | `rgba(255, 245, 200, 0.12)` | Input borders, cards |
| `border-active` | `rgba(255, 200, 87, 0.25)` | Selected/active states |
| `red` | `#c9605a` | Destructive actions |
| `blue` | `#6b9fd4` | Info states |
| `green` | `#7cb87a` | Success states |

#### Typography
| Font | Stack | Usage |
|------|-------|-------|
| Display | DM Serif Display, Georgia, serif | Headings (h1, h2, h3), app logo |
| Body | Outfit, -apple-system, sans-serif | All body text, buttons, labels |
| Mono | JetBrains Mono, SF Mono, monospace | Timestamps, snippet labels, goal label, loading states |

#### Spacing & Radius
- Small radius: `4px` (`--radius-sm`)
- Default radius: `8px` (`--radius-default`)
- Large radius: `12px` (`--radius-lg`)
- Header height: `52px`
- Sidebar width: `260px`
- Snip Bar width: `320px`
- Editor padding: `0 4rem 40vh 4rem`

#### Animations
- Panel collapse: `200ms ease-out` on width + opacity
- Snippet card entrance: `slideIn 0.2s ease-out`
- Hover popup: `fadeIn 0.12s ease-out`
- All interactive transitions: `150ms`

#### Visual Details
- SVG fractal noise grain overlay at 0.3 opacity (body::before pseudo-element)
- Gold caret in editor
- Gold drop cursor for ProseMirror drag operations
- Gold selection highlight (gold-muted background)
- Custom scrollbar: 6px wide, surface-hover thumb, transparent track

### Environment Variables

```
OPENROUTER_API_KEY=  # Optional. Fallback for OpenRouter cloud models if not set in Settings UI.
                     # Not needed for local Ollama models. The app is fully functional without it.
```

## Content Engine: Data Model & Two-Space IA

Alongside the long-form note (Sidebar / Editor / Snip Bar, described above), Fragment ships a second, parallel writing surface for short-form content — LinkedIn posts, tweet threads, Substack drafts — public-facing name **Press**, plus a lightweight review-sharing feature, public-facing name **Pass**. This section covers the architecture only; the wire-level contract (frontmatter fields, MCP tool shapes, security gating) is documented in full in [`docs/AGENT-API.md`](./docs/AGENT-API.md), and QA steps live in [`docs/FEATURES.md`](./docs/FEATURES.md).

### Data Objects

**Idea** — a container for one line of thinking.
- `id`, `title`, `summary?`, `parentId: string | null`, `priority` (0 none / 1 urgent / 2 high / 3 medium / 4 low), `pinnedAt?`, `voiceId?`, `origin` (`agent` | `user`), `createdAt`, `updatedAt`, `deletedAt?`
- Nests **one level deep only**: a child idea's `parentId` must point at a root idea (a root idea itself always has `parentId: null`). Enforced at write time — a caller cannot chain a third level.

**ContentPiece** — one unit of content inside an idea. A piece can never exist without an idea.
- `id`, `ideaId`, `format` (`linkedin` | `tweet` | `substack` | `essay` | `script` | `other`), `status` (`inbox → in-progress → ready → published`), `origin`, `title?`, exactly one content home (`noteId` for long-form pieces that get a full Fragment note, or `body` for short-form pieces that hold markdown inline — never both, never neither), `seen: boolean`, `priority`, `order`, `scheduledAt?`, `publish?` (a `PublishRecord`: platform, method, publishedAt, url?, verified), `publishAttemptedAt?` (set while a Substack publish is awaiting RSS confirmation), `agentMeta?` (agent, model, pushedAt, supersedes — set only for agent-origin pieces), `createdAt`, `updatedAt`, `deletedAt?`.
- `script`-format pieces are never published from Fragment (video scripts, talk notes used elsewhere) — the Share menu doesn't apply to them.
- Agent-pushed pieces always land with `status: inbox`, `seen: false`, regardless of what the pushing agent requested — reviewing them is always a deliberate first read inside Fragment.

**Resource** — a link, note, or asset attached to an idea or a piece (`ownerType`: `idea` | `piece`).
- `id`, `ownerType`, `ownerId`, `kind` (`link` | `note` | `asset`), `url?`, `title`, `note?`, `createdAt`.
- Resources are **never copied on inheritance**: an idea's resources are visible to its child ideas and to every piece under both, composed at read time, not duplicated into child records. A piece's own resources are its alone.

### Two-Space IA: Write | Pieces

Every idea presents two spaces, toggled with a segmented **Write | Pieces** control (`⌘1` / `⌘2`):

- **Write** — the existing long-form editor (Sidebar / Editor / Snip Bar), unchanged by any of this.
- **Pieces** — a free-scroll, filterable feed of that idea's `ContentPiece` rows: filter chips (All / Inbox / In-progress / Ready), a sort control, and a roving-focus keyboard model for triage (rove, open, cycle status/priority, copy, delete, filter-jump — see `docs/FEATURES.md` for the exact keys).

Viewing a **parent** idea's Pieces space rolls up its direct children's pieces into the same feed (one level, matching the depth-2 cap) — a child's run of pieces is visually grouped under its own idea title. This is the only place merging happens; the sidebar's per-idea piece counts stay unmerged, one row per idea.

### Agent Inbox (Press)

Any MCP-capable agent — or a hand-written file — can drop a draft piece into `~/.fragment/inbox` (override: `FRAGMENT_INBOX_DIR`). The running Fragment app picks it up either by reading the filesystem directly (Tauri desktop) or by polling a pair of gated local-ingress HTTP routes (browser / self-hosted server), and folds it into the same store the UI reads. There is currently no HTTP endpoint that accepts a piece body directly — every path into Fragment goes through that filesystem inbox, file-based today, with an explicit stub seam (`fragment-mcp`'s `HttpTransport`) reserved for a future hosted push API. Full detail — the exact frontmatter contract, MCP tool shapes, eventual-consistency guarantees, and the three gating env vars — is in `docs/AGENT-API.md`.

### Review Sharing (Pass)

A note can be sent out for feedback without either party needing an account: **Send for review** renders the note into one self-contained HTML file (inlined styles, inlined vanilla-JS review UI, no network calls) that a reviewer opens directly in a browser to highlight text and leave comments. **Send back** downloads their comments as a small JSON file; **Import review** in Fragment reads it back and anchors each comment to the matching text in the live document (best-effort — text-match based, degrades to a note-level comment if the document has since changed enough that the anchor can't be uniquely located).
