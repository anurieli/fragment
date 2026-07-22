# Fragment — Feature Guide & QA Reference

This document describes every feature in Fragment, how it works, how to test it, and what to look for during QA. Update this when features change.

### Core Feature Names

Fragment's three headline features have user-facing names used on the website and in user research:

| Feature | Name | Description |
|---------|------|-------------|
| Snippets + Snip Bar | **Snip** | Select text, snip it, drag it, rearrange ideas like puzzle pieces |
| Slash command generation | **Flow** | Type `/` to generate context-aware text inline without breaking your writing flow |
| Inline editing | **Refine** | Highlight text → Concise, Elaborate, or custom Edit, fully document-aware |

---

## Table of Contents

1. [Note Management](#1-note-management)
2. [Live Markdown Editor](#2-live-markdown-editor)
3. [Snippets — Creating from Editor (Snip)](#3-snippets--creating-from-editor-snip)
4. [Snippets — Dragging Back to Editor (Snip)](#4-snippets--dragging-back-to-editor-snip)
5. [Snippet Reordering (Snip)](#5-snippet-reordering-snip)
6. [Snippet Hover Preview (Snip)](#6-snippet-hover-preview-snip)
7. [AI Snippet Labeling (Snip)](#7-ai-snippet-labeling-snip)
8. [Slash Command AI Generation (Flow)](#8-slash-command-ai-generation-flow)
9. [Sidebar Search (Local Filter)](#9-sidebar-search-local-filter)
10. [Global Search](#10-global-search)
11. [Settings Panel](#11-settings-panel)
12. [Keyboard Shortcuts](#12-keyboard-shortcuts)
13. [Panel Toggling + Snip Bar Hover-Reveal](#13-panel-toggling)
14. [Data Persistence](#14-data-persistence)
15. [Document Export](#15-document-export)
16. [Document Timeline (Version Control)](#16-document-timeline-version-control)
17. [In-App Help](#17-in-app-help)
18. [Inline Editing (Refine)](#18-inline-editing-refine)

---

## 1. Note Management

### How it works
- Click "New note" in the sidebar to create a blank note
- Notes appear in the sidebar sorted by last modified (newest first)
- Each note has a title, goal, and markdown content
- Click a note to open it in the editor
- Hover over a note in the sidebar to reveal the trash icon — click to delete

### How to test
1. Click "New note" — a new entry should appear at the top of the sidebar
2. Type in the title field — the sidebar item should update its title in real-time
3. Type in the editor — the sidebar preview text should update
4. Create 3+ notes, switch between them — content should persist per note
5. Delete a note — it should disappear, and the next most recent note should become active
6. Delete the last note — the editor should show the empty state ("Select or create a note")

### QA checklist
- [ ] New note appears immediately at the top of the sidebar
- [ ] Title updates in sidebar as you type
- [ ] Content preview in sidebar strips markdown characters
- [ ] Timestamp shows relative time and updates
- [ ] Switching notes preserves content of both notes
- [ ] Deleting active note selects the next note
- [ ] Deleting all notes shows empty state
- [ ] Notes survive a page refresh (IndexedDB persistence)

---

## 2. Live Markdown Editor

### How it works
The editor uses Tiptap 3 with `tiptap-markdown` for live rendering. As you type markdown syntax, it renders immediately — no preview pane needed.

Supported markdown:
- `# Heading 1` / `## Heading 2` / `### Heading 3` — rendered in DM Serif Display font
- `**bold**` — rendered bold
- `*italic*` — rendered italic
- `` `inline code` `` — rendered with mono font and background
- `> blockquote` — rendered with gold left border
- `- item` or `1. item` — bullet/numbered lists
- `---` — horizontal rule
- `[text](url)` — rendered as gold link

### How to test
1. Type `## Hello` — should immediately render as a styled heading
2. Type `**bold text**` — should render bold (not show the asterisks)
3. Type `` `code` `` — should render with mono background
4. Type `> quote` — should render with gold left border
5. Type `- item 1` then Enter — should continue the list
6. Select text and check the gold selection highlight

### QA checklist
- [ ] `##` + space triggers heading (H2 in display font)
- [ ] Bold, italic, code render inline as you type
- [ ] Blockquote has gold left border
- [ ] Lists auto-continue on Enter
- [ ] Horizontal rule renders on `---`
- [ ] Links render as gold underlined text
- [ ] Gold caret visible
- [ ] Gold selection highlight on text select
- [ ] Placeholder text "Start writing..." shows when editor is empty
- [ ] Bottom padding provides breathing room (writing line not at screen bottom)

---

## 3. Snippets — Creating from Editor (Snip)

### How it works
Two methods:

**Method A — Snip button:**
1. Select text in the editor
2. A "Snip" button appears in the toolbar (scissors icon)
3. Click it — text is copied to the Snip Bar as a snippet
4. Original text stays in the editor

**Method B — Drag and drop:**
1. Select text in the editor
2. Drag the selection toward the right panel
3. Snip Bar shows gold drop feedback
4. Release — snippet is created at the drop position
5. Original text stays in the editor

### How to test
1. Write a paragraph, select a sentence, click "Snip" — snippet should appear in the Snip Bar
2. Verify the text is still in the editor (not removed)
3. Write more text, select it, drag toward the Snip Bar — gold background should appear
4. Drop it — snippet card should animate in
5. If the Snip Bar was closed, clicking "Snip" should open it automatically
6. Create multiple snippets — they should stack vertically

### QA checklist
- [ ] Snip button appears only when text is selected
- [ ] Snip button disappears when selection is cleared
- [ ] Snip button has fadeIn animation
- [ ] Clicking Snip creates a snippet card in the helper bar
- [ ] Text remains in editor after snipping (copy, not cut)
- [ ] Dragging selected text to helper bar shows gold drop feedback
- [ ] Dropping creates a snippet at the dropped position (not always at end)
- [ ] Snip Bar opens automatically if it was closed
- [ ] AI labeling fires immediately (loading spinner visible)

---

## 4. Snippets — Dragging Back to Editor (Snip)

### How it works
1. Grab a snippet card in the Snip Bar
2. Drag it over the editor
3. A gold drop cursor (line) appears in the editor showing the insertion point
4. Release — the snippet's text is inserted at that exact position
5. The snippet stays in the helper bar (reusable)

### How to test
1. Create a snippet
2. Drag it from the Snip Bar to the middle of some text in the editor
3. Verify the gold drop cursor appears
4. Drop it — text should insert at the cursor position, not at the end
5. Verify the snippet card still exists in the helper bar
6. Drag the same snippet again to a different position — should work again

### QA checklist
- [ ] Snippet card shows grab cursor on hover, grabbing on drag
- [ ] Gold drop cursor appears in editor during drag-over
- [ ] Text inserts at the exact drop position
- [ ] Snippet remains in the Snip Bar after dropping
- [ ] Can reuse the same snippet multiple times
- [ ] Dropping does not disrupt existing editor content

---

## 5. Snippet Reordering (Snip)

### How it works
Snippets can be dragged to reorder within the Snip Bar:
1. Grab a snippet card
2. Drag it vertically within the Snip Bar
3. A gold insertion line appears between other cards showing where it will land
4. Release to reorder

### How to test
1. Create 3+ snippets
2. Drag the third snippet above the first — gold line should appear between cards
3. Drop it — order should update, the dragged snippet now appears at the top
4. Refresh the page — new order should persist

### QA checklist
- [ ] Gold insertion line appears between cards during drag
- [ ] Dragged card becomes semi-transparent (opacity feedback)
- [ ] Dropping reorders the list
- [ ] Order persists after page refresh
- [ ] Can reorder with only 2 snippets
- [ ] Reordering does not accidentally create a duplicate

---

## 6. Snippet Hover Preview (Snip)

### How it works
For snippets with long content (>5 lines or >200 characters):
- Hover over the card for 400ms
- A popup appears to the LEFT of the card showing the full text
- The popup can be scrolled if the content is very long
- Mouse can move into the popup without it disappearing
- Leave both the card and popup to dismiss

### How to test
1. Create a snippet with 10+ lines of text
2. Hover over it for ~half a second — popup should appear to the left
3. Move mouse into the popup — it should stay open
4. Scroll within the popup if content overflows
5. Move mouse away from both — popup should close
6. Create a short snippet (1 line) — hovering should NOT show a popup

### QA checklist
- [ ] Popup only appears for long snippets (>5 lines or >200 chars)
- [ ] 400ms delay before showing
- [ ] Popup positioned to the left of the card
- [ ] Popup is scrollable
- [ ] Popup stays open when mouse enters it
- [ ] Popup closes when mouse leaves both card and popup
- [ ] Popup does not appear during drag operations
- [ ] fadeIn animation on popup appearance

---

## 7. AI Snippet Labeling (Snip)

### How it works
When a snippet is created, an async AI request fires to generate a 5-10 word label:
- The label appears at the top of the snippet card in gold mono text
- While loading: spinner + "Labeling..."
- On error: alert icon + "Label failed"
- If labeling is disabled in settings: shows "—"

The AI receives: the snippet text + the full essay content (up to a configurable limit) + the note's goal field.

### How to test
1. Set your Gemini API key (in Settings or `.env.local`)
2. Write some text, set a goal, create a snippet
3. Watch the loading spinner appear, then the label
4. Create a snippet without an API key — should show "AI labeling unavailable"
5. In Settings, toggle snippet labeling off — create a snippet — should show "—"
6. In Settings, change the model or prompt template — create a new snippet — should use new config

### QA checklist
- [ ] Loading spinner appears immediately on snippet creation
- [ ] Label appears after AI responds (typically 1-2 seconds)
- [ ] Label is gold mono text, truncated if too long
- [ ] Error state shows alert icon
- [ ] No API key shows fallback text (not a crash)
- [ ] Disabling labeling in settings shows "—" for new snippets
- [ ] Changing the prompt template affects new labels
- [ ] Essay context and goal are sent to the AI

---

## 8. Slash Command AI Generation (Flow)

### How it works
1. On an empty line, type `/`
2. An inline input field appears with a gold border
3. Type your instruction (e.g., "write a transition paragraph")
4. Press Enter to generate — loading spinner appears
5. A **preview panel** appears showing the generated content before it's inserted
6. Review and choose: **Insert** (`Enter`), **Discard** (`Esc`), or **Redo** (`⌘R`)
7. On Insert, the text is placed at the cursor position as editable content
8. On Discard, the preview closes and the prompt input reappears
9. On Redo, the AI regenerates with the same prompt
10. Press Escape at any point to cancel entirely

The AI receives: content above the cursor, content below the cursor, the note's goal, and your instruction.

### How to test
1. Set your API key in Settings
2. Write a paragraph, press Enter to start a new line
3. Type `/` — the inline input should appear
4. Type "add a concluding sentence" and press Enter
5. Verify the loading state appears
6. Verify a **preview panel** appears with the generated content
7. Verify the preview shows your prompt, the generated text, and action buttons (Insert, Discard, Redo)
8. Press Enter — verify text inserts at the correct position
9. Repeat and press Escape in the preview — verify it returns to the prompt input
10. Repeat and press `⌘R` — verify it regenerates with the same prompt
11. Type `/` then press Escape before submitting — input should dismiss, no generation
12. In Settings, disable slash commands — `/` should type normally

### QA checklist
- [ ] `/` at line start triggers the slash command input
- [ ] `/` in the middle of text does NOT trigger (types normally)
- [ ] Input field has gold border and fadeIn animation
- [ ] Pressing Enter fires the generation
- [ ] Loading spinner replaces the `/` icon during generation
- [ ] Preview panel appears after generation with generated text
- [ ] Preview shows the original prompt in the header
- [ ] Preview body is scrollable with a max height of 240px
- [ ] Preview footer shows keyboard shortcut hints (↵, esc, ⌘R)
- [ ] Insert button / Enter inserts text at the correct document position
- [ ] Inserted text is editable like normal text
- [ ] Discard button / Escape dismisses preview and returns to prompt input
- [ ] Redo button / ⌘R regenerates with the same prompt
- [ ] Escape from the prompt input (before generating) cancels and refocuses the editor
- [ ] Preview is dismissed when switching notes
- [ ] Error state shows "Failed — try again" with red styling
- [ ] Disabling in settings makes `/` type as normal text
- [ ] Context above and below are correctly extracted

---

## 9. Sidebar Search (Local Filter)

### How it works
A search input in the sidebar filters the note list as you type. Matches against both title and content.

### How to test
1. Create 5+ notes with different titles and content
2. Type in the filter input — list should narrow to matching notes
3. Clear the input — all notes should reappear
4. Search for a word that's only in the content (not the title) — should still match
5. Search for something with no matches — "No matches" empty state should show

### QA checklist
- [ ] Filter updates instantly as you type
- [ ] Matches on title
- [ ] Matches on content
- [ ] Case insensitive
- [ ] Clearing input restores full list
- [ ] "No matches" shows when nothing matches
- [ ] Active note stays highlighted even when filtered

---

## 10. Global Search

### How it works
`Cmd+Shift+F` opens a centered overlay that searches across ALL notes:
- Type to search — results update as you type
- Each result shows the note title, a content snippet with context, and the timestamp
- Click a result to open that note and close the overlay
- Escape closes the overlay

### How to test
1. Create 5+ notes with different content
2. Press `Cmd+Shift+F` — overlay should appear with autofocused input
3. Type a word — matching notes should appear as results
4. Click a result — the note should open in the editor and the overlay should close
5. Press Escape — overlay should close without changing the active note
6. Click outside the overlay — should close

### QA checklist
- [ ] `Cmd+Shift+F` opens the overlay
- [ ] Input is autofocused
- [ ] Results update as you type
- [ ] Results show title, content snippet, and timestamp
- [ ] Clicking a result opens the note and closes overlay
- [ ] Escape closes the overlay
- [ ] Clicking outside closes the overlay
- [ ] "No notes match" shows for zero results
- [ ] Results are sorted by most recently modified

---

## 11. Settings Panel

### How it works
Click the gear icon at the bottom of the sidebar to open settings. Settings takes over the entire three-panel layout:

- **Left panel**: Settings navigation (replaces sidebar) — Writing Style, Photo Generation, AI
- **Center panel**: Active settings section content (replaces editor)
- **Right panel**: User Profile (replaces Snip Bar) — always visible when settings is open

Press Escape or click the back arrow to return to the editor.

**User Profile (right panel):**
- Avatar with initials (auto-generated from display name)
- Display name, bio, website, Twitter/X, LinkedIn, location
- All fields auto-save on change

**Writing Style (center, via nav):**
- Voice description textarea — describe your writing tone/style for AI personalization
- Writing sample uploads placeholder (coming soon)

**Photo Generation (center, via nav):**
- Style presets — 6 built-in (Editorial, Photorealistic, Sketch, Diagram, Minimalist, Watercolor) + custom presets
- Theme description textarea — natural language style directive prepended to image prompts
- "Create your own" — form to add custom style presets (name + description)
- Reference images placeholder (coming soon)

**AI (center, via nav):**
Has its own sub-navigation (Providers, Labeling, Commands, Inline Edit). All four sub-sections visible and scrollable, no collapsibles.

- *AI Providers*: OpenRouter API key, Codex OAuth, Ollama local. Per-feature provider and model selection.
- *Snippet Labeling* (Snip): Enable/disable, provider toggle, model selector, prompt template.
- *Slash Commands* (Flow): Enable/disable, provider toggle, model selector, context above/below limits, prompt template.
- *Inline Edit* (Refine): Enable/disable, provider toggle, model selector, context around selection limit, prompt template.

All settings auto-save on change (no save button). Stored in IndexedDB.

### How to test
1. Click the gear icon in the sidebar — all three panels should transform to settings
2. Left panel should show settings nav, right panel should show user profile
3. Fill in user profile fields — should persist on page refresh
4. Click "Writing Style" — center panel should show voice description
5. Click "Photo Generation" — center panel should show presets, theme, create-your-own
6. Select a style preset — should highlight with gold border
7. Create a custom preset — should appear in the grid and be selectable
8. Delete a custom preset — should remove and fall back to "editorial"
9. Click "AI" — center panel should show API/Labeling/Commands with sub-nav
10. Sub-nav items should scroll to their section when clicked
11. Toggle snippet labeling off, create a snippet — should show "—"
12. Toggle back on, change model, create a snippet — should use new model
13. Toggle slash command off, type `/` — should type normally
14. Press Escape — should return to editor view
15. Reopen settings — values should persist across page refresh

### QA checklist
- [ ] Gear icon opens full-page settings (takes over all three panels)
- [ ] Escape or back arrow returns to editor
- [ ] User profile visible on right panel with avatar initials
- [ ] All profile fields save and persist
- [ ] Settings nav highlights active section with gold accent
- [ ] Writing style voice description is editable and persists
- [ ] Photo generation: 6 built-in presets + custom presets render correctly
- [ ] Custom preset creation, selection, and deletion works
- [ ] Theme description textarea is editable and persists
- [ ] AI sub-nav scrolls to correct section
- [ ] API key field toggles between password and text
- [ ] Green/gray status dot reflects key state
- [ ] Toggle switches work visually and functionally
- [ ] Model dropdown shows options
- [ ] Prompt template textarea is editable and resizable
- [ ] Reset button restores default prompt
- [ ] All settings persist across page refresh
- [ ] Settings are applied immediately (no save button)

---

## 12. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+H` | Toggle Snip Bar |
| `Cmd+T` | Toggle document timeline |
| `Cmd+S` | Save manual snapshot (version checkpoint) |
| `Cmd+\` | Toggle sidebar |
| `Cmd+Shift+F` | Open global search |
| `Cmd+/` | Open help panel |
| `Cmd+F` | Browser find in page (native) |
| `/` (empty line) | Slash command AI prompt |
| `Escape` | Close overlays / exit version preview / dismiss slash command |
| `Cmd+B` | Bold (Tiptap) |
| `Cmd+I` | Italic (Tiptap) |
| `Cmd+Z` | Undo (Tiptap) |
| `Cmd+Shift+Z` | Redo (Tiptap) |

### How to test
1. Press `Cmd+H` — Snip Bar should toggle
2. Press `Cmd+\` — sidebar should toggle
3. Press `Cmd+Shift+F` — global search should open
4. With global search open, press Escape — should close
5. With settings open, press Escape — should close
6. On an empty line, type `/` — slash command should trigger
7. In slash command input, press Escape — should cancel

### QA checklist
- [ ] All shortcuts work on first press
- [ ] Shortcuts don't conflict with browser defaults (Cmd+F is native)
- [ ] Cmd+H doesn't trigger browser history (preventDefault works)
- [ ] Escape correctly prioritizes: settings > global search > slash command
- [ ] Shortcuts work regardless of which panel is focused
- [ ] `Cmd+T` toggles the timeline panel
- [ ] `Cmd+S` saves a snapshot (toast confirms)
- [ ] `Cmd+/` opens the help panel
- [ ] `Escape` exits version preview mode

---

## 13. Panel Toggling + Snip Bar Hover-Reveal

### How it works

**Sidebar (left panel)**
- Collapse via the PanelLeftClose icon in the sidebar header, or `Cmd+\`
- Reopen via the PanelLeftOpen icon in the editor toolbar, or `Cmd+\`
- Open/closed state persists across page refreshes and app restarts (saved to localStorage)

**Snip Bar (right panel) — hover-reveal system**
The Snip Bar uses a hover-driven open/close in both full-screen and compact window sizes:
- A small pull-tab (puzzle icon) sits at the right screen edge whenever the panel is closed
- **Hover to open:** moving the mouse over the pull-tab opens the panel immediately
- **Auto-collapse:** moving the mouse out of the panel starts a 300 ms debounce timer; the panel collapses when the timer fires
- Moving the mouse back into the panel (or the tab) before the timer fires cancels the close
- Panel can also be toggled with `Cmd+H`, the PanelRightClose button inside the panel, or the PanelRightOpen button in the editor toolbar

**Compact window mode (< 960 px wide)**
- The snippets panel renders as a floating overlay that slides in from the right, so it never squeezes the editor
- The sidebar (left) stays open independently — it is not affected by the snippets panel state
- Snippets panel additionally closes on click-outside and on `Escape`
- When dragging selected text from the editor, the snippets overlay auto-reveals as a drop target; it collapses again once the drag ends (if not manually opened)

**Drag auto-reveal (full-screen)**
- In full-screen mode, starting a drag from the editor also temporarily reveals the snippets panel (width animates to 340 px) as a drop target, even if it was closed

### How to test
1. Close the snippets panel (`Cmd+H` or the X button inside it)
2. Hover over the pull-tab at the right screen edge — panel should slide open
3. Move the mouse out of the panel — panel should collapse after ~300 ms
4. Move the mouse back in before 300 ms — collapse should cancel
5. Use `Cmd+H` — helper bar should toggle
6. Use `Cmd+\` — sidebar should toggle
7. Close sidebar, reload — sidebar should remain closed (persistence)
8. Narrow the window below 960 px — snippets panel should become an overlay
9. In compact mode, hover pull-tab to open overlay, click outside — should close
10. In compact mode, drag selected text from editor — snippets overlay should auto-appear

### QA checklist
- [ ] Pull-tab visible at right edge when snippets panel is closed
- [ ] Pull-tab hides (slides right, opacity 0) when panel opens
- [ ] Hover-open works in full-screen and compact modes
- [ ] 300 ms debounce: fast mouse transit across panel edge does not close it
- [ ] Cmd+H still toggles the panel
- [ ] Sidebar open/closed state survives page refresh
- [ ] Compact overlay does not squeeze the editor
- [ ] Compact: click outside closes the overlay
- [ ] Compact: Escape closes the overlay
- [ ] Drag from editor reveals panel as drop target in both modes
- [ ] No layout jump or flash during any animation

---

## 14. Data Persistence

### How it works
All data is stored in IndexedDB via Dexie:
- **Notes** (id, title, content, goal, timestamps)
- **Snippets** (id, noteId, content, label, order)
- **Settings** (API key, AI config, prompt templates)

Content saves are debounced (500ms). Structural changes (create, delete, reorder) save immediately. Additional save guards fire on `beforeunload` and `visibilitychange`.

### How to test
1. Create a note, type content, refresh the page — content should be there
2. Create snippets, refresh — snippets should be there with their labels
3. Change settings, refresh — settings should persist
4. Reorder snippets, refresh — order should persist
5. Switch to another browser tab and back — no data loss
6. Close the tab entirely, reopen — all data should be intact
7. Create a note in one session, open a new tab — note should appear (same IndexedDB)

### QA checklist
- [ ] Notes persist across refresh
- [ ] Snippets persist across refresh
- [ ] Snippet order persists across refresh
- [ ] Snippet labels persist across refresh
- [ ] Settings persist across refresh
- [ ] No data loss on tab switch (visibilitychange save)
- [ ] No data loss on tab close (beforeunload save)
- [ ] Active note restores on reload (most recent)
- [ ] Deleting a note also deletes its snippets from IndexedDB
- [ ] Deleting a note also deletes its version snapshots from IndexedDB

---

## 15. Document Export

### How it works
The export menu provides four ways to share your writing. Click the **Share icon** in the editor toolbar to open the dropdown:

- **Copy as Markdown** — copies the raw markdown to your clipboard
- **Copy as HTML** — copies rendered HTML to your clipboard (paste into rich-text editors, emails, etc.)
- **Download as .md** — downloads a markdown file named after your note title
- **Download as .html** — downloads a styled HTML file matching Fragment's visual identity (dark theme, DM Serif Display headings, gold accents)

**Every export action automatically creates a version snapshot** in the timeline, so you always know what you exported and when.

### How to test
1. Write some content in a note with a title
2. Click the Share icon in the toolbar — dropdown should appear
3. Click "Copy as Markdown" — paste in a text editor, verify raw markdown
4. Click "Copy as HTML" — paste in Google Docs or email, verify formatted text
5. Click "Download as .md" — verify file downloads with correct filename and content
6. Click "Download as .html" — open the file in a browser, verify it renders with Fragment styling
7. After each export, open the Timeline (`Cmd+T`) — verify a version snapshot was created
8. Click outside the dropdown — it should close

### QA checklist
- [ ] Share icon visible in toolbar when a note is active
- [ ] Dropdown opens on click, closes on click outside
- [ ] Copy as Markdown copies correct markdown to clipboard
- [ ] Copy as HTML copies rendered HTML to clipboard
- [ ] Downloaded .md file has correct filename (sanitized from title)
- [ ] Downloaded .html file renders with Fragment-matching dark theme
- [ ] Toast notification appears after each action
- [ ] Export auto-creates a version snapshot in the timeline
- [ ] Export buttons are hidden during version preview mode
- [ ] Dropdown has fadeIn animation

---

## 16. Document Timeline (Version Control)

### How it works
The timeline tracks the history of your document through named snapshots. It replaces the Snip Bar in the right panel slot when open.

**Creating versions:**
- **Manual snapshots**: Click "Save snapshot" in the timeline panel, name it, press Enter
- **Quick save**: Press `Cmd+S` — creates a "Quick save" snapshot instantly
- **Auto-snapshots on export**: Every export action (copy or download) creates a version with the export type as the name

**Viewing the timeline:**
- Click the **Clock icon** in the editor toolbar, or press `Cmd+T`
- Versions are grouped by day (Today, Yesterday, dates)
- **Filled gold dot (●)** = manual snapshot
- **Outlined gold dot (○)** = export-triggered snapshot
- Each entry shows the name, relative timestamp, and word count

**Previewing past versions:**
- Click any version in the timeline to enter **preview mode**
- The editor becomes read-only and shows the version's content
- A gold-tinted banner appears with "Restore this version" and "Back to current"
- Press `Escape` or click "Back to current" to exit preview

**Restoring a version:**
- Click "Restore this version" in the preview banner, or use the context menu on a version entry
- Fragment **always creates a safety snapshot** of your current state before restoring, so you can never lose work
- After restore, you're back in the editor with the version's content as your current document

**Deleting versions:**
- Hover over a version, click the three-dot menu, click "Delete"
- Deleting a note cascade-deletes all its versions

### How to test
1. Open a note and press `Cmd+T` — timeline panel should appear
2. Click "Save snapshot", name it "First draft", press Enter — version should appear
3. Make edits, press `Cmd+S` — "Quick save" snapshot should appear with toast
4. Export via Share menu — export-triggered version should appear (outlined dot)
5. Click a version — editor should become read-only with preview banner
6. Click "Back to current" — editor should return to live document
7. Click "Restore this version" — content should change, toast should confirm, a "Before restore" snapshot should appear
8. Hover a version, click three-dot menu, click "Delete" — version should be removed
9. Press `Cmd+H` — should switch from timeline to helper bar
10. Refresh the page, reopen timeline — versions should persist
11. Delete the note — all versions should be deleted too

### QA checklist
- [ ] Clock icon toggles timeline panel
- [ ] `Cmd+T` toggles timeline panel
- [ ] `Cmd+H` switches from timeline to Snip Bar
- [ ] `Cmd+S` creates a manual snapshot with toast
- [ ] "Save snapshot" button opens inline name input
- [ ] Enter confirms snapshot name, Escape cancels
- [ ] Versions are grouped by day with separators
- [ ] Manual snapshots show filled gold dot
- [ ] Export snapshots show outlined gold dot
- [ ] Each entry shows name, timestamp, and word count
- [ ] Clicking a version enters read-only preview mode
- [ ] Preview banner shows version name and timestamp
- [ ] "Back to current" exits preview mode
- [ ] `Escape` exits preview mode
- [ ] "Restore this version" creates safety snapshot first
- [ ] Restored content replaces current document
- [ ] Toast confirms restore action
- [ ] Version context menu has Restore and Delete options
- [ ] Deleting a version removes it from the list
- [ ] Versions persist across page refresh
- [ ] Deleting a note cascade-deletes its versions
- [ ] Empty state shows when no versions exist
- [ ] Timeline panel matches Fragment's design system

---

## 17. In-App Help

### How it works
A help overlay accessible from:
- **`?` button** at the bottom of the sidebar (next to Settings)
- **`Cmd+/`** keyboard shortcut

The help panel shows:
- All keyboard shortcuts with descriptions
- Feature overview grouped by category (Writing, Snippets, AI, Export, Timeline)
- Brief descriptions of how each feature works

### How to test
1. Click the `?` button in the sidebar — help overlay should open
2. Press `Cmd+/` — help overlay should open
3. Verify all shortcuts are listed and accurate
4. Verify feature descriptions match actual behavior
5. Press Escape — overlay should close
6. Click outside — overlay should close

### QA checklist
- [ ] Help button visible in sidebar
- [ ] `Cmd+/` opens help overlay
- [ ] All keyboard shortcuts listed
- [ ] Feature descriptions are accurate
- [ ] Escape closes the overlay
- [ ] Clicking outside closes the overlay
- [ ] Help content matches the design system

---

## 18. Inline Editing (Refine)

### How it works
When you select text in the editor, a floating toolbar (bubble menu) appears above the selection with four actions:

1. **Snip** — Adds the selected text as a snippet to the Snip Bar (same behavior as the old toolbar Snip button, now integrated into the Refine menu)
2. **Concise** — AI rewrites the selection to be tighter, removing redundancy while preserving meaning
3. **Elaborate** — AI expands the selection with more detail, examples, or nuance while keeping the same voice
4. **Edit** — Opens a custom text input field where you type any instruction (e.g., "make this funnier", "rewrite as a question", "add a statistic")

All AI edits are **context-aware** — they receive the text before the selection, the text after the selection, and the note's goal/audience/tone/remember fields. This means the AI understands the full document when making changes, not just the highlighted text. That's the money.

The edited text replaces the selection in place. It's a normal edit — you can undo it with `Cmd+Z`.

### How to test
1. Set your API key in Settings
2. Write a few paragraphs, set a goal, audience, and tone
3. Select a sentence and verify the floating toolbar appears above the selection
4. Click **Snip** — verify the text is added as a snippet to the Snip Bar
5. Select another sentence, click **Concise** — verify loading state appears, then the sentence is replaced with a shorter version
6. Select text, click **Elaborate** — verify it's replaced with a more detailed version
7. Select text, click **Edit** — verify the custom input appears
8. Type "rewrite as a question" and press Enter — verify the text is replaced
9. Press `Cmd+Z` after any edit — verify undo works (original text is restored)
10. Click away (deselect) — verify the toolbar disappears
11. In Settings, disable Inline Edit — verify the toolbar does not appear on selection
12. In Settings, change the model or prompt template — verify new edits use the new config
13. Try with no API key — verify the toolbar still shows but edits gracefully fail (no crash)

### QA checklist
- [ ] Floating toolbar appears above text selection
- [ ] Toolbar does not appear when there's no selection
- [ ] Toolbar does not appear during version preview mode
- [ ] Toolbar does not appear when Refine is disabled in settings
- [ ] Snip button adds selection as snippet and opens Snip Bar
- [ ] Concise replaces selection with shorter text
- [ ] Elaborate replaces selection with expanded text
- [ ] Edit opens custom input field
- [ ] Custom input submits on Enter, cancels on Escape
- [ ] Loading spinner shows during AI processing
- [ ] Buttons are disabled during loading
- [ ] Edited text replaces selection in place
- [ ] Undo (`Cmd+Z`) restores original text after any edit
- [ ] Toolbar disappears after successful edit
- [ ] Toolbar disappears when selection is cleared
- [ ] No crash when API key is missing
- [ ] Refine settings (provider, model, prompt, context limit) are applied
- [ ] Toolbar has fadeIn animation and matches design system
- [ ] Dividers separate Snip from edit actions and edit actions from custom Edit
