"use client";

import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useContentStore } from "@/stores/content-store";
import { isLongformFormat, type ContentPiece } from "@/lib/content-engine";
import {
  bucketByDay,
  calendarEntries,
  entriesForMonth,
  monthGrid,
  summarise,
  type CalendarEntry,
  type ScheduleState,
} from "@/lib/calendar/schedule";
import { markdownToPlainText } from "@/lib/publish";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** One colour per answer to "did this go out". Late is the only alarming one. */
const STATE_STYLE: Record<ScheduleState, string> = {
  published: "bg-green/15 text-green border-green/30",
  late: "bg-red-muted text-red border-red/30",
  due: "bg-gold-muted text-gold border-gold/40",
  scheduled: "bg-surface-3 text-text-secondary border-border-strong",
};

const STATE_WORD: Record<ScheduleState, string> = {
  published: "published",
  late: "late, nothing published",
  due: "due today",
  scheduled: "scheduled",
};

function pieceLabel(piece: ContentPiece): string {
  if (piece.title?.trim()) return piece.title.trim();
  const firstLine = markdownToPlainText(piece.body)
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  // "Untitled", not "Empty": whether there is anything written is a separate
  // fact the chip states on its own line, and saying it twice in two different
  // words reads as two different problems.
  return firstLine || "Untitled";
}

function timeLabel(at: number): string {
  const d = new Date(at);
  const h24 = d.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const m = d.getMinutes();
  return m === 0
    ? `${h12}${h24 < 12 ? "am" : "pm"}`
    : `${h12}:${String(m).padStart(2, "0")}${h24 < 12 ? "am" : "pm"}`;
}

/**
 * What is going out, and what went out.
 *
 * Fragment could already schedule a piece for a time, and could already record
 * that one went live, but the two facts only ever appeared on the piece itself.
 * You could not ask the question a schedule exists to answer: is next week
 * covered, and did last week actually happen.
 *
 * Nothing here posts anything. A date on this grid is an intention, and the
 * calendar's job is to be honest about which intentions were kept.
 */
