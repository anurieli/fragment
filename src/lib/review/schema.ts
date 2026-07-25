import { z } from "zod";

/**
 * Zod schema for a single reviewer comment inside a `.fragment-review.json`
 * file. Mirrors `ReviewComment` in `@/lib/types`. `anchorText` is allowed to
 * be empty — that's how the standalone review page represents a note-level
 * (general) comment rather than one anchored to a text selection.
 */
export const reviewCommentSchema = z.object({
  id: z.string().min(1, "comment id is required"),
  anchorText: z.string(),
  prefix: z.string(),
  suffix: z.string(),
  body: z.string().min(1, "comment body cannot be empty"),
});

/**
 * Zod schema for the full contents of a `.fragment-review.json` file — the
 * payload the standalone review page downloads when a reviewer hits
 * "Send back". Mirrors `ReviewReturn` in `@/lib/types`.
 */
export const reviewReturnSchema = z.object({
  docId: z.string().min(1, "docId is required"),
  reviewerName: z.string(),
  timestamp: z.number(),
  comments: z.array(reviewCommentSchema),
  editedFullText: z.string().optional(),
});

export type ReviewCommentInput = z.infer<typeof reviewCommentSchema>;
export type ReviewReturnInput = z.infer<typeof reviewReturnSchema>;
