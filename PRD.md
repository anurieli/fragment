# Fragment: Product Requirements Document

Fragment is a writing tool for people who think faster than they publish. This
document defines what the product is, what it is made of, and what it refuses to
be. It describes the **one-entity model**: everything you write is a **fragment**
inside an **idea**.

The previous spec, which treated a note as the primary entity, is kept at
[`docs/history/prd-v1-notes.md`](./docs/history/prd-v1-notes.md). For the shape
of the data on disk, read `src/lib/db.ts`: the Dexie versions are the record of
the bytes, and each one carries the comment explaining why it exists.

---

## 1. The problem

People accumulate more ideas than they ever publish. The bottleneck is rarely
the thinking. It is the distance between having a thought and having a place to
put it.

Thoughts do not arrive as documents. They arrive mid-sentence, in the middle of
doing something else, often as a tangent off a piece of work already in
progress. A half-formed sentence about pricing shows up while you are three
paragraphs into an essay about hiring.

Every writing tool asks the same question at that moment: what is this? A new
document? A note in the existing one? A task? A file, and if so, in which
folder? That question is a decision, the decision costs more than the thought is
worth at the time, and so the thought is not kept. Repeat that a few hundred
times and you have a person who is full of ideas and empty of published work.

Fragment's position: you should never have to classify a thought in order to
keep it. Write it down, and let its size be decided later by what it turns into.

Three secondary problems follow from the first. Long-form writing is not linear,
and rearranging inside one scrolling document is manual and lossy. A finished
piece leaves material behind (cut paragraphs, tangents, the section that did not
fit) which most tools simply delete, because there is nowhere for it to go that
is not a new document. And getting feedback normally requires the reader to sign
up for something.

---

## 2. The model

Four words carry the entire product. They are the only vocabulary the interface
uses.

### Idea

An idea is a container for one line of thinking, and it is the only container.
It has a title, an optional one-line summary, a priority, and a pinned state. It
holds fragments, and it can hold child ideas one level deep: a child idea's
parent must itself be a root idea, so the deepest an idea tree gets is two.
That cap is deliberate. Arbitrary nesting turns a writing tool into a filing
system, and filing is the work we are trying to remove.

Ideas are how the writer navigates. The sidebar is a list of ideas and nothing
else. Every fragment belongs to exactly one idea; there is no loose content
floating outside the structure, and no separate "unfiled" list to keep tidy.

### Fragment

A fragment is a single piece of writing. It holds its own text, as markdown, in
its `body`. It belongs to one idea. It carries a format (`linkedin`, `tweet`,
`substack`, `essay`, `script`, `other`), a status (`inbox`, `in-progress`,
`ready`, `published`), a priority, and an optional writing brief: goal,
audience, tone, and a free-text "remember" field, plus a brand voice selection.

A fragment is the only content object in Fragment. A three-word thought is a
fragment. A finished 2,000-word essay is a fragment. There is no second type
waiting to be graduated into.

### Draft

A draft is a fragment whose format is long-form: `essay`, `substack`, or
`script`. That is the whole definition. A draft is not a different object, a
different table, or a different record; it is the same fragment, described by
its format.

This is the part that matters most, so it is worth stating plainly. Changing a
fragment into a draft changes one field. The text does not move, the id does not
change, its snips and versions and share links stay attached, and nothing is
copied. The fragment simply stops rendering as a card in the feed and starts
rendering in the editor, because the editor is where long-form belongs.

The old model had two objects, a short-form piece holding inline text and a
long-form note holding a document, joined by a link and separated by a
conversion step. That step is gone. There is nothing to convert, because there
was never a second thing.

Format is about shape, not storage. A short fragment and a long draft are the
same object at different sizes.

### Snip

A snip is a cut of text parked beside your writing. Select a passage in a draft,
snip it, and it appears as a card in the Snip Bar while staying in the document
(a snip copies, it does not cut). Each snip gets an AI-generated label so a stack
of them stays scannable. Drag one back into the draft and it lands exactly where
the drop cursor sits.

Snips are working material, not content. They belong to the fragment or idea they
were cut from, they are reorderable, and they are reusable: dropping a snip into
a document does not consume it.

---

## 3. The core loop

**Capture. Shape. Publish. Repeat.**

**Capture.** Write the thought. It lands as a fragment in an idea. No format
decision, no folder, no title required. If you are already writing something
else, capture happens without leaving the page.