export function ContentCalendar({ onClose }: { onClose: () => void }) {
  const pieces = useContentStore((s) => s.pieces);
  const setActivePiece = useAppStore((s) => s.setActivePiece);
  const setActiveIdea = useAppStore((s) => s.setActiveIdea);
  const setIdeaSpace = useAppStore((s) => s.setIdeaSpace);

  // Read once per open. A calendar that reshuffles under the pointer because a
  // minute passed is worse than one that is a minute stale.
  const [now] = useState(() => Date.now());
  const [cursor, setCursor] = useState(() => {
    const d = new Date(now);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const all = useMemo(() => calendarEntries(Object.values(pieces), now), [pieces, now]);
  const inMonth = useMemo(
    () => entriesForMonth(all, cursor.year, cursor.month),
    [all, cursor],
  );
  const buckets = useMemo(() => bucketByDay(inMonth), [inMonth]);
  const grid = useMemo(() => monthGrid(cursor.year, cursor.month, now), [cursor, now]);
  const summary = useMemo(() => summarise(inMonth), [inMonth]);

  function step(by: number) {
    setCursor((c) => {
      const d = new Date(c.year, c.month + by, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  function open(piece: ContentPiece) {
    setActiveIdea(piece.ideaId);
    setIdeaSpace(piece.ideaId, isLongformFormat(piece.format) ? "write" : "pieces");
    setActivePiece(piece.id);
    onClose();
  }

  const isThisMonth =
    cursor.year === new Date(now).getFullYear() && cursor.month === new Date(now).getMonth();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgba(12,12,11,0.7)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[1000px] max-h-[88vh] flex flex-col bg-surface border border-border-strong rounded-[var(--radius-lg)] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Calendar"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <CalendarDays size={15} className="text-text-muted shrink-0" />
            <span className="text-[13px] text-text-primary font-medium">Calendar</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => step(-1)}
              aria-label="Previous month"
              className="p-1.5 rounded-[var(--radius-sm)] text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors duration-150"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="min-w-[150px] text-center text-[12px] text-text-primary font-[family-name:var(--font-display)]">
              {MONTH_NAMES[cursor.month]} {cursor.year}
            </span>
            <button
              onClick={() => step(1)}
              aria-label="Next month"
              className="p-1.5 rounded-[var(--radius-sm)] text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors duration-150"
            >
              <ChevronRight size={14} />
            </button>
            {!isThisMonth && (
              <button
                onClick={() => {
                  const d = new Date(now);
                  setCursor({ year: d.getFullYear(), month: d.getMonth() });
                }}
                className="ml-2 px-2 py-1 rounded-[var(--radius-sm)] text-[10px] text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors duration-150"
              >
                Today
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Close"
              className="ml-2 p-1.5 rounded-[var(--radius-sm)] text-text-faint hover:text-text-secondary transition-colors duration-150"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* What the month adds up to */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 border-b border-border text-[11px] shrink-0">
          <Count n={summary.published} label="published" className="text-green" />
          <Count n={summary.late} label="late" className="text-red" />
          <Count n={summary.due} label="due today" className="text-gold" />
          <Count n={summary.scheduled} label="still ahead" className="text-text-muted" />
          {summary.emptyAhead > 0 && (
            <span className="text-text-faint">
              {summary.emptyAhead} with nothing written yet
            </span>
          )}
          {inMonth.length === 0 && (
            <span className="text-text-faint">
              Nothing on the calendar this month. A piece lands here once you schedule it or mark it published.
            </span>
          )}
        </div>

        {/* Weekday header */}
        <div className="grid grid-cols-7 border-b border-border shrink-0">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="px-2 py-1.5 text-[9px] text-text-faint font-[family-name:var(--font-mono)] uppercase tracking-wider text-center"
            >
              {d}
            </div>
          ))}
        </div>

        {/* The grid */}
        <div className="grid grid-cols-7 flex-1 overflow-y-auto">
          {grid.map((day) => {
            const entries = buckets.get(day.key) ?? [];
            return (
              <div
                key={day.key}
                className={`min-h-[92px] border-b border-r border-border p-1.5 ${
                  day.inMonth ? "" : "bg-surface-2/40"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={`text-[10px] font-[family-name:var(--font-mono)] ${
                      day.isToday
                        ? "text-gold font-medium"
                        : day.inMonth
                          ? "text-text-muted"
                          : "text-text-faint"
                    }`}
                  >
                    {day.date.getDate()}
                  </span>
                  {day.isToday && <span className="w-1 h-1 rounded-full bg-gold" />}
                </div>
                <div className="space-y-1">
                  {entries.map((entry) => (
                    <Chip key={entry.piece.id} entry={entry} onOpen={() => open(entry.piece)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Count({ n, label, className }: { n: number; label: string; className: string }) {
  if (n === 0) return null;
  return (
    <span className={className}>
      {n} {label}
    </span>
  );
}

function Chip({ entry, onOpen }: { entry: CalendarEntry; onOpen: () => void }) {
  const { piece, state, empty, at } = entry;
  return (
    <button
      onClick={onOpen}
      title={`${pieceLabel(piece)}: ${STATE_WORD[state]} at ${timeLabel(at)}${
        empty && state !== "published" ? ". Nothing written in it yet" : ""
      }`}
      className={`w-full text-left px-1.5 py-1 rounded-[var(--radius-sm)] border text-[10px] leading-tight transition-opacity duration-150 hover:opacity-80 ${STATE_STYLE[state]}`}
    >
      <span className="block truncate">{pieceLabel(piece)}</span>
      <span className="block truncate opacity-70 font-[family-name:var(--font-mono)] text-[9px]">
        {timeLabel(at)}
        {empty && state !== "published" && " · empty"}
      </span>
    </button>
  );
}
