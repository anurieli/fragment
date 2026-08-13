import type { ContentFormat } from "@/lib/content-engine/contract";
import { formatLabel } from "@/lib/format-labels";

// Hostname suffix -> the name a person would use for that place. Suffix rather
// than exact match because a Substack lives at <pub>.substack.com and a
// self-hosted one at a custom domain, and LinkedIn has country hosts.
const HOST_NAMES: readonly { suffix: string; name: string }[] = [
  { suffix: "substack.com", name: "Substack" },
  { suffix: "linkedin.com", name: "LinkedIn" },
  { suffix: "x.com", name: "X" },
  { suffix: "twitter.com", name: "X" },
  { suffix: "kit.com", name: "Kit" },
  { suffix: "convertkit.com", name: "Kit" },
  { suffix: "beehiiv.com", name: "beehiiv" },
  { suffix: "medium.com", name: "Medium" },
  { suffix: "ghost.io", name: "Ghost" },
];

// The three ContentFormat values that name a real destination. essay, script
// and other describe a shape of writing, not a place it can go.
const PLATFORM_FORMATS: readonly ContentFormat[] = ["substack", "linkedin", "tweet"];

/**
 * Where a published piece went, named as a place, or null when nothing in the
 * record names one.
 *
 * The URL is the authority, because `PublishRecord.platform` holds a
 * `ContentFormat` and a format is not a destination: a long-form draft published
 * to Substack has the format `essay`, so trusting that field renders "Published
 * to Essay", which names nothing a reader can go to. A known host becomes its
 * product's name; anything else stays a bare hostname, which is still a place.
 *
 * With no URL, the format only helps for the three values that happen to be
 * platforms. Null otherwise, so the receipt shows just the date instead of
 * inventing a location.
 *
 * (The real fix is a destination stored independently of format, which is what
 * the publishTargets work adds. This stops the current field from lying.)
 */
export function destinationLabel(url: string | undefined, platform: ContentFormat): string | null {
  if (url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
      const known = HOST_NAMES.find((h) => host === h.suffix || host.endsWith(`.${h.suffix}`));
      if (known) return known.name;
      if (host) return host;
    } catch {
      // A URL we cannot parse is still a publish record worth showing, so fall
      // through to the format rather than dropping the whole receipt.
    }
  }
  return PLATFORM_FORMATS.includes(platform) ? formatLabel(platform) : null;
}