**Shape.** A fragment grows or it does not. The ones that grow get a brief (goal,
audience, tone), a brand voice, AI help through Flow and Refine, snips pulled out
and rearranged, and version snapshots along the way. The ones that do not grow
sit in their idea costing nothing.

**Publish.** A fragment that is ready leaves Fragment: copied byte-exact to a
platform composer, posted to LinkedIn or Kit through a connected account, or
published to Substack with the go-live confirmed by watching the publication's
RSS feed. Or it leaves as a share link for a reader to comment on.

**Repeat.** This is the part the model exists to serve. Finishing a piece
produces leftovers: the tangent you cut, the section that did not fit, the
paragraph that was better than its context. In a document-shaped tool those are
deleted. Here they are already fragments, and a leftover fragment is the seed of
the next idea. The Idea action in the editor exists precisely to turn a
mid-draft tangent into its own idea without breaking the sentence you are in.

The loop is meant to run at both scales at once: inside one piece across an
afternoon, and across a body of work over months.

---

## 4. Primary flows

### 4.1 Starting an idea

The writer clicks "New idea" in the sidebar. Fragment creates the idea and its
first fragment in one step, and opens it for writing. There is no empty
container to stare at and no second click to add the first thing to it. Naming
the idea is inline and optional; a fragment with text and no title is a valid,
complete thing.

An idea can also arrive from an agent. Anything MCP-capable (Claude Code, Codex,
Hermes) writes a handoff file through `fragment-mcp`, and Fragment imports it
into the idea named in the file, creating that idea if it does not exist. Every
agent-pushed fragment lands with status `inbox` and unseen, regardless of what
the agent asked for, so the first read of agent work is always the writer's own
deliberate act.

Inbox is reserved for that external boundary. Extract Ideas runs inside
Fragment against the writer's own material, so its options enter a separate
extraction review queue. The global Inbox in the sidebar opens external
arrivals inside their idea; each idea repeats its own Inbox count in a collapsed
section below accepted Pieces. Approve moves an arrival into active work and
Toss removes it with Undo.

### 4.2 Capturing an idea from highlighted text, mid-draft

The writer is in a draft. A tangent occurs to them, and they have already typed
it into the paragraph they are working on.

They select it and press **Idea** in the selection toolbar. Fragment creates a
new idea titled from the selected text, holding one fragment with that text, and
shows a toast offering to open it.

Three properties make this usable, and all three are the point:

- **Non-destructive.** Unlike Snip, which relocates text, capture leaves the
  draft byte-for-byte as it was. A tangent is not something you want to cut out
  of the paragraph; it is something you want filed so you can keep going.
- **No navigation.** The toast offers the jump rather than performing it. Being
  moved somewhere else is the opposite of what capture is for.
- **No classification.** The writer never says what the captured thing is. It is
  a fragment in an idea, and it can become anything later.

### 4.3 Growing a fragment into a draft

A fragment starts as a card in its idea's feed: raw markdown, edited in place,
with the markdown styled live behind the caret so what you type is exactly what
gets published. That is right for a tweet and wrong for an essay.

When a fragment outgrows the card, its format changes to a long-form one and it
opens in the editor: live-rendering markdown, the Snip Bar, version history, and
export. Nothing about the fragment moves. Its text, id, brief, voice, priority,
resources, snips, and origin all stay exactly where they were. The feed stops
showing it because the feed shows short-form fragments, and the idea's draft list
starts showing it because that list shows long-form ones. Both lists are
filters over the same set of fragments.

Going back the other way is the same single change in reverse.

### 4.4 Refining with voice

A brand voice is a named writing voice: a description, a structure template, and
raw writing samples that Fragment analyzes into a distilled profile (a summary,
traits, example excerpts, and do / do-not guidance). Samples stay private to the
writer; the profile never carries raw sample text into a prompt.

A fragment's voice has three states, and all three are meaningful: inherit the
default voice, explicitly no voice, or a specific voice. Whatever resolves is
composed into the system prompt for every AI action on that fragment, so Flow
generations, Refine edits, and Generate-panel drafts come back sounding like the
writer rather than like a model.

The refining actions themselves:

- **Refine** on a selection: Concise, Elaborate, or a typed instruction. The AI
  receives the text before and after the selection plus the fragment's brief, so
  edits fit the document rather than the sentence.
