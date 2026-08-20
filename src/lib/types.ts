import type { AIProvider } from "./providers";

export type { AIProvider } from "./providers";

export interface Note {
  id: string;
  title: string;
  /** One-line dek shown under the title in the editor. Optional for pre-existing notes. */
  subtitle?: string;
  content: string;
  goal: string;
  audience: string;
  tone: string;
  remember: string;
  /** undefined = inherit default voice, null = explicitly no voice, string = specific voice id. */
  voiceId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Snippet {
  id: string;
  /**
   * Retired. The note this snippet was cut from, before fragments held their
   * own text. Kept so snips written before the one-entity migration can still
   * be traced back, and so the migration has something to re-key from. New
   * snips set `pieceId` instead and leave this null.
   */
  noteId: string | null;
  content: string;
  label: string | null;
  labelStatus: "idle" | "loading" | "done" | "error";
  createdAt: number;
  order: number;
  /** The idea this snippet belongs to. Optional — existing rows are not backfilled. */
  ideaId?: string;
  /** The fragment this snippet was cut from, once fragments hold their own
   * text. Replaces noteId; both are present during the migration window. */
  pieceId?: string;
}

/**
 * A single note-first comment left against a note or an idea. Exactly one of
 * `noteId` / `ideaId` is set — whichever surface was active when it was
 * written (see commentHome in comment-scope.ts) — mirroring the two-home shape
 * of Snippet.noteId/ideaId, but without a snippet's dual-carry: a comment
 * has one home for its whole life.
 *
 * `promotedIdeaId` is set once "Turn into an idea" fires. The comment stays
 * in place — this is a forward pointer to the Idea it seeded, not a move.
 */
export interface Comment {
  id: string;
  pieceId: string | null;
  ideaId: string | null;
  body: string;
  createdAt: number;
  updatedAt: number;
  promotedIdeaId: string | null;
}

export type VersionTrigger = "manual" | "export-md" | "export-html" | "download-md" | "download-html" | "download-pdf" | "download-docx";

export interface NoteVersion {
  id: string;
  noteId: string;
  title: string;
  /** Snapshot of the note's subtitle (see Note.subtitle). */
  subtitle?: string;
  content: string;
  goal: string;
  audience: string;
  tone: string;
  remember: string;
  /** Snapshot of the note's voice selection (see Note.voiceId). */
  voiceId?: string | null;
  name: string;
  trigger: VersionTrigger;
  wordCount: number;
  createdAt: number;
}

/**
 * A version snapshot of a fragment.
 *
 * The same record as NoteVersion, keyed to the fragment that now holds the
 * text rather than to a note. Rows carried over by the one-entity migration
 * keep `legacyNoteId` so the timeline of a fragment that used to be a note is
 * continuous rather than starting over on migration day.
 */
export interface PieceVersion {
  id: string;
  pieceId: string;
  legacyNoteId?: string;
  title: string;
  subtitle?: string;
  content: string;
  goal: string;
  audience: string;
  tone: string;
  remember: string;
  voiceId?: string | null;
  name: string;
  trigger: VersionTrigger;
  wordCount: number;
  createdAt: number;
}

export type MigrationStatus = "running" | "complete" | "failed";

/**
 * Bookkeeping for a one-off data migration.
 *
 * Local-only and never synced: whether *this device* has finished reshaping
 * its own copy is not a fact other devices need, and syncing it would let one
 * device's failure look like everyone's.
 */
export interface MigrationRecord {
  id: string;
  status: MigrationStatus;
  startedAt: number;
  finishedAt?: number;
  /** Plan counts, so a support conversation can start from what was attempted. */
  counts?: Record<string, number>;
  /** Why the verification gate refused, when it did. */
  failures?: { code: string; subject: string; detail: string }[];
  /** Id of the pre-migration snapshot taken before this attempt. */
  snapshotId?: string;
}

export interface FeatureProviderConfig {
  provider: AIProvider;
  model: string;
  modelsByProvider?: Partial<Record<AIProvider, string>>;
}

export interface AIProcessSettings {
  enabled: boolean;
  promptTemplate: string;
}

export interface SnippetLabelingSettings extends AIProcessSettings {
  maxEssayContext: number;
}

export interface SlashCommandSettings extends AIProcessSettings {
  maxContextAbove: number;
  maxContextBelow: number;
}

export interface InlineEditSettings extends AIProcessSettings {
  maxContextChars: number;
}

/** The idea extractor has no context window of its own to tune: it reads the
 * whole idea by definition, and the ceiling on that lives in lib/agents/extract.ts
 * where the source is assembled. */
export type IdeaExtractorSettings = AIProcessSettings;

export interface ProviderModel {
  id: string;
  name: string;
  provider: string;
}

export interface ProviderCredentials {
  openRouterApiKey: string;
  openAiApiKey: string;
  anthropicApiKey: string;
  perplexityApiKey: string;
  codexAccessToken: string;
  codexRefreshToken: string;
}

export interface UserProfile {
  displayName: string;
  bio: string;
  website: string;
  twitterHandle: string;
  linkedinUrl: string;
  location: string;
  email: string;
  writingTypes: string[];
  role: string;
  /** Publication base URL, e.g. "https://myblog.substack.com" — powers the
   * "Open Substack editor" / "Publish to Substack" composer links and the
   * RSS feed the verified-publish loop polls for a title match. */
  substackPublicationUrl: string;
  /** Kit (formerly ConvertKit) v4 API key — powers "Publish to Kit (draft)"
   * / "Schedule on Kit" in the Share menu and Publish menu. BYO key, same
   * storage path as the rest of `userProfile` (Dexie `settings` table, not
   * localStorage). See src/lib/publish/kit.ts. */
  kitApiKey: string;
  /** Composio API key — BYO key, powers one-click "Publish to LinkedIn".
   * Composio hosts the LinkedIn OAuth grant and stores the resulting
   * token itself; Fragment only ever holds this key plus the resulting
   * `linkedInConnectedAccountId`. Set from Settings → Integrations. See
   * src/lib/composio/linkedin.ts. */
  composioApiKey: string;
  /** The Composio `connected_account_id` returned once the user completes
   * the LinkedIn Connect Link flow. Empty string = not connected. Cleared
   * locally on "Disconnect" — does not revoke the connection at Composio. */
  linkedInConnectedAccountId: string;
}

export interface WritingStyleSettings {
  voiceDescription: string;
}

/**
 * Compact, distilled representation of a Brand Voice — the only piece that
 * rides along per generation (injected as a system message). Produced by the
 * one-shot voice analysis; never contains raw samples.
 */
export interface VoiceProfile {
  summary: string;            // <=450 chars
  traits: string[];           // <=7, <=90 chars each
  exampleExcerpts: string[];  // 3-5 verbatim quotes, <=320 chars each
  doGuidance: string[];       // <=5
  dontGuidance: string[];     // <=5
}

/** A named writing voice. Stored in the `voices` Dexie table (never localStorage). */
export interface BrandVoice {
  id: string;
  name: string;
  /** User-written; feeds analysis and is the pre-analysis fallback context. */
  description: string;
  /** Structure guide, injected verbatim into generation prompts. */
  template: string;
  /**
   * The brief this voice writes to by default. A voice is a persona, and a
   * persona already implies who it is talking to and how it sounds, so these
   * travel with it: pick the voice and the audience and tone come along.
   * Inherited by ideas and fragments that have not set their own — see
   * resolveBrief in lib/brief-context.ts. Goal is deliberately absent: what a
   * given piece is trying to achieve is the piece's business, not the persona's.
   */
  defaultAudience?: string;
  defaultTone?: string;
  defaultRemember?: string;
  profile: VoiceProfile | null;
  profileStale: boolean;
  profileUpdatedAt: number | null;
  analyzedSampleCount: number;
  createdAt: number;
  updatedAt: number;
}

/** Raw writing sample for a voice. Stored in the `voiceSamples` Dexie table. */
export interface VoiceSample {
  id: string;
  voiceId: string;
  title: string;
  source: "paste" | "file";
  text: string;
  charCount: number;
  createdAt: number;
}

/**
 * Scalars only — lives in the settings blob (and thus the localStorage shadow).
 * The BrandVoice[] themselves live in IndexedDB via the voice store.
 */
export interface BrandVoiceSettings {
  defaultVoiceId: string | null;
  analysisPromptTemplate: string;
  migratedFromWritingStyle: boolean;
}

export interface CustomStylePreset {
  id: string;
  label: string;
  description: string;
}

export interface ImageGenerationSettings {
  themeDescription: string;
  stylePreset: string;
  customPresets: CustomStylePreset[];
}

export interface StoredImage {
  id: string;
  noteId: string;
  blob: Blob;
  mimeType: string;
  filename: string;
  width: number;
  height: number;
  createdAt: number;
}

export type ApiLogRoute = "label" | "generate" | "edit" | "analyze";
export type ApiLogStatus = "success" | "error";
export type ApiLogFieldSampleMode = "full" | "head" | "tail" | "head-tail";

export interface ApiLogFieldSnapshot {
  key: string;
  length: number;
  sample: string;
  sampleMode: ApiLogFieldSampleMode;
  truncated: boolean;
}

export interface ApiLogRequestSnapshot {
  requestId: string;
  modelRequested: string;
  promptTemplate: ApiLogFieldSnapshot;
  fields: ApiLogFieldSnapshot[];
}

export interface ApiLog {
  id: string;
  noteId?: string;
  timestamp: number;
  route: ApiLogRoute;
  caller: string;
  provider: string;
  model: string;
  status: ApiLogStatus;
  statusCode: number;
  error?: string;
  durationMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost?: number;
  promptLength: number;
  responseLength: number;
  request?: ApiLogRequestSnapshot;
  synced?: boolean;
}

export type FeedbackType = "bug" | "feature" | "feedback";

export interface FeedbackMetadata {
  appVersion: string;
  platform: string;
  userAgent: string;
  timestamp: string;
  screenResolution: string;
  activePieceId?: string;
}

export interface FeedbackSubmission {
  id: string;
  type: FeedbackType;
  message: string;
  screenshot?: Blob;
  screenRecording?: Blob;
  voiceNote?: Blob;
  metadata: FeedbackMetadata;
}

/** Stored in Dexie — same as FeedbackSubmission but with a submission status. */
export interface FeedbackQueueItem extends FeedbackSubmission {
  status: "pending" | "submitted" | "failed";
  createdAt: number;
  submittedAt?: number;
  errorMessage?: string;
}

/**
 * A single reviewer comment, as produced by the standalone review page and
 * round-tripped through the `.fragment-review.json` file. `anchorText` empty
 * means a note-level (general) comment rather than one anchored to a text
 * selection. `prefix`/`suffix` are short slices of surrounding plain text
 * used to disambiguate duplicate `anchorText` occurrences (see
 * `anchorComments`).
 */
export interface ReviewComment {
  id: string;
  anchorText: string;
  prefix: string;
  suffix: string;
  body: string;
}

/** Parsed, validated contents of a `.fragment-review.json` file. */
export interface ReviewReturn {
  docId: string;
  reviewerName: string;
  timestamp: number;
  comments: ReviewComment[];
  editedFullText?: string;
  /** Hosted reviews only — the guest's email, for grouping duplicate sessions
   * from the same reviewer in the ReviewPanel. Never set for emailed/imported
   * `.fragment-review.json` files, which carry no verified address. */
  reviewerEmail?: string;
}

/** A `ReviewReturn` persisted to the `reviews` Dexie table after import. */
export interface StoredReview extends ReviewReturn {
  id: string;
  noteId: string;
  /** The fragment this review is about. Replaces noteId; both are present
   * during the migration window so old share links keep resolving. */
  pieceId?: string;
  /** When this review file was imported into Fragment (not the reviewer's own timestamp). */
  receivedAt: number;
}

/**
 * A local change waiting to be pushed to the cloud.
 *
 * The entry stamps its own `updatedAt` at write time rather than reading one
 * off the record, because not every synced type carries one — a Snippet has
 * `createdAt` and `order` and nothing else. "When this device last touched
 * it" is the value last-write-wins actually needs, and it is well defined for
 * every collection including deletions, which leave no record behind to read.
 */
export interface OutboxEntry {
  /** Dexie table name, matching a SyncedCollection. */
  collection: string;
  id: string;
  updatedAt: number;
  /** A tombstone: the row is gone locally and must be removed on the server. */
  deleted: boolean;
}

/** Sync bookkeeping. One row, id "main". */
export interface SyncStateRow {
  id: string;
  /** Highest server rev applied. 0 means nothing has ever synced. */
  cursor: number;
  lastSyncedAt: number | null;
  /**
   * The account this device's local data belongs to, once it has been linked.
   *
   * Recorded so that signing in as somebody else on a shared browser cannot
   * quietly upload the previous person's writing into the new account. On a
   * mismatch the engine stops rather than guessing whose data it is holding.
   */
  userId: string | null;
}

export interface AppSettings {
  id: string;
  providerCredentials: ProviderCredentials;
  /**
   * Codex model allowlist: which model IDs from the signed-in ChatGPT account
   * show up as options in model pickers. Empty = all available models.
   */
  codexEnabledModels: string[];
  featureProviders: {
    snippetLabeling: FeatureProviderConfig;
    slashCommand: FeatureProviderConfig;
    inlineEdit: FeatureProviderConfig;
    ideaExtractor: FeatureProviderConfig;
  };
  userProfile: UserProfile;
  writingStyle: WritingStyleSettings;
  brandVoice: BrandVoiceSettings;
  imageGeneration: ImageGenerationSettings;
  snippetLabeling: SnippetLabelingSettings;
  slashCommand: SlashCommandSettings;
  inlineEdit: InlineEditSettings;
  ideaExtractor: IdeaExtractorSettings;
}

