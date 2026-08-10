/**
 * The data store holds a fragment's satellites, not the fragment: the snips cut
 * out of it, the versions snapshotted from it, and the transient "awaiting
 * Substack confirmation" flag. The words themselves live in the content store,
 * so anything about creating or editing them is covered in
 * content-store.test.ts instead.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDataStore } from "@/stores/data-store";
import { useAppStore } from "@/stores/app-store";
import { useContentStore } from "@/stores/content-store";
import type { ContentFormat } from "@/lib/content-engine";
import type { PieceVersion } from "@/lib/types";

// Mock the writes, keep the real guards: the stores call persistence on every
// mutation, and assertPublishGuard has to behave exactly as it does in prod.
vi.mock("@/lib/persistence", async () => {
  const actual = await vi.importActual<typeof import("@/lib/persistence")>(
    "@/lib/persistence",
  );
  return {
    ...actual,
    saveIdea: vi.fn().mockResolvedValue(undefined),
    savePiece: vi.fn().mockResolvedValue(undefined),
    saveSnippet: vi.fn(),
    deleteSnippet: vi.fn(),
    savePieceVersion: vi.fn(),
    deletePieceVersion: vi.fn(),
  };
});

function resetStores() {
  useDataStore.setState({
    snippets: {},
    versions: {},
    pendingSubstackPublish: {},
    hydrated: true,
  });
  useContentStore.setState({
    ideas: {},
    pieces: {},
    resources: {},
    hydrated: true,
  });
  useAppStore.setState({
    activePieceId: null,
    liveEditorPieceId: null,
    liveEditorContent: null,
    timelinePreviewVersionId: null,
  });
}

/** An idea with one fragment in it, which is the only shape a fragment has. */
function seedFragment(format: ContentFormat = "essay"): { ideaId: string; pieceId: string } {
  const ideaId = useContentStore.getState().createIdea({ title: "Idea" });
  const pieceId = useContentStore.getState().createPiece({
    ideaId,
    format,
    origin: "user",
    status: "in-progress",
  });
  return { ideaId, pieceId };
}