- **Flow** on an empty line: type `/` and an instruction. The generation is
  previewed before insertion, with Insert, Discard, and Redo.
- **Generate**: a prompt panel with format and length controls, and dictation for
  writers who would rather say the brief out loud than type it.

Every AI edit is a normal edit. Undo reverses it.

### 4.5 Publishing

Publishing is per fragment, and what is offered depends on the format.

- **Copy for X / LinkedIn / Substack.** X and LinkedIn copies are the raw text,
  byte for byte, not even trimmed, because both platforms post what they are
  given and a tool that reflows a deliberately spaced post has broken it.
  Substack gets a rich HTML flavor plus a plain-text fallback.
- **Open composer.** Opens the platform's own compose page, pre-filled where the
  platform's URL scheme allows it.
- **Publish to Substack.** Copies the body, opens the Substack editor, and starts
  a verified-publish loop: Fragment polls the publication's RSS feed and flips
  the fragment to published once a matching title appears. The writer is never
  asked "did it go live?".
- **Publish to Kit**, as a draft or scheduled, through Kit's API.
- **Publish to LinkedIn**, through a connected account, in one round trip.
- **Manual escape hatches.** Mark ready and copy, mark as published, schedule.

Script-format fragments are never published from Fragment and offer no share
menu at all, because they exist to be used somewhere else.

A `published` status and a publish record are set together or not at all. The
invariant is enforced on write, not merely respected by convention.

### 4.6 Sharing for review

A draft can be read and commented on by someone with no Fragment account, ever,
by either of two paths.

**Hosted share link.** The writer creates a link. The draft is snapshotted at
that moment, so reviewers read a stable text and their comment anchors resolve
against what they actually saw. Reviewers identify themselves with an email and a
per-share token; each reviewer sees only their own comments. Links can be revoked
and can expire.

**Offline review file.** The writer downloads a single self-contained
`.review.html` file with the rendered draft and an inlined review interface, and
sends it however they like. The reviewer opens it in a browser with no network,
selects text to leave anchored comments or writes general ones, and their work
autosaves locally as they go. **Send back** downloads a small JSON file of their
comments, which the writer imports.

Either way, comments come back into a review panel grouped by reviewer. Clicking
a comment locates its anchored text in the *current* live draft, even after
editing around it, and jumps the selection there. An anchor that can no longer be
found degrades to a message rather than an error.

---

## 5. Surfaces

Three panels, plus one column that appears when an idea is open.

| Panel | Holds |
|---|---|
| Sidebar (left) | Global Inbox, then ideas nested one level. Search. Settings, help, feedback. |
| Idea workspace | Drafts and accepted Pieces, plus a separate collapsed Inbox for external arrivals owned by this idea. |
| Center | Either the draft editor or the idea's fragment feed. `⌘1` / `⌘2` switch. |
| Snip Bar (right) | Snips for what you are working on. Shares its slot with the version timeline. |

The center panel is the only one that changes what it is. Everything else
changes only what it lists.

