import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore } from "@/stores/settings-store";
import { DEFAULT_SETTINGS, DEFAULT_LABELING_PROMPT, DEFAULT_GENERATION_PROMPT } from "@/lib/defaults";
import { db } from "@/lib/db";

async function resetStore() {
  localStorage.clear();
  await db.settings.clear();
  useSettingsStore.setState({
    settings: structuredClone(DEFAULT_SETTINGS),
  });
}

describe("settings-store", () => {
  beforeEach(async () => {
    await resetStore();
  });

  it("initializes with default settings", () => {
    const { settings } = useSettingsStore.getState();
    expect(settings.providerCredentials.openRouterApiKey).toBe("");
    expect(settings.snippetLabeling.enabled).toBe(true);
    expect(settings.slashCommand.enabled).toBe(true);
  });

  it("updateProviderCredentials persists the key", () => {
    useSettingsStore.getState().updateProviderCredentials({ openRouterApiKey: "sk-test-123" });
    expect(useSettingsStore.getState().settings.providerCredentials.openRouterApiKey).toBe("sk-test-123");
  });

  it("updateFeatureProvider updates per-feature provider and model", () => {
    useSettingsStore.getState().updateFeatureProvider("snippetLabeling", {
      provider: "codex",
      model: "gpt-4o-mini",
    });
    const fp = useSettingsStore.getState().settings.featureProviders;
    expect(fp.snippetLabeling.provider).toBe("codex");
    expect(fp.snippetLabeling.model).toBe("gpt-4o-mini");
    // Other feature unchanged
    expect(fp.slashCommand.provider).toBe("openrouter");
  });

  it("remembers each provider model when switching providers", () => {
    const store = useSettingsStore.getState();
    store.updateFeatureProvider("snippetLabeling", {
      model: "openai/gpt-4.1-mini",
    });
    store.updateFeatureProvider("snippetLabeling", { provider: "codex" });

    let fp = useSettingsStore.getState().settings.featureProviders;
    expect(fp.snippetLabeling.provider).toBe("codex");
    expect(fp.snippetLabeling.model).toBe("gpt-5.4-mini");

    useSettingsStore.getState().updateFeatureProvider("snippetLabeling", {
      model: "gpt-4.1",
    });
    useSettingsStore.getState().updateFeatureProvider("snippetLabeling", {
      provider: "openrouter",
    });

    fp = useSettingsStore.getState().settings.featureProviders;
    expect(fp.snippetLabeling.provider).toBe("openrouter");
    expect(fp.snippetLabeling.model).toBe("openai/gpt-4.1-mini");
  });

  it("rehydrates legacy plain settings shape from localStorage", async () => {
    await db.settings.clear();
    localStorage.setItem(
      "fragment:settings",
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        featureProviders: {
          ...DEFAULT_SETTINGS.featureProviders,
          snippetLabeling: {
            provider: "codex",
            model: "gpt-4o-mini",
          },
        },
      }),
    );

    await (useSettingsStore as unknown as { persist: { rehydrate: () => Promise<void> } }).persist.rehydrate();

    const fp = useSettingsStore.getState().settings.featureProviders;
    expect(fp.snippetLabeling.provider).toBe("codex");
    expect(fp.snippetLabeling.model).toBe("gpt-4o-mini");
  });

  it("rehydrates legacy wrapped settings shape from localStorage", async () => {
    await db.settings.clear();
    localStorage.setItem(
      "fragment:settings",
      JSON.stringify({
        settings: {
          ...DEFAULT_SETTINGS,
          featureProviders: {
            ...DEFAULT_SETTINGS.featureProviders,
            slashCommand: {
              provider: "codex",
              model: "gpt-4.1-mini",
            },
          },
        },
      }),
    );

    await (useSettingsStore as unknown as { persist: { rehydrate: () => Promise<void> } }).persist.rehydrate();

    const fp = useSettingsStore.getState().settings.featureProviders;
    expect(fp.slashCommand.provider).toBe("codex");
    expect(fp.slashCommand.model).toBe("gpt-4.1-mini");
  });

  it("updateSnippetLabeling does partial merge", () => {
    useSettingsStore.getState().updateSnippetLabeling({ enabled: false });
    const labeling = useSettingsStore.getState().settings.snippetLabeling;

    expect(labeling.enabled).toBe(false);
    // Other fields preserved
    expect(labeling.maxEssayContext).toBe(0);
  });

  it("updateSlashCommand does partial merge", () => {
    useSettingsStore.getState().updateSlashCommand({ maxContextAbove: 1000 });
    const slash = useSettingsStore.getState().settings.slashCommand;

    expect(slash.maxContextAbove).toBe(1000);
    expect(slash.maxContextBelow).toBe(3000); // unchanged
  });

  it("resetSnippetLabelingPrompt restores default template", () => {
    useSettingsStore.getState().updateSnippetLabeling({ promptTemplate: "custom prompt" });
    expect(useSettingsStore.getState().settings.snippetLabeling.promptTemplate).toBe("custom prompt");

    useSettingsStore.getState().resetSnippetLabelingPrompt();
    expect(useSettingsStore.getState().settings.snippetLabeling.promptTemplate).toBe(DEFAULT_LABELING_PROMPT);
  });

  it("resetSlashCommandPrompt restores default template", () => {
    useSettingsStore.getState().updateSlashCommand({ promptTemplate: "custom" });
    useSettingsStore.getState().resetSlashCommandPrompt();
    expect(useSettingsStore.getState().settings.slashCommand.promptTemplate).toBe(DEFAULT_GENERATION_PROMPT);
  });

  it("writes a local shadow snapshot when provider settings change", async () => {
    useSettingsStore.getState().updateFeatureProvider("slashCommand", {
      provider: "codex",
      model: "gpt-5.4-mini",
    });

    await Promise.resolve();

    const raw = localStorage.getItem("fragment:settings:shadow");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw ?? "{}") as {
      settings?: { featureProviders?: { slashCommand?: { provider?: string; model?: string } } };
    };
    expect(parsed.settings?.featureProviders?.slashCommand?.provider).toBe("codex");
    expect(parsed.settings?.featureProviders?.slashCommand?.model).toBe("gpt-5.4-mini");
  });

  it("maintains a dedicated credential backup in localStorage", async () => {
    useSettingsStore.getState().updateProviderCredentials({ openRouterApiKey: "sk-backup-test" });

    // Give zustand persist time to fire setItem
    await new Promise((r) => setTimeout(r, 50));

    const raw = localStorage.getItem("fragment:credentials");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw ?? "{}") as { openRouterApiKey?: string };
    expect(parsed.openRouterApiKey).toBe("sk-backup-test");
  });

  it("restores credentials from backup when primary storage is empty", async () => {
    // Simulate: credential backup exists but primary storage has empty credentials
    localStorage.setItem(
      "fragment:credentials",
      JSON.stringify({
        openRouterApiKey: "sk-recovered",
        codexAccessToken: "",
        codexRefreshToken: "",
      }),
    );

    // Primary storage has no credentials
    const snapshot = JSON.stringify({
      savedAt: Date.now(),
      settings: {
        ...DEFAULT_SETTINGS,
        providerCredentials: {
          openRouterApiKey: "",
          codexAccessToken: "",
          codexRefreshToken: "",
        },
      },
    });
    localStorage.setItem("fragment:settings:shadow", snapshot);
    localStorage.setItem("fragment:settings", snapshot);
    await db.settings.clear();

    await (useSettingsStore as unknown as { persist: { rehydrate: () => Promise<void> } }).persist.rehydrate();

    const creds = useSettingsStore.getState().settings.providerCredentials;
    expect(creds.openRouterApiKey).toBe("sk-recovered");
  });

  it("rehydrates from the newer local shadow snapshot when db is stale", async () => {
    await db.settings.put({
      ...structuredClone(DEFAULT_SETTINGS),
      id: "default",
      featureProviders: {
        ...DEFAULT_SETTINGS.featureProviders,
        slashCommand: {
          ...DEFAULT_SETTINGS.featureProviders.slashCommand,
          provider: "openrouter",
          model: "google/gemini-2.0-flash-001",
        },
      },
      __savedAt: 1,
    } as typeof DEFAULT_SETTINGS & { __savedAt: number });

    const snapshot = JSON.stringify({
      savedAt: 2,
      settings: {
        ...DEFAULT_SETTINGS,
        featureProviders: {
          ...DEFAULT_SETTINGS.featureProviders,
          slashCommand: {
            ...DEFAULT_SETTINGS.featureProviders.slashCommand,
            provider: "codex",
            model: "gpt-5.4-mini",
          },
        },
      },
    });
    localStorage.setItem("fragment:settings:shadow", snapshot);
    localStorage.setItem("fragment:settings", snapshot);

    await (useSettingsStore as unknown as { persist: { rehydrate: () => Promise<void> } }).persist.rehydrate();

    const fp = useSettingsStore.getState().settings.featureProviders;
    expect(fp.slashCommand.provider).toBe("codex");
    expect(fp.slashCommand.model).toBe("gpt-5.4-mini");
  });

});
