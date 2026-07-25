export { PUBLISH_PLATFORMS } from "./platform";
export type { PublishPlatform } from "./platform";

export { markdownToCleanHtml, markdownToPlainText } from "./markdown";

export { buildClipboardPayload, copyForPlatform } from "./clipboard";
export type { ClipboardPayload } from "./clipboard";

export { buildComposerUrl, openComposer } from "./composer";
export type { ComposerPlatform, TweetComposerOptions, SubstackComposerOptions } from "./composer";

export {
  TWEET_CHAR_LIMIT,
  LINKEDIN_CHAR_LIMIT,
  SUBSTACK_NOTES_SOFT_LIMIT,
  PLATFORM_CHAR_LIMITS,
  charCount,
  countTweetThread,
} from "./limits";
export type { TweetSegmentCount } from "./limits";

export { escapeLinkedInReserved } from "./linkedin";

export {
  parseSubstackFeed,
  parseFeedItemsRegex,
  fuzzyTitleMatch,
  isValidFeedHost,
  publishPendingState,
} from "./substack-verify";
export type { FeedItem, PublishPendingState } from "./substack-verify";
