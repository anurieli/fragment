import { describe, expect, it } from "vitest";
import {
  bucketByDay,
  calendarEntries,
  calendarEntry,
  dayKey,
  entriesForMonth,
  monthGrid,
  summarise,
} from "@/lib/calendar/schedule";
import type { ContentPiece } from "@/lib/content-engine";

const NOW = new Date(2026, 7, 13, 12, 0, 0).getTime(); // Thu 13 Aug 2026, midday

function piece(over: Partial<ContentPiece> = {}): ContentPiece {
  return {
    id: "p1",
    ideaId: "i1",
    title: "",
    body: "some words",
    format: "substack",
    status: "ready",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as ContentPiece;
}

describe("calendar — where a piece lands", () => {
  it("gives no slot to a piece with neither a date nor a publication", () => {
    expect(calendarEntry(piece(), NOW)).toBeNull();
  });

  it("puts a published piece on the day it actually went out", () => {
    const wentOut = new Date(2026, 7, 20, 9, 0, 0).getTime();
    const entry = calendarEntry(
      piece({
        status: "published",
        scheduledAt: new Date(2026, 7, 18).getTime(),
        publish: { platform: "substack", method: "manual", publishedAt: wentOut, verified: true },
      }),
      NOW,
    );
    expect(entry?.state).toBe("published");
    // Scheduled for the 18th, published on the 20th: the calendar says the 20th.
    expect(entry?.at).toBe(wentOut);
  });

  it("calls a passed date with nothing published late", () => {
    const entry = calendarEntry(piece({ scheduledAt: new Date(2026, 7, 10).getTime() }), NOW);
    expect(entry?.state).toBe("late");
  });

  it("calls today's slot due, not late, until the day is out", () => {
    const entry = calendarEntry(piece({ scheduledAt: new Date(2026, 7, 13, 18, 0).getTime() }), NOW);
    expect(entry?.state).toBe("due");
  });

  // Earlier today and unpublished is genuinely late, even though it is today.
  it("calls an hour that has passed today late", () => {
    const entry = calendarEntry(piece({ scheduledAt: new Date(2026, 7, 13, 9, 0).getTime() }), NOW);
    expect(entry?.state).toBe("late");
  });

  it("calls a future date scheduled", () => {
    const entry = calendarEntry(piece({ scheduledAt: new Date(2026, 7, 25).getTime() }), NOW);
    expect(entry?.state).toBe("scheduled");
  });

  it("flags a booked slot with nothing written in it", () => {
    const entry = calendarEntry(
      piece({ body: "   ", scheduledAt: new Date(2026, 7, 25).getTime() }),
      NOW,
    );
    expect(entry?.empty).toBe(true);
  });
});

describe("calendar — the list", () => {
  it("leaves out deleted and archived pieces", () => {
    const at = new Date(2026, 7, 25).getTime();
    const entries = calendarEntries(
      [
        piece({ id: "a", scheduledAt: at }),
        piece({ id: "b", scheduledAt: at, deletedAt: NOW }),
        piece({ id: "c", scheduledAt: at, archivedAt: NOW }),
      ],
      NOW,
    );
    expect(entries.map((e) => e.piece.id)).toEqual(["a"]);
  });

  it("orders by when things happen", () => {
    const entries = calendarEntries(
      [
        piece({ id: "late", scheduledAt: new Date(2026, 7, 30).getTime() }),
        piece({ id: "soon", scheduledAt: new Date(2026, 7, 14).getTime() }),
      ],
      NOW,
    );
    expect(entries.map((e) => e.piece.id)).toEqual(["soon", "late"]);
  });

  it("groups by local day", () => {
    const morning = new Date(2026, 7, 25, 8, 0).getTime();
    const evening = new Date(2026, 7, 25, 22, 0).getTime();
    const buckets = bucketByDay(
      calendarEntries(
        [piece({ id: "a", scheduledAt: morning }), piece({ id: "b", scheduledAt: evening })],
        NOW,
      ),
    );
    expect(buckets.get(dayKey(morning))?.length).toBe(2);
  });

  it("counts a month up, and says how much of what is ahead is empty", () => {
    const entries = calendarEntries(
      [
        piece({ id: "a", scheduledAt: new Date(2026, 7, 10).getTime() }),
        piece({ id: "b", scheduledAt: new Date(2026, 7, 25).getTime(), body: "" }),
        piece({ id: "c", scheduledAt: new Date(2026, 7, 13, 20, 0).getTime() }),
        piece({
          id: "d",
          status: "published",
          publish: {
            platform: "substack",
            method: "manual",
            publishedAt: new Date(2026, 7, 5).getTime(),
            verified: true,
          },
        }),
      ],
      NOW,
    );
    expect(summarise(entries)).toEqual({
      published: 1,
      late: 1,
      due: 1,
      scheduled: 1,
      emptyAhead: 1,
    });
  });

  it("keeps a month to its own month", () => {
    const entries = calendarEntries(
      [
        piece({ id: "aug", scheduledAt: new Date(2026, 7, 25).getTime() }),
        piece({ id: "sep", scheduledAt: new Date(2026, 8, 2).getTime() }),
      ],
      NOW,
    );
    expect(entriesForMonth(entries, 2026, 7).map((e) => e.piece.id)).toEqual(["aug"]);
  });
});

describe("calendar — the grid", () => {
  it("is always six full weeks, so paging does not resize the page", () => {
    for (let month = 0; month < 12; month++) {
      expect(monthGrid(2026, month, NOW)).toHaveLength(42);
    }
  });

  it("starts on a Sunday and covers the whole month", () => {
    const grid = monthGrid(2026, 7, NOW);
    expect(grid[0].date.getDay()).toBe(0);
    const inMonth = grid.filter((d) => d.inMonth);
    expect(inMonth).toHaveLength(31);
    expect(inMonth[0].date.getDate()).toBe(1);
  });

  it("marks today once, and only in the month it is in", () => {
    expect(monthGrid(2026, 7, NOW).filter((d) => d.isToday)).toHaveLength(1);
    expect(monthGrid(2027, 0, NOW).filter((d) => d.isToday)).toHaveLength(0);
  });

  // A day key is what joins the grid to the buckets; a mismatch empties the
  // calendar without any error to explain why.
  it("keys grid days the same way entries are bucketed", () => {
    const at = new Date(2026, 7, 25, 15, 0).getTime();
    const grid = monthGrid(2026, 7, NOW);
    const cell = grid.find((d) => d.inMonth && d.date.getDate() === 25);
    expect(cell?.key).toBe(dayKey(at));
  });
});
