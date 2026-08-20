export { PUBLISH_PLATFORMS } from "./platform";
export type { PublishPlatform } from "./platform";

export { markdownToCleanHtml, markdownToPlainText, markdownToPreviewHtml } from "./markdown";

export { preserveEmptyParagraphs, preserveWhitespace } from "./whitespace";

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

export { destinationLabel } from "./destination-label";

export {
  parseSubstackFeed,
  parseFeedItemsRegex,
  fuzzyTitleMatch,
  isValidFeedHost,
  publishPendingState,
} from "./substack-verify";
export type { FeedItem, PublishPendingState } from "./substack-verify";

export {
  buildKitBroadcastRequest,
  createKitBroadcast,
  kitErrorMessage,
  deriveKitSubject,
  isKitEligibleFormat,
  canPublishToKit,
  KitApiError,
} from "./kit";
export type {
  CreateKitBroadcastOptions,
  KitBroadcastRequest,
  KitBroadcastResult,
  KitErrorKind,
} from "./kit";