Below 960px the three columns do not fit, so opening an idea hands the left rail
to the workspace; `⌘\` brings the sidebar back.

---

## 6. Out of scope

Deliberate exclusions. Each of these has been considered and declined.

- **Real-time collaborative editing.** Fragment is a single-writer tool. Sync
  moves one person's library between their own devices and resolves conflicts
  last-write-wins per record. Two people typing in one document is a different
  product with a different data model.
- **Reviewer accounts.** A reviewer never signs up, signs in, or installs
  anything. Email plus a per-share token is the entire identity, and the email is
  not verified. Real accounts would improve attribution and destroy the property
  that makes people actually review things.
- **Arbitrary nesting.** Ideas stop at two levels. Deeper trees are a filing
  system.
- **A rich-text editor for short-form fragments.** Short-form editing is raw
  markdown in a plain textarea with a highlighted mirror painted behind it. A
  document model round-trips the text on every save, and a tweet spaced on
  purpose comes back rewritten. Fidelity beats convenience here.
- **Server-side understanding of content.** The server stores opaque documents
  keyed by owner and collection. It does not model what an idea or a fragment
  contains, which is what lets the client's schema move without a database
  migration behind every field.
- **Credential sync.** Provider API keys, the Kit key, and the LinkedIn
  connection are stripped on the way out and restored from local values on the
  way back in. Settings sync; the ability to act as the writer does not.
- **Publishing to every platform.** Fragment covers X, LinkedIn, Substack, and
  Kit. Anything else is a copy action and a composer link.
- **Billing.** The schema is in place; there is no billing code and no paid tier.
- **A mobile client.** Fragment runs in a browser and as a desktop build.
- **Image storage and binary sync.** Not built. Binary content belongs in object
  storage with the document holding a key, not inlined into every sync delta.

---

## 7. The one-entity restructure

For a developer joining after this shipped, here is what it replaced and why the
code still carries traces of it.

### What the old model was

There were two content entities. `Note` was a long-form document with a title,
markdown content, and a writing brief. `ContentPiece` was a short-form unit
inside an idea, holding its text inline in `body`. A long-form piece did not hold
text at all; it held a `noteId` pointing at a note, and an invariant called
`pieceContentHome` enforced that a piece had exactly one content home, `noteId`
or `body`, never both and never neither.

Notes could also exist with no piece pointing at them. Those were "standalone
notes", and they had their own section in the sidebar, separate from ideas.

### What was wrong with it

The two-entity split forced a decision at the wrong moment. A thought had to be
either a note or a piece before it could be stored, and the writer made that call
before knowing what the thought was. Getting it wrong meant a conversion:
`convertPieceToDraft` moved a piece's text into a newly created note and swapped
its content home, and `revertPieceToShortform` put it back. Both were correct and
both were work the writer should never have had to think about.

It also split the library. Ideas held some writing; standalone notes held the
rest. Two lists, two mental models, one library.

### What the restructure did

`Note` stopped being a content entity. `ContentPiece` gained a required `body`,
so every fragment holds its own text, and `noteId` was removed from the type.
The conversion functions went with it: `convertPieceToDraft`,
`revertPieceToShortform`, `linkNoteToIdea`, `detachPieceNote`, and the
`pieceContentHome` invariant no longer exist. The sidebar's standalone Notes
section was deleted, because there is nothing that can be standalone any more.

The long-form / short-form distinction moved from storage to format. Selectors
that used to ask "does this have a `noteId`?" now ask "is this format long-form?"
(`isLongformFormat`), which is why a fragment becoming a draft is a single field
change.

### What survived on purpose

- **`legacyNoteId`.** A migrated fragment records the note its text came from,
  set once by the migration and never afterwards.
- **Share and review keys.** `shares.note_id` in Postgres is not null and
  predates the restructure, so shares and reviews are filed under a fragment's
  `legacyNoteId ?? id`, behind a single helper (`shareKeyFor`). Review lookups
  merge both keys, because reviews written before the migration carry only a note
  id. No SQL migration was needed, and links minted before the switchover still
  resolve.
- **`Note` and `NoteVersion` types.** They remain in `src/lib/types.ts` and their
  Dexie tables survive a grace window, because the migration reads them. No UI
  and no store may read them.
- **The wire word "piece".** The sync protocol, the collection name
  `contentPieces`, and the `fragment-mcp` tools (`add_piece`, `get_piece`, and
  friends) all still say *piece*: a public contract shared with agents and the
  hosted API. Renaming it to match a UI word would be a breaking change that buys
  nothing. User-visible copy says fragment; the wire says piece.

### The migration

The data migration is additive: it copies note text into fragments and deletes
nothing, so the worst case is a library holding two copies of itself rather than
one holding none. It is deterministic, so two devices migrating the same library
independently produce identical rows under identical ids and the server merges
them into one copy. It verifies its own result inside the transaction that writes
it, against a snapshot of the pre-migration state, and a failed check rolls the
whole thing back.

It runs once at startup, before hydration. If it fails, the app does not hydrate
and renders a blocking screen offering a backup download instead. A half-migrated
library that renders is worse than one that refuses to, because a writer who sees
their library missing half its contents will start recreating it.

---

## 8. Related documents

- [`docs/AGENT-API.md`](./docs/AGENT-API.md), the agent handoff contract
- [`docs/FEATURES.md`](./docs/FEATURES.md), feature behaviour and QA reference
- [`docs/ONBOARDING.md`](./docs/ONBOARDING.md), the first-run guide
- [`CLOUD.md`](./CLOUD.md), accounts, environment, deployment
- [`docs/history/prd-v1-notes.md`](./docs/history/prd-v1-notes.md), the superseded notes-era spec