describe("data-store: snips", () => {
  beforeEach(resetStores);

  it("addSnippet appends to the end by default", () => {
    const { pieceId } = seedFragment();

    const s1 = useDataStore.getState().addSnippet(pieceId, "first");
    const s2 = useDataStore.getState().addSnippet(pieceId, "second");

    const snippets = useDataStore.getState().snippets;
    expect(snippets[s1].order).toBe(0);
    expect(snippets[s2].order).toBe(1);
  });

  it("addSnippet at an index shifts the snips already at or after it", () => {
    const { pieceId } = seedFragment();

    const s1 = useDataStore.getState().addSnippet(pieceId, "first");
    const s2 = useDataStore.getState().addSnippet(pieceId, "second");
    const s3 = useDataStore.getState().addSnippet(pieceId, "inserted", 1);

    const snippets = useDataStore.getState().snippets;
    expect(snippets[s1].order).toBe(0);
    expect(snippets[s3].order).toBe(1);
    expect(snippets[s2].order).toBe(2);
  });

  it("a fresh snip starts out waiting for its label", () => {
    const { pieceId } = seedFragment();
    const id = useDataStore.getState().addSnippet(pieceId, "text");
    expect(useDataStore.getState().snippets[id].labelStatus).toBe("loading");
  });

  it("a snip cut out of a fragment is filed against that fragment", () => {
    const { ideaId, pieceId } = seedFragment();
    const id = useDataStore.getState().addSnippet(pieceId, "cut from the draft", undefined, ideaId);

    const snippet = useDataStore.getState().snippets[id];
    expect(snippet.pieceId).toBe(pieceId);
    expect(snippet.ideaId).toBe(ideaId);
    // Nothing created after the switchover fills the retired note column in.
    expect(snippet.noteId).toBeNull();
  });

  it("a snip cut with no fragment open is filed against the idea", () => {
    const id = useDataStore.getState().addSnippet(null, "cut in the feed", undefined, "idea-1");

    const snippet = useDataStore.getState().snippets[id];
    expect(snippet.pieceId).toBeUndefined();
    expect(snippet.ideaId).toBe("idea-1");
  });

  it("a snip with neither home is refused rather than written somewhere it can never be read back", () => {
    expect(useDataStore.getState().addSnippet(null, "homeless")).toBe("");
    expect(Object.keys(useDataStore.getState().snippets)).toHaveLength(0);
  });

  it("order runs within a home, not across homes", () => {
    const { pieceId } = seedFragment();

    const p1 = useDataStore.getState().addSnippet(pieceId, "fragment first");
    const i1 = useDataStore.getState().addSnippet(null, "idea first", undefined, "idea-1");
    const p2 = useDataStore.getState().addSnippet(pieceId, "fragment second");
    const i2 = useDataStore.getState().addSnippet(null, "idea second", undefined, "idea-1");

    const snippets = useDataStore.getState().snippets;
    expect([snippets[p1].order, snippets[p2].order]).toEqual([0, 1]);
    expect([snippets[i1].order, snippets[i2].order]).toEqual([0, 1]);
  });

  it("updateSnippetLabel records the label and its status", () => {
    const { pieceId } = seedFragment();
    const id = useDataStore.getState().addSnippet(pieceId, "text");

    useDataStore.getState().updateSnippetLabel(id, "Introduction", "done");
    const snippet = useDataStore.getState().snippets[id];
    expect(snippet.label).toBe("Introduction");
    expect(snippet.labelStatus).toBe("done");
  });

  it("updateSnippetLabel on an unknown id changes nothing", () => {
    useDataStore.getState().updateSnippetLabel("fake", "label", "done");
    expect(Object.keys(useDataStore.getState().snippets)).toHaveLength(0);
  });

  it("updateSnippetContent rewrites the words and leaves everything else", () => {
    const { pieceId } = seedFragment();
    const id = useDataStore.getState().addSnippet(pieceId, "first thought");
    useDataStore.getState().updateSnippetLabel(id, "A thought", "done");
    const before = useDataStore.getState().snippets[id];

    useDataStore.getState().updateSnippetContent(id, "a better thought");

    const after = useDataStore.getState().snippets[id];
    expect(after.content).toBe("a better thought");
    // The label is the caller's problem, not the store's: re-labelling edited
    // words is a decision the card makes (see snippet-card.tsx).
    expect(after).toEqual({ ...before, content: "a better thought" });
  });

  it("updateSnippetContent on an unknown id changes nothing", () => {
    useDataStore.getState().updateSnippetContent("fake", "text");
    expect(Object.keys(useDataStore.getState().snippets)).toHaveLength(0);
  });

  it("removeSnippet takes it off the bar; restoreSnippet puts it back as it was", () => {
    const { pieceId } = seedFragment();
    const id = useDataStore.getState().addSnippet(pieceId, "text");
    const snapshot = useDataStore.getState().snippets[id];

    useDataStore.getState().removeSnippet(id);
    expect(useDataStore.getState().snippets[id]).toBeUndefined();

    useDataStore.getState().restoreSnippet(snapshot);
    expect(useDataStore.getState().snippets[id]).toEqual(snapshot);
  });

  it("reorderSnippets applies the new order in bulk", () => {
    const { pieceId } = seedFragment();
    const s1 = useDataStore.getState().addSnippet(pieceId, "a");
    const s2 = useDataStore.getState().addSnippet(pieceId, "b");

    useDataStore.getState().reorderSnippets([
      { id: s1, order: 1 },
      { id: s2, order: 0 },
    ]);

    const snippets = useDataStore.getState().snippets;
    expect(snippets[s1].order).toBe(1);
    expect(snippets[s2].order).toBe(0);
  });

  it("setSnippets hydrates from an array", () => {
    useDataStore.getState().setSnippets([
      {
        id: "x",
        noteId: null,
        pieceId: "piece-1",
        content: "text",
        label: null,
        labelStatus: "idle",
        createdAt: 1,
        order: 0,
      },
    ]);
    expect(useDataStore.getState().snippets["x"].content).toBe("text");
  });

  it("nothing is cut before hydration, when the bar's contents are still unknown", () => {
    useDataStore.setState({ hydrated: false });
    expect(useDataStore.getState().addSnippet("piece-1", "too early")).toBe("");
    expect(Object.keys(useDataStore.getState().snippets)).toHaveLength(0);
  });
});

