import { nanoid } from "nanoid";

export function generateId(): string {
  return nanoid(12);
}

export function truncateLines(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join("\n") + "...";
}

export function formatSnippetPreview(text: string): string {
  const lines = text.split("\n");
  if (lines.length <= 6) return text;
  return [...lines.slice(0, 3), "...", ...lines.slice(-3)].join("\n");
}

export type DebouncedFn<T extends (...args: never[]) => void> = ((
  ...args: Parameters<T>
) => void) & { flush: () => void };

export function debounce<T extends (...args: never[]) => void>(
  fn: T,
  ms: number,
): DebouncedFn<T> {
  let timer: ReturnType<typeof setTimeout>;
  let pendingArgs: Parameters<T> | null = null;
  const debounced = (...args: Parameters<T>) => {
    clearTimeout(timer);
    pendingArgs = args;
    timer = setTimeout(() => {
      pendingArgs = null;
      fn(...args);
    }, ms);
  };
  debounced.flush = () => {
    if (pendingArgs !== null) {
      clearTimeout(timer);
      const args = pendingArgs;
      pendingArgs = null;
      fn(...args);
    }
  };
  return debounced;
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();

  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;

  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
