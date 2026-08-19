/**
 * The publishing calendar, as arithmetic.
 *
 * Pieces already carry a scheduled time and, once they go out, a publish
 * record. What was missing was a place to see both at once and an honest
 * answer to the two questions a schedule is for: did it go out, and was there
 * anything finished to send.
 *
 * A published piece sits on the day it actually went live, not the day it was
 * meant to. Planning to post on Tuesday and posting on Thursday is a Thursday
 * post, and a calendar that quietly redraws the past to match the plan is
 * worth less than no calendar.
 *
 * Pure and local-time throughout: a writer's week starts where they are, not
 * in UTC, and every consumer of these functions is a browser sitting in that
 * timezone.
 */

import type { ContentPiece } from "@/lib/content-engine";
import { scheduleOverdue } from "@/components/shortform/feed-logic";

export type ScheduleState =
  /** Went out. `at` is when. */
  | "published"
  /** Its time has passed and nothing went out. */
  | "late"
  /** Due today, still unpublished. */
  | "due"
  /** Still ahead. */
  | "scheduled";

export interface CalendarEntry {
  piece: ContentPiece;
  /** Where it lands on the grid: published time, or the scheduled one. */
  at: number;
  state: ScheduleState;
  /**
   * Nothing written yet. The other half of "did this work": a slot booked
   * against an empty piece is a missed post with a day's notice, and it is
   * the one thing a calendar can warn about before it goes wrong.
   */
  empty: boolean;
}

/** Local calendar day as "YYYY-MM-DD", the key both the grid and the buckets use. */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

function hasWords(body: string | undefined): boolean {
  return (body ?? "").trim().length > 0;
}

/**
 * One piece's place on the calendar, or null when it has none. A piece earns a
 * slot by being scheduled or by having been published; everything else is
 * still being written and belongs in the feed, not on a date.
 */
export function calendarEntry(piece: ContentPiece, now: number): CalendarEntry | null {
  const empty = !hasWords(piece.body);

  if (piece.publish) {
    return { piece, at: piece.publish.publishedAt, state: "published", empty };
  }
  if (piece.scheduledAt === undefined) return null;

  const late = scheduleOverdue(piece, now);
  const due = !late && dayKey(piece.scheduledAt) === dayKey(now);
  return {
    piece,
    at: piece.scheduledAt,
    state: late ? "late" : due ? "due" : "scheduled",
    empty,
  };
}

/**
 * Everything with a date, soonest first. Deleted and archived pieces are left
 * out: a calendar is a list of what is going to happen, and neither of those
 * is going to happen.
 */
export function calendarEntries(
  pieces: readonly ContentPiece[],
  now: number,
): CalendarEntry[] {
  return pieces
    .filter((p) => !p.deletedAt && !p.archivedAt)
    .map((p) => calendarEntry(p, now))
    .filter((e): e is CalendarEntry => e !== null)
    .sort((a, b) => a.at - b.at);
}

/** Entries grouped by the local day they land on. */
export function bucketByDay(entries: readonly CalendarEntry[]): Map<string, CalendarEntry[]> {
  const out = new Map<string, CalendarEntry[]>();
  for (const entry of entries) {
    const key = dayKey(entry.at);
    const bucket = out.get(key);
    if (bucket) bucket.push(entry);
    else out.set(key, [entry]);
  }
  return out;
}

export interface CalendarDay {
  key: string;
  date: Date;
  /** False for the leading and trailing days borrowed from the months either side. */
  inMonth: boolean;
  isToday: boolean;
}

/**
 * A month as six weeks of seven days, Sunday first, padded from the
 * neighbouring months so every row is full. Six weeks always, rather than five
 * or six depending on the month, because a grid that changes height as you page
 * through it makes the whole page jump.
 */
export function monthGrid(year: number, month: number, now: number): CalendarDay[] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const todayKey = dayKey(now);

  const days: CalendarDay[] = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = dayKey(date.getTime());
    days.push({
      key,
      date,
      inMonth: date.getMonth() === month,
      isToday: key === todayKey,
    });
  }
  return days;
}

export interface CalendarSummary {
  published: number;
  late: number;
  due: number;
  scheduled: number;
  /** Of the ones still to go out, how many have nothing written in them. */
  emptyAhead: number;
}

/** What a month adds up to, for the line above the grid. */
export function summarise(entries: readonly CalendarEntry[]): CalendarSummary {
  const summary: CalendarSummary = {
    published: 0,
    late: 0,
    due: 0,
    scheduled: 0,
    emptyAhead: 0,
  };
  for (const entry of entries) {
    summary[entry.state] += 1;
    if (entry.state !== "published" && entry.empty) summary.emptyAhead += 1;
  }
  return summary;
}

/** Entries falling inside one calendar month, in the order they happen. */
export function entriesForMonth(
  entries: readonly CalendarEntry[],
  year: number,
  month: number,
): CalendarEntry[] {
  return entries.filter((e) => {
    const d = new Date(e.at);
    return d.getFullYear() === year && d.getMonth() === month;
  });
}
