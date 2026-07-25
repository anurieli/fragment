import type { ReviewReturn } from "@/lib/types";
import { reviewReturnSchema } from "./schema";

/**
 * Parses and validates the contents of a `.fragment-review.json` file (the
 * payload a reviewer downloads from the standalone review page and sends
 * back). Throws a descriptive `Error` if `json` is not valid JSON, or if it
 * doesn't match the expected shape.
 */
export function parseReviewReturn(json: string): ReviewReturn {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("Not a valid review file — the JSON could not be parsed.");
  }

  const result = reviewReturnSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Not a valid review file — ${issues}`);
  }

  return result.data;
}
