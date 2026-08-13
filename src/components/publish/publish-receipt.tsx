"use client";

import { ExternalLink } from "lucide-react";
import type { PublishRecord } from "@/lib/content-engine";
import { formatLabel } from "@/lib/format-labels";
import { formatDate } from "@/lib/utils";

interface PublishReceiptProps {
  publish: PublishRecord;
  /** "pill" sits in the feed card's meta row; "line" is a menu header row. */
  variant?: "pill" | "line";
}

/**
 * Where a published piece went, and when.
 *
 * `PublishRecord` has carried `url` and `publishedAt` since the publish loop
 * shipped and nothing rendered either of them, so a piece could be marked
 * published and still not tell you where it lived. Renders as a link whenever a
 * URL is on file (every verified Substack match, and any manual mark given one)
 * and as plain text when it isn't, because "published, no URL" is a real and
 * legitimate state rather than an error.
 */
export function PublishReceipt({ publish, variant = "pill" }: PublishReceiptProps) {
  const where = formatLabel(publish.platform);
  const exact = new Date(publish.publishedAt).toLocaleString();
  const title = publish.url
    ? `Published to ${where} on ${exact}. Opens in a new tab.`
    : `Published to ${where} on ${exact}. No URL on file.`;

  const label = (
    <>
      {variant === "line" ? `Live on ${where}` : where}
      <span className="opacity-60"> · {formatDate(publish.publishedAt)}</span>
      {publish.url && <ExternalLink size={variant === "line" ? 11 : 9} className="shrink-0 opacity-70" />}
    </>
  );

  const className =
    variant === "line"
      ? "flex items-center gap-1.5 w-full px-4 py-2 text-[11px] text-green"
      : "inline-flex items-center gap-1 text-[10px] font-[family-name:var(--font-mono)] uppercase tracking-wider text-green px-1.5 py-0.5 rounded-[4px] bg-green/10 border border-green/30";

  if (!publish.url) {
    return (
      <span title={title} className={className}>
        {label}
      </span>
    );
  }

  return (
    <a
      href={publish.url}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      onClick={(e) => e.stopPropagation()}
      className={`${className} hover:underline`}
    >
      {label}
    </a>
  );
}
