import type { Priority } from "@/lib/content-engine";

/**
 * How a priority looks wherever it is shown: the word for it, and the colour
 * that carries it at a glance.
 *
 * One table, because the colour is the whole signal. Red meaning urgent on a
 * card and gold meaning urgent in a list would make the flag decorative, and
 * a decorative flag is worse than none: it costs a glance and returns
 * nothing. 0 has no entry on purpose, since content with "no priority" has
 * no flag; the picker gives that clearing action its own neutral flag below.
 */
export const PRIORITY_META: Record<1 | 2 | 3 | 4, { label: string; className: string }> = {
  1: { label: "Urgent", className: "text-red" },
  2: { label: "High", className: "text-red/75" },
  3: { label: "Medium", className: "text-orange-400" },
  4: { label: "Low", className: "text-yellow-400" },
};

/** The picker choices from neutral through increasingly urgent. */
export const PRIORITY_OPTIONS: readonly {
  value: Priority;
  label: string;
  className: string;
}[] = [
  { value: 0, label: "No priority", className: "text-text-faint" },
  { value: 4, ...PRIORITY_META[4] },
  { value: 3, ...PRIORITY_META[3] },
  { value: 2, ...PRIORITY_META[2] },
  { value: 1, ...PRIORITY_META[1] },
];

/** The row for a priority, or null when there is nothing to show. */
export function priorityMeta(
  priority: Priority,
): { label: string; className: string } | null {
  return priority === 0 ? null : PRIORITY_META[priority];
}
