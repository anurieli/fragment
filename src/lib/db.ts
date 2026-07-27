import Dexie, { type Table } from "dexie";
import type { Note, Snippet, AppSettings, NoteVersion, StoredImage, ApiLog, FeedbackQueueItem, BrandVoice, VoiceSample, StoredReview, OutboxEntry, SyncStateRow } from "./types";
import type { Idea, ContentPiece, Resource } from "./content-engine";

class FragmentDB extends Dexie {
  notes!: Table<Note, string>;
  snippets!: Table<Snippet, string>;
  settings!: Table<AppSettings, string>;
  noteVersions!: Table<NoteVersion, string>;
  images!: Table<StoredImage, string>;
  apiLogs!: Table<ApiLog, string>;
  feedbackQueue!: Table<FeedbackQueueItem, string>;
  voices!: Table<BrandVoice, string>;
  voiceSamples!: Table<VoiceSample, string>;
  ideas!: Table<Idea, string>;
  contentPieces!: Table<ContentPiece, string>;
  resources!: Table<Resource, string>;
  reviews!: Table<StoredReview, string>;
  outbox!: Table<OutboxEntry, [string, string]>;
  syncState!: Table<SyncStateRow, string>;

  constructor() {
    super("fragment");
    this.version(2).stores({
      notes: "id, updatedAt",
      snippets: "id, noteId, order",
      settings: "id",
    });
    this.version(3).stores({
      notes: "id, updatedAt",
      snippets: "id, noteId, order",
      settings: "id",
    }).upgrade((tx) => {
      return tx.table("settings").toCollection().modify((s) => {
        if ("geminiApiKey" in s) {
          s.openRouterApiKey = s.geminiApiKey as string;
          delete s.geminiApiKey;
        }
      });
    });
    this.version(4).stores({
      notes: "id, updatedAt",
      snippets: "id, noteId, order",
      settings: "id",
    }).upgrade((tx) => {
      return tx.table("settings").toCollection().modify((s) => {
        if (s.snippetLabeling && !s.snippetLabeling.provider) {
          s.snippetLabeling.provider = "openrouter";
        }
        if (s.slashCommand && !s.slashCommand.provider) {
          s.slashCommand.provider = "openrouter";
        }
      });
    });
    this.version(5).stores({
      notes: "id, updatedAt",
      snippets: "id, noteId, order",
      settings: "id",
    }).upgrade((tx) => {
      return tx.table("settings").toCollection().modify((s) => {
        if (!s.userProfile) {
          s.userProfile = {
            displayName: "",
            bio: "",
            website: "",
            twitterHandle: "",
            linkedinUrl: "",
            location: "",
          };
        }
        if (!s.writingStyle) {
          s.writingStyle = { voiceDescription: "" };
        }
        if (!s.imageGeneration) {
          s.imageGeneration = { themeDescription: "", stylePreset: "editorial" };
        }
        if (s.snippetLabeling) {
          s.snippetLabeling.maxEssayContext = 0;
        }
      });
    });
    this.version(6).stores({
      notes: "id, updatedAt",
      snippets: "id, noteId, order",
      settings: "id",
      noteVersions: "id, noteId, createdAt",
    });
    this.version(7).stores({
      notes: "id, updatedAt",
      snippets: "id, noteId, order",
      settings: "id",
      noteVersions: "id, noteId, createdAt",
      images: "id, noteId, createdAt",
    }).upgrade((tx) => {
      return tx.table("settings").toCollection().modify((s) => {
        if (s.imageGeneration && !s.imageGeneration.customPresets) {
          s.imageGeneration.customPresets = [];
        }
      });
    });
    this.version(8).stores({
      notes: "id, updatedAt",
      snippets: "id, noteId, order",
      settings: "id",
      noteVersions: "id, noteId, createdAt",
      images: "id, noteId, createdAt",
    }).upgrade((tx) => {
      return tx.table("settings").toCollection().modify((s) => {
        // Migrate openRouterApiKey into providerCredentials
        if (!s.providerCredentials) {
          s.providerCredentials = {
            openRouterApiKey: s.openRouterApiKey || "",
            codexAccessToken: "",
            codexRefreshToken: "",
          };
        }
        delete s.openRouterApiKey;

        // Extract provider+model from feature settings into featureProviders
        if (!s.featureProviders) {
          s.featureProviders = {
            snippetLabeling: {
              provider: s.snippetLabeling?.provider || "openrouter",
              model: s.snippetLabeling?.model || "google/gemini-2.0-flash-001",
            },
            slashCommand: {
              provider: s.slashCommand?.provider || "openrouter",
              model: s.slashCommand?.model || "google/gemini-2.0-flash-001",
            },
          };
        }

        // Remove provider+model from feature settings
        if (s.snippetLabeling) {
          delete s.snippetLabeling.provider;
          delete s.snippetLabeling.model;
        }
        if (s.slashCommand) {
          delete s.slashCommand.provider;
          delete s.slashCommand.model;
        }
      });
    });
    this.version(9).stores({
      notes: "id, updatedAt",
      snippets: "id, noteId, order",
      settings: "id",
      noteVersions: "id, noteId, createdAt",
      images: "id, noteId, createdAt",
      apiLogs: "id, timestamp, route, provider, status",
    });
    this.version(10).stores({
      notes: "id, updatedAt",
      snippets: "id, noteId, order",
      settings: "id",
      noteVersions: "id, noteId, createdAt",
      images: "id, noteId, createdAt",
      apiLogs: "id, timestamp, route, provider, status",
    }).upgrade((tx) => {
      return tx.table("notes").toCollection().modify((n) => {
        if (!n.audience) n.audience = "";
        if (!n.tone) n.tone = "";
        if (!n.remember) n.remember = "";
      });
    });

    // Fix invalid model ID: google/gemini-3.0-flash → google/gemini-2.0-flash-001
    this.version(11).stores({
      notes: "id, updatedAt",
      snippets: "id, noteId, order",
      settings: "id",
      noteVersions: "id, noteId, createdAt",
      images: "id, noteId, createdAt",
      apiLogs: "id, timestamp, route, provider, status",
    }).upgrade((tx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return tx.table("settings").toCollection().modify((s: any) => {
        const BAD = "google/gemini-3.0-flash";
        const GOOD = "google/gemini-2.0-flash-001";
        if (s.featureProviders) {
          for (const key of Object.keys(s.featureProviders)) {
            const fp = s.featureProviders[key];
            if (fp?.model === BAD) fp.model = GOOD;
            if (fp?.modelsByProvider) {
              for (const p of Object.keys(fp.modelsByProvider)) {
                if (fp.modelsByProvider[p] === BAD) fp.modelsByProvider[p] = GOOD;
              }
            }
          }
        }
      });
    });

    // Add feedback queue table
    this.version(12).stores({
      notes: "id, updatedAt",
      snippets: "id, noteId, order",
      settings: "id",
      noteVersions: "id, noteId, createdAt",
      images: "id, noteId, createdAt",
      apiLogs: "id, timestamp, route, provider, status",
      feedbackQueue: "id, status, createdAt",
    });

    // Add noteId index to apiLogs for per-note usage queries
    this.version(13).stores({
      notes: "id, updatedAt",
      snippets: "id, noteId, order",
      settings: "id",
      noteVersions: "id, noteId, createdAt",
      images: "id, noteId, createdAt",
      apiLogs: "id, timestamp, route, provider, status, noteId",
      feedbackQueue: "id, status, createdAt",
    });

    // Add synced index to apiLogs for Convex sync queries
    this.version(14).stores({
      notes: "id, updatedAt",
      snippets: "id, noteId, order",
      settings: "id",
      noteVersions: "id, noteId, createdAt",
      images: "id, noteId, createdAt",
      apiLogs: "id, timestamp, route, provider, status, noteId, synced",
      feedbackQueue: "id, status, createdAt",
    });

    // Backfill new bring-your-own-key credential fields (OpenAI, Anthropic,
    // Perplexity) so existing settings rows carry empty strings, not undefined.
    this.version(15).stores({
      notes: "id, updatedAt",
      snippets: "id, noteId, order",
      settings: "id",
      noteVersions: "id, noteId, createdAt",
      images: "id, noteId, createdAt",
      apiLogs: "id, timestamp, route, provider, status, noteId, synced",
      feedbackQueue: "id, status, createdAt",
    }).upgrade((tx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return tx.table("settings").toCollection().modify((s: any) => {
        if (s.providerCredentials) {
          if (typeof s.providerCredentials.openAiApiKey !== "string") s.providerCredentials.openAiApiKey = "";
          if (typeof s.providerCredentials.anthropicApiKey !== "string") s.providerCredentials.anthropicApiKey = "";
          if (typeof s.providerCredentials.perplexityApiKey !== "string") s.providerCredentials.perplexityApiKey = "";
        }
      });
    });

    // Brand Voice: dedicated tables for voice metadata + raw samples.
    // Kept out of the settings blob so voice data never touches localStorage.
    this.version(16).stores({
      notes: "id, updatedAt",
      snippets: "id, noteId, order",
      settings: "id",
      noteVersions: "id, noteId, createdAt",
      images: "id, noteId, createdAt",
      apiLogs: "id, timestamp, route, provider, status, noteId, synced",
      feedbackQueue: "id, status, createdAt",
      voices: "id, updatedAt",
      voiceSamples: "id, voiceId, createdAt",
    });

    // Content Engine: ideas, content pieces, and resources. New tables start
    // empty — existing Notes are not backfilled; a Note joins the content
    // store only when a piece links it (noteId). Snippets gain an optional
    // ideaId index (no backfill).
    this.version(17).stores({
      notes: "id, updatedAt",
      snippets: "id, noteId, order, ideaId",
      settings: "id",
      noteVersions: "id, noteId, createdAt",
      images: "id, noteId, createdAt",
      apiLogs: "id, timestamp, route, provider, status, noteId, synced",
      feedbackQueue: "id, status, createdAt",
      voices: "id, updatedAt",
      voiceSamples: "id, voiceId, createdAt",
      ideas: "id, parentId, pinnedAt, priority, updatedAt, createdAt",
      contentPieces:
        "id, ideaId, noteId, status, format, priority, scheduledAt, updatedAt, createdAt, [ideaId+status], [status+format], [status+priority]",
      resources: "id, ownerId, ownerType, createdAt",
    });

    // Pass: review history — one row per imported reviewer return.
    this.version(18).stores({
      notes: "id, updatedAt",
      snippets: "id, noteId, order, ideaId",
      settings: "id",
      noteVersions: "id, noteId, createdAt",
      images: "id, noteId, createdAt",
      apiLogs: "id, timestamp, route, provider, status, noteId, synced",
      feedbackQueue: "id, status, createdAt",
      voices: "id, updatedAt",
      voiceSamples: "id, voiceId, createdAt",
      ideas: "id, parentId, pinnedAt, priority, updatedAt, createdAt",
      contentPieces:
        "id, ideaId, noteId, status, format, priority, scheduledAt, updatedAt, createdAt, [ideaId+status], [status+format], [status+priority]",
      resources: "id, ownerId, ownerType, createdAt",
      reviews: "id, noteId, receivedAt",
    });

    // v19 — cloud sync bookkeeping (ARI-66).
    //
    // Both tables are local-only and never sync themselves. `outbox` is keyed
    // on [collection+id] so a second edit to the same record replaces the
    // pending entry instead of queueing a duplicate push.
    this.version(19).stores({
      notes: "id, updatedAt",
      snippets: "id, noteId, order, ideaId",
      settings: "id",
      noteVersions: "id, noteId, createdAt",
      images: "id, noteId, createdAt",
      apiLogs: "id, timestamp, route, provider, status, noteId, synced",
      feedbackQueue: "id, status, createdAt",
      voices: "id, updatedAt",
      voiceSamples: "id, voiceId, createdAt",
      ideas: "id, parentId, pinnedAt, priority, updatedAt, createdAt",
      contentPieces:
        "id, ideaId, noteId, status, format, priority, scheduledAt, updatedAt, createdAt, [ideaId+status], [status+format], [status+priority]",
      resources: "id, ownerId, ownerType, createdAt",
      reviews: "id, noteId, receivedAt",
      outbox: "[collection+id], collection, updatedAt",
      syncState: "id",
    });
  }
}

export const db = new FragmentDB();