describe("data-store: versions", () => {
  beforeEach(resetStores);

  it("createVersion snapshots the fragment's words and its brief", () => {
    const { pieceId } = seedFragment();
    useContentStore.getState().updatePiece(pieceId, {
      title: "Two roadmaps",
      subtitle: "A dek",
      body: "saved content",
      goal: "Convince skeptical CTOs",
      audience: "Engineering leaders",
      tone: "Direct",
      remember: "Never name a vendor",
      voiceId: "voice-1",
    });

    const versionId = useDataStore.getState().createVersion(pieceId, "Quick save", "manual");
    const version = useDataStore.getState().versions[versionId];

    expect(version.pieceId).toBe(pieceId);
    expect(version.title).toBe("Two roadmaps");
    expect(version.subtitle).toBe("A dek");
    expect(version.content).toBe("saved content");
    expect(version.goal).toBe("Convince skeptical CTOs");
    expect(version.audience).toBe("Engineering leaders");
    expect(version.tone).toBe("Direct");
    expect(version.remember).toBe("Never name a vendor");
    expect(version.voiceId).toBe("voice-1");
    expect(version.trigger).toBe("manual");
    expect(version.wordCount).toBe(2);
  });

  it("createVersion reads the live editor buffer for the fragment being typed in", () => {
    const { pieceId } = seedFragment();
    useContentStore.getState().updatePiece(pieceId, { body: "saved content" });
    useAppStore.getState().setLiveEditorContent(pieceId, "saved content\n\n \n\nlatest line");

    const versionId = useDataStore.getState().createVersion(pieceId, "Quick save", "manual");

    expect(useDataStore.getState().versions[versionId].content).toBe(
      "saved content\n\n \n\nlatest line",
    );
  });

  it("createVersion falls back to the saved text when the live buffer belongs to another fragment", () => {
    const { pieceId } = seedFragment();
    useContentStore.getState().updatePiece(pieceId, { body: "fragment content" });
    useAppStore.getState().setLiveEditorContent("another-piece", "other content");

    const versionId = useDataStore.getState().createVersion(pieceId, "Quick save", "manual");

    expect(useDataStore.getState().versions[versionId].content).toBe("fragment content");
  });

  it("createVersion refuses a fragment that is not there", () => {
    expect(useDataStore.getState().createVersion("missing", "Quick save", "manual")).toBe("");
    expect(Object.keys(useDataStore.getState().versions)).toHaveLength(0);
  });

  it("removeVersion takes the entry off the timeline", () => {
    const { pieceId } = seedFragment();
    const versionId = useDataStore.getState().createVersion(pieceId, "Quick save", "manual");

    useDataStore.getState().removeVersion(versionId);
    expect(useDataStore.getState().versions[versionId]).toBeUndefined();
  });

  it("restoreVersion writes the snapshot back onto the fragment", () => {
    const { pieceId } = seedFragment();
    useContentStore.getState().updatePiece(pieceId, { title: "First", body: "first draft" });
    const versionId = useDataStore.getState().createVersion(pieceId, "Quick save", "manual");
    useContentStore.getState().updatePiece(pieceId, { title: "Second", body: "rewritten" });

    useDataStore.getState().restoreVersion(versionId);

    const piece = useContentStore.getState().pieces[pieceId];
    expect(piece.title).toBe("First");
    expect(piece.body).toBe("first draft");
  });

  it("restoreVersion snapshots what it is about to overwrite, so the restore itself can be undone", () => {
    const { pieceId } = seedFragment();
    useContentStore.getState().updatePiece(pieceId, { body: "first draft" });
    const versionId = useDataStore.getState().createVersion(pieceId, "Quick save", "manual");
    useContentStore.getState().updatePiece(pieceId, { body: "rewritten" });

    useDataStore.getState().restoreVersion(versionId);

    const contents = Object.values(useDataStore.getState().versions).map((v) => v.content);
    expect(contents).toContain("rewritten");
  });

  it("restoreVersion leaves everything alone when the fragment is gone", () => {
    const { pieceId } = seedFragment();
    const versionId = useDataStore.getState().createVersion(pieceId, "Quick save", "manual");
    useContentStore.setState({ pieces: {} });

    useDataStore.getState().restoreVersion(versionId);

    expect(Object.keys(useDataStore.getState().versions)).toEqual([versionId]);
  });

  it("duplicateFromVersion makes a new fragment in the same idea, carrying the brief with the words", () => {
    const { ideaId, pieceId } = seedFragment("substack");
    useContentStore.getState().updatePiece(pieceId, {
      title: "Two roadmaps",
      subtitle: "A dek",
      body: "the words",
      goal: "Convince skeptical CTOs",
      audience: "Engineering leaders",
      tone: "Direct",
      remember: "Never name a vendor",
      voiceId: "voice-1",
    });
    const versionId = useDataStore.getState().createVersion(pieceId, "Quick save", "manual");

    const copyId = useDataStore.getState().duplicateFromVersion(versionId);
    const copy = useContentStore.getState().pieces[copyId];

    expect(copyId).not.toBe(pieceId);
    expect(copy.ideaId).toBe(ideaId);
    expect(copy.format).toBe("substack");
    expect(copy.title).toBe("Two roadmaps copy");
    expect(copy.body).toBe("the words");
    expect(copy.subtitle).toBe("A dek");
    expect(copy.goal).toBe("Convince skeptical CTOs");
    expect(copy.audience).toBe("Engineering leaders");
    expect(copy.tone).toBe("Direct");
    expect(copy.remember).toBe("Never name a vendor");
    expect(copy.voiceId).toBe("voice-1");
    // A copy you made on purpose is already picked up.
    expect(copy.status).toBe("in-progress");
    expect(copy.seen).toBe(true);
  });

  it("duplicateFromVersion refuses when the fragment it came out of is gone", () => {
    const { pieceId } = seedFragment();
    const versionId = useDataStore.getState().createVersion(pieceId, "Quick save", "manual");
    useContentStore.setState({ pieces: {} });

    expect(useDataStore.getState().duplicateFromVersion(versionId)).toBe("");
  });

  it("setVersions hydrates from an array, keyed by version id", () => {
    const version: PieceVersion = {
      id: "v1",
      pieceId: "piece-1",
      title: "T",
      content: "c",
      goal: "",
      audience: "",
      tone: "",
      remember: "",
      name: "Aug 9, 10:00",
      trigger: "manual",
      wordCount: 1,
      createdAt: 1,
    };
    useDataStore.getState().setVersions([version]);
    expect(useDataStore.getState().versions["v1"]).toEqual(version);
  });
});

