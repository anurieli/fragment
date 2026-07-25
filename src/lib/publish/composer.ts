// Web intent / composer-launch helpers. Only tweet (X) and substack have a
// web compose intent worth wiring up here; linkedin has no equivalent
// unauthenticated compose URL and Medium is out of scope for this feature.

export interface TweetComposerOptions {
  /** Raw tweet text. URL-encoded by buildComposerUrl; pass it unescaped. */
  text: string;
}

export interface SubstackComposerOptions {
  /** The publication's base URL, e.g. "https://myblog.substack.com". A
   * trailing slash is tolerated and stripped. */
  publicationUrl: string;
}

export type ComposerPlatform = "tweet" | "substack";

/**
 * Pure URL builder for the two web compose intents this module supports.
 * No I/O — safe to unit test directly. `openComposer` is the thin
 * `window.open` wrapper around this.
 */
export function buildComposerUrl(platform: "tweet", opts: TweetComposerOptions): string;
export function buildComposerUrl(platform: "substack", opts: SubstackComposerOptions): string;
export function buildComposerUrl(
  platform: ComposerPlatform,
  opts: TweetComposerOptions | SubstackComposerOptions,
): string {
  if (platform === "tweet") {
    const { text } = opts as TweetComposerOptions;
    return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
  }

  const { publicationUrl } = opts as SubstackComposerOptions;
  const base = publicationUrl.replace(/\/+$/, "");
  return `${base}/publish/post?type=newsletter`;
}

/** Opens the platform's web compose intent in a new tab. */
export function openComposer(platform: "tweet", opts: TweetComposerOptions): void;
export function openComposer(platform: "substack", opts: SubstackComposerOptions): void;
export function openComposer(
  platform: ComposerPlatform,
  opts: TweetComposerOptions | SubstackComposerOptions,
): void {
  const url =
    platform === "tweet"
      ? buildComposerUrl("tweet", opts as TweetComposerOptions)
      : buildComposerUrl("substack", opts as SubstackComposerOptions);
  window.open(url, "_blank", "noopener,noreferrer");
}
