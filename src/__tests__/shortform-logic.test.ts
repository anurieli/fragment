import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  ageLabel,
  defaultSortForFilter,
  filterCounts,
  filterPieces,
  formatDuration,
  IDLE_THRESHOLD_MS,
  nextStatus,
  rovingNext,
  rovingPrev,
  scheduleLabel,
  scheduleOverdue,
  sortPieces,
  STALE_THRESHOLD_MS,
  stalenessLevel,
  visiblePieces,
  waitLabel,
} from "@/components/shortform/feed-logic";
import type { ContentPiece } from "@/lib/content-engine";
import { ContractError } from "@/lib/content-engine";
import { useContentStore } from "@/stores/content-store";

// Mock the persistence layer for the content-store interaction tests below —
// same pattern as content-store.test.ts.
vi.mock("@/lib/persistence", async () => {
  const actual = await vi.importActual<typeof import("@/lib/persistence")>(
    "@/lib/persistence",
  );
  return {
    ...actual,
    saveIdea: vi.fn().mockResolvedValue(undefined),
    savePiece: vi.fn().mockResolvedValue(undefined),
  };
});

function makePiece(overrides: Partial<ContentPiece> = {}): ContentPiece {
  return {
    id: "piece-1",
    ideaId: "idea-1",
    format: "tweet",
    status: "inbox",
    origin: "user",
    body: "text",
    seen: false,
    priority: 0,
    order: 0,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe("filterPieces / filterCounts", () => {
  const pieces = [
    makePiece({ id: "a", status: "inbox" }),
    makePiece({ id: "b", status: "inbox" }),
    makePiece({ id: "c", status: "in-progress" }),
    makePiece({ id: "d", status: "ready" }),
    makePiece({ id: "e", status: "published" }),
    makePiece({ id: "f", status: "ready", deletedAt: 5000 }),
  ];

  it("'all' keeps every live piece regardless of status", () => {
    expect(filterPieces(pieces, "all").map((p) => p.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("narrows to a single status and excludes deleted pieces", () => {
    expect(filterPieces(pieces, "inbox").map((p) => p.id)).toEqual(["a", "b"]);
    expect(filterPieces(pieces, "ready").map((p) => p.id)).toEqual(["d"]);
  });

  it("computes counts per filter chip over the live set", () => {
    expect(filterCounts(pieces)).toEqual({
      all: 5,
      inbox: 2,
      "in-progress": 1,
      ready: 1,
    });
  });
});

describe("sortPieces / visiblePieces — ready-queue ordering", () => {
  it("'priority' sorts urgent(1)..low(4) then none(0) last, ties broken by oldest createdAt", () => {
    const pieces = [
      makePiece({ id: "none", priority: 0, createdAt: 1 }),
      makePiece({ id: "low", priority: 4, createdAt: 1 }),
      makePiece({ id: "urgent-new", priority: 1, createdAt: 2000 }),
      makePiece({ id: "urgent-old", priority: 1, createdAt: 1000 }),
    ];
    const sorted = sortPieces(pieces, "priority");
    expect(sorted.map((p) => p.id)).toEqual(["urgent-old", "urgent-new", "low", "none"]);
  });

  it("the 'ready' filter's default sort is priority-then-oldest (the publish queue)", () => {
    expect(defaultSortForFilter("ready")).toBe("priority");
    expect(defaultSortForFilter("inbox")).toBe("newest");
    expect(defaultSortForFilter("all")).toBe("newest");
  });

  it("visiblePieces composes filter + sort: the ready queue in priority order", () => {
    const pieces = [
      makePiece({ id: "a", status: "ready", priority: 2, createdAt: 5000 }),
      makePiece({ id: "b", status: "inbox", priority: 1, createdAt: 1 }),
      makePiece({ id: "c", status: "ready", priority: 1, createdAt: 2000 }),
    ];
    const queue = visiblePieces(pieces, "ready", "priority");
    expect(queue.map((p) => p.id)).toEqual(["c", "a"]);
  });

  it("'newest' and 'oldest' sort by createdAt", () => {
    const pieces = [
      makePiece({ id: "a", createdAt: 1000 }),
      makePiece({ id: "b", createdAt: 3000 }),
      makePiece({ id: "c", createdAt: 2000 }),
    ];
    expect(sortPieces(pieces, "newest").map((p) => p.id)).toEqual(["b", "c", "a"]);
    expect(sortPieces(pieces, "oldest").map((p) => p.id)).toEqual(["a", "c", "b"]);
  });

  it("'last-edited' sorts by updatedAt descending", () => {
    const pieces = [
      makePiece({ id: "a", updatedAt: 1000 }),
      makePiece({ id: "b", updatedAt: 3000 }),
    ];
    expect(sortPieces(pieces, "last-edited").map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("'manual' sorts by the stored order field", () => {
    const pieces = [
      makePiece({ id: "a", order: 2 }),
      makePiece({ id: "b", order: 0 }),
      makePiece({ id: "c", order: 1 }),
    ];
    expect(sortPieces(pieces, "manual").map((p) => p.id)).toEqual(["b", "c", "a"]);
  });
});

describe("formatDuration / ageLabel / waitLabel", () => {
  it("formats days, hours, and minutes", () => {
    expect(formatDuration(3 * 86_400_000)).toBe("3d");
    expect(formatDuration(5 * 3_600_000)).toBe("5h");
    expect(formatDuration(30 * 60_000)).toBe("30m");
  });

  it("floors sub-minute durations to 1m rather than 0m", () => {
    expect(formatDuration(5000)).toBe("1m");
  });

  it("clamps negative durations to zero", () => {
    expect(formatDuration(-1000)).toBe("1m");
  });

  it("ageLabel is keyed off createdAt (independent of updatedAt)", () => {
    const piece = makePiece({ createdAt: 1000, updatedAt: 999_000_000 });
    const now = 1000 + 6 * 86_400_000;
    expect(ageLabel(piece, now)).toBe("6d");
  });

  it("waitLabel is keyed off updatedAt (time since the piece last changed)", () => {
    const piece = makePiece({ updatedAt: 1000 });
    const now = 1000 + 3 * 86_400_000;
    expect(waitLabel(piece, now)).toBe("3d");
  });
});

describe("stalenessLevel — 7d/14d idle thresholds", () => {
  it("is 'fresh' below the 7-day threshold", () => {
    const piece = makePiece({ updatedAt: 1000 });
    expect(stalenessLevel(piece, 1000 + STALE_THRESHOLD_MS - 1)).toBe("fresh");
  });

  it("becomes 'stale' at exactly the 7-day threshold", () => {
    const piece = makePiece({ updatedAt: 1000 });
    expect(stalenessLevel(piece, 1000 + STALE_THRESHOLD_MS)).toBe("stale");
  });

  it("stays 'stale' just under the 14-day threshold", () => {
    const piece = makePiece({ updatedAt: 1000 });
    expect(stalenessLevel(piece, 1000 + IDLE_THRESHOLD_MS - 1)).toBe("stale");
  });

  it("becomes 'idle' at exactly the 14-day threshold", () => {
    const piece = makePiece({ updatedAt: 1000 });
    expect(stalenessLevel(piece, 1000 + IDLE_THRESHOLD_MS)).toBe("idle");
  });
});

describe("roving focus next/prev", () => {
  it("advances from a negative (unfocused) index to the first item", () => {
    expect(rovingNext(-1, 5)).toBe(0);
    expect(rovingPrev(-1, 5)).toBe(0);
  });

  it("clamps at the end / start rather than wrapping", () => {
    expect(rovingNext(4, 5)).toBe(4);
    expect(rovingPrev(0, 5)).toBe(0);
  });

  it("steps by one within range", () => {
    expect(rovingNext(1, 5)).toBe(2);
    expect(rovingPrev(3, 5)).toBe(2);
  });

  it("returns -1 for an empty list", () => {
    expect(rovingNext(-1, 0)).toBe(-1);
    expect(rovingPrev(0, 0)).toBe(-1);
  });
});

describe("nextStatus — the 'S' key cycle", () => {
  it("cycles inbox -> in-progress -> ready -> inbox, never landing on published", () => {
    expect(nextStatus("inbox")).toBe("in-progress");
    expect(nextStatus("in-progress")).toBe("ready");
    expect(nextStatus("ready")).toBe("inbox");
  });

  it("a published piece (reached only via the future Share flow) cycles back to inbox rather than erroring", () => {
    expect(nextStatus("published")).toBe("inbox");
  });
});

// Store interactions — seen-on-focus and priority cycling are exercised
// directly against content-store, per the ticket's test plan, rather than
// duplicated as pure helpers here.
describe("content-store interactions used by the feed", () => {
  beforeEach(() => {
    useContentStore.setState({ ideas: {}, pieces: {}, hydrated: true });
  });

  it("markPieceSeen (first textarea focus) flips seen true exactly once", () => {
    const ideaId = useContentStore.getState().createIdea({ title: "Idea" });
    const id = useContentStore.getState().createPiece({
      ideaId,
      format: "other",
      origin: "user",
      status: "inbox",
      body: "draft",
    });
    expect(useContentStore.getState().pieces[id].seen).toBe(false);

    useContentStore.getState().markPieceSeen(id);
    expect(useContentStore.getState().pieces[id].seen).toBe(true);

    // Idempotent — a second focus doesn't throw or change anything further.
    useContentStore.getState().markPieceSeen(id);
    expect(useContentStore.getState().pieces[id].seen).toBe(true);
  });

  it("cyclePiecePriority (the 'P' key / flag click) cycles 0 -> 1 -> 2 -> 3 -> 4 -> 0", () => {
    const ideaId = useContentStore.getState().createIdea({ title: "Idea" });
    const id = useContentStore.getState().createPiece({
      ideaId,
      format: "other",
      origin: "user",
      status: "inbox",
      body: "draft",
    });
    const expected = [1, 2, 3, 4, 0];
    for (const priority of expected) {
      useContentStore.getState().cyclePiecePriority(id);
      expect(useContentStore.getState().pieces[id].priority).toBe(priority);
    }
  });

  it("setPieceStatus still guards published without a publish record — why the S-key cycle avoids it", () => {
    const ideaId = useContentStore.getState().createIdea({ title: "Idea" });
    const id = useContentStore.getState().createPiece({
      ideaId,
      format: "other",
      origin: "user",
      status: "inbox",
      body: "draft",
    });
    expect(() => useContentStore.getState().setPieceStatus(id, "published")).toThrow(
      ContractError,
    );
  });
});

describe("feed-logic — scheduling (ARI-159)", () => {
  it("scheduleLabel formats date and time, minutes only when non-zero", () => {
    expect(scheduleLabel(new Date(2026, 6, 30, 14, 0).getTime())).toBe("→ Jul 30, 2pm");
    expect(scheduleLabel(new Date(2026, 0, 5, 9, 30).getTime())).toBe("→ Jan 5, 9:30am");
    expect(scheduleLabel(new Date(2026, 11, 1, 0, 0).getTime())).toBe("→ Dec 1, 12am");
  });

  it("scheduleOverdue is true only for past schedules without a publish", () => {
    const now = 1_000_000;
    expect(scheduleOverdue(makePiece({ scheduledAt: now - 1, status: "ready" }), now)).toBe(true);
    expect(scheduleOverdue(makePiece({ scheduledAt: now + 1, status: "ready" }), now)).toBe(false);
    expect(scheduleOverdue(makePiece({ scheduledAt: undefined }), now)).toBe(false);
    const published = makePiece({ scheduledAt: now - 1, status: "published" });
    expect(scheduleOverdue(published, now)).toBe(false);
  });

  it("schedule sort puts scheduled pieces soonest-first, unscheduled trailing newest-first", () => {
    const pieces = [
      makePiece({ id: "later", scheduledAt: 500, createdAt: 1 }),
      makePiece({ id: "none-old", createdAt: 10 }),
      makePiece({ id: "soon", scheduledAt: 100, createdAt: 2 }),
      makePiece({ id: "none-new", createdAt: 20 }),
    ];
    expect(sortPieces(pieces, "schedule").map((p) => p.id)).toEqual([
      "soon",
      "later",
      "none-new",
      "none-old",
    ]);
  });
});
