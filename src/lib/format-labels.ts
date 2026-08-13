import type { ContentFormat } from "@/lib/content-engine";

// Human labels for a fragment's authoring format. Lives here rather than in a
// component because more than one surface names a format now: the feed card's
// platform chip, and the publish receipt that says where a published fragment
// went (PublishRecord.platform is a ContentFormat).
export const FORMAT_LABELS: Record<ContentFormat, string> = {
  tweet: "X",
  linkedin: "LinkedIn",
  substack: "Substack",
  essay: "Essay",
  script: "Script",
  other: "Other",
};

export function formatLabel(format: ContentFormat): string {
  return FORMAT_LABELS[format];
}
