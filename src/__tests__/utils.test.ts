import { describe, it, expect, vi, afterEach } from "vitest";
import {
  generateId,
  truncateLines,
  formatSnippetPreview,
  formatDate,
  debounce,
} from "@/lib/utils";

describe("generateId", () => {
  it("returns a string of length 12", () => {
    const id = generateId();
    expect(typeof id).toBe("string");
    expect(id).toHaveLength(12);
  });

  it("returns unique values on successive calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

describe("truncateLines", () => {
  it("returns empty string for empty input", () => {
    expect(truncateLines("", 5)).toBe("");
  });

  it("returns full text when under maxLines", () => {
    const text = "line1\nline2\nline3";
    expect(truncateLines(text, 5)).toBe(text);
  });

  it("returns full text when exactly at maxLines", () => {
    const text = "a\nb\nc";
    expect(truncateLines(text, 3)).toBe(text);
  });

  it("truncates text exceeding maxLines and appends ellipsis", () => {
    const text = "a\nb\nc\nd\ne";
    expect(truncateLines(text, 3)).toBe("a\nb\nc...");
  });

  it("handles single line input", () => {
    expect(truncateLines("hello", 1)).toBe("hello");
  });
});

describe("formatSnippetPreview", () => {
  it("returns all lines when snippet has six lines or fewer", () => {
    const text = "1\n2\n3\n4\n5\n6";
    expect(formatSnippetPreview(text)).toBe(text);
  });

  it("returns first three and last three lines with middle ellipsis when over six lines", () => {
    const text = "1\n2\n3\n4\n5\n6\n7\n8";
    expect(formatSnippetPreview(text)).toBe("1\n2\n3\n...\n6\n7\n8");
  });

  it("handles empty input", () => {
    expect(formatSnippetPreview("")).toBe("");
  });
});

describe("formatDate", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "Just now" for timestamps within 60 seconds', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    expect(formatDate(now - 30_000)).toBe("Just now");
  });

  it('returns "Xm ago" for timestamps within the hour', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    expect(formatDate(now - 5 * 60_000)).toBe("5m ago");
  });

  it('returns "Xh ago" for timestamps within the day', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    expect(formatDate(now - 3 * 3_600_000)).toBe("3h ago");
  });

  it("returns a date string for older timestamps in the same year", () => {
    vi.useFakeTimers();
    // Set to mid-year so we can test a date earlier in the year
    const now = new Date(2026, 5, 15).getTime();
    vi.setSystemTime(now);
    const jan15 = new Date(2026, 0, 15).getTime();
    const result = formatDate(jan15);
    expect(result).toMatch(/Jan 15/);
    expect(result).not.toMatch(/2026/);
  });

  it("includes the year for timestamps from a different year", () => {
    vi.useFakeTimers();
    const now = new Date(2026, 5, 15).getTime();
    vi.setSystemTime(now);
    const lastYear = new Date(2025, 3, 10).getTime();
    const result = formatDate(lastYear);
    expect(result).toMatch(/2025/);
  });
});

describe("debounce", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls the function after the delay", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 200);

    debounced("a");
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledWith("a");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("resets the timer on repeated calls", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 200);

    debounced("a");
    vi.advanceTimersByTime(100);
    debounced("b");
    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledWith("b");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