describe("data-store: awaiting Substack confirmation", () => {
  beforeEach(resetStores);

  it("markPiecePublishPending stamps the fragment with when the attempt fired", () => {
    useDataStore.getState().markPiecePublishPending("piece-1");
    expect(useDataStore.getState().pendingSubstackPublish["piece-1"]).toBeGreaterThan(0);
  });

  it("clearPiecePublishPending resolves the attempt", () => {
    useDataStore.getState().markPiecePublishPending("piece-1");
    useDataStore.getState().clearPiecePublishPending("piece-1");
    expect(useDataStore.getState().pendingSubstackPublish["piece-1"]).toBeUndefined();
  });

  it("one fragment's pending attempt is not another's", () => {
    useDataStore.getState().markPiecePublishPending("piece-1");
    useDataStore.getState().markPiecePublishPending("piece-2");

    useDataStore.getState().clearPiecePublishPending("piece-1");

    expect(Object.keys(useDataStore.getState().pendingSubstackPublish)).toEqual(["piece-2"]);
  });

  it("clearing a fragment that was never pending leaves the map alone", () => {
    const before = useDataStore.getState().pendingSubstackPublish;
    useDataStore.getState().clearPiecePublishPending("never-pending");
    expect(useDataStore.getState().pendingSubstackPublish).toBe(before);
  });
});
