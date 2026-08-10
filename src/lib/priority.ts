import type { Priority } from "@/lib/content-engine";

/**
 * How a priority looks wherever it is shown: the word for it, and the colour
 * that carries it at a glance.
 *
 * One table, because the colour is the whole signal. Red meaning urgent on a
 * card and gold meaning urgent in a list would make the flag decorative, and
 * a decorative flag is worse than none: it costs a glance and returns
 * nothing. 0 has no entry on purpose, since "no priority" has nothing to
 * show and every surface treats it by showing no flag at all.
 */
export const PRIORITY_META: Record<1 | 2 | 3 | 4, { label: string; className: string }> = {
  1: { label: "Urgent", className: "text-red" },
  2: { label: "High", className: "text-gold" },
  3: { label: "Medium", className: "text-blue" },
  4: { label: "Low", className: "text-text-muted" },
};

/** The choices any "Set priority" menu offers, in the order they read: most
 * urgent first, with the way out of the decision last. */
export const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 1, label: "Urgent" },
  { value: 2, label: "High" },
  { value: 3, label: "Medium" },
  { value: 4, label: "Low" },
  { value: 0, label: "No priority" },
];

/** The row for a priority, or null when there is nothing to show. */
export function priorityMeta(
  priority: Priority,
): { label: string; className: string } | null {
  return priority === 0 ? null : PRIORITY_META[priority];
}
