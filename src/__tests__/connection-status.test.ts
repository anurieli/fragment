import { describe, it, expect, afterEach } from "vitest";
import {
  resolveFeatureAuth,
  resolveWorkingFeatureAuth,
  hasWorkingProvider,
  hasAnyProviderPresent,
} from "@/lib/ai/connection-status";
import { DEFAULT_SETTINGS } from "@/lib/defaults";
import type { AIProvider } from "@/lib/types";

function settingsWith(overrides: Partial<typeof DEFAULT_SETTINGS>) {
  return { ...structuredClone(DEFAULT_SETTINGS), ...overrides };
}

const NO_BAD = new Set<AIProvider>();

describe("connection-status", () => {
  const originalHosted = process.env.NEXT_PUBLIC_FRAGMENT_HOSTED;

  afterEach(() => {
    process.env.NEXT_PUBLIC_FRAGMENT_HOSTED = originalHosted;
  });

  it("hosted edition still requires a real AI connection", () => {
    process.env.NEXT_PUBLIC_FRAGMENT_HOSTED = "true";
    const settings = structuredClone(DEFAULT_SETTINGS);
    expect(hasWorkingProvider(settings, NO_BAD, "slashCommand")).toBe(false);
    expect(hasWorkingProvider(settings, NO_BAD, "snippetLabeling")).toBe(false);
    expect(hasWorkingProvider(settings, NO_BAD, "inlineEdit")).toBe(false);
  });

  it("self-host with no credentials: hasWorkingProvider is false", () => {
    process.env.NEXT_PUBLIC_FRAGMENT_HOSTED = "false";
    const settings = structuredClone(DEFAULT_SETTINGS);
    expect(hasWorkingProvider(settings, NO_BAD, "slashCommand")).toBe(false);
  });

  it("codex: present when an access token exists", () => {
    process.env.NEXT_PUBLIC_FRAGMENT_HOSTED = "false";
    const settings = settingsWith({
      providerCredentials: { ...DEFAULT_SETTINGS.providerCredentials, codexAccessToken: "tok-123" },
      featureProviders: {
        ...DEFAULT_SETTINGS.featureProviders,
        slashCommand: { ...DEFAULT_SETTINGS.featureProviders.slashCommand, provider: "codex" },
      },
    });
    const auth = resolveFeatureAuth("slashCommand", settings);
    expect(auth.present).toBe(true);
    expect(hasWorkingProvider(settings, NO_BAD, "slashCommand")).toBe(true);
  });

  it("codex: not present with an empty access token", () => {
    process.env.NEXT_PUBLIC_FRAGMENT_HOSTED = "false";
    const settings = settingsWith({
      featureProviders: {
        ...DEFAULT_SETTINGS.featureProviders,
        slashCommand: { ...DEFAULT_SETTINGS.featureProviders.slashCommand, provider: "codex" },
      },
    });
    expect(resolveFeatureAuth("slashCommand", settings).present).toBe(false);
    expect(hasWorkingProvider(settings, NO_BAD, "slashCommand")).toBe(false);
  });

  it("key provider: present when the key is a non-empty string", () => {
    process.env.NEXT_PUBLIC_FRAGMENT_HOSTED = "false";
    const settings = settingsWith({
      providerCredentials: { ...DEFAULT_SETTINGS.providerCredentials, openRouterApiKey: "sk-or-abc" },
    });
    expect(resolveFeatureAuth("slashCommand", settings).present).toBe(true);
    expect(hasWorkingProvider(settings, NO_BAD, "slashCommand")).toBe(true);
  });

  it("key provider: not present when the key is empty", () => {
    process.env.NEXT_PUBLIC_FRAGMENT_HOSTED = "false";
    const settings = structuredClone(DEFAULT_SETTINGS);
    expect(resolveFeatureAuth("slashCommand", settings).present).toBe(false);
    expect(hasWorkingProvider(settings, NO_BAD, "slashCommand")).toBe(false);
  });

  it("a sole connected key automatically powers a feature pointed elsewhere", () => {
    const settings = settingsWith({
      providerCredentials: { ...DEFAULT_SETTINGS.providerCredentials, anthropicApiKey: "sk-ant-only" },
    });
    const auth = resolveWorkingFeatureAuth(settings, NO_BAD, "slashCommand");
    expect(auth?.provider).toBe("anthropic");
    expect(auth?.apiKey).toBe("sk-ant-only");
    expect(hasWorkingProvider(settings, NO_BAD, "slashCommand")).toBe(true);
  });

  it("whitespace-only credentials do not count as connected", () => {
    const settings = settingsWith({
      providerCredentials: { ...DEFAULT_SETTINGS.providerCredentials, openRouterApiKey: "   " },
    });
    expect(hasWorkingProvider(settings, NO_BAD, "slashCommand")).toBe(false);
  });

  it("ollama: always present, even with no credentials", () => {
    process.env.NEXT_PUBLIC_FRAGMENT_HOSTED = "false";
    const settings = settingsWith({
      featureProviders: {
        ...DEFAULT_SETTINGS.featureProviders,
        slashCommand: { ...DEFAULT_SETTINGS.featureProviders.slashCommand, provider: "ollama" },
      },
    });
    expect(resolveFeatureAuth("slashCommand", settings).present).toBe(true);
    expect(hasWorkingProvider(settings, NO_BAD, "slashCommand")).toBe(true);
  });

  it("badProviders excludes a provider that is otherwise present", () => {
    process.env.NEXT_PUBLIC_FRAGMENT_HOSTED = "false";
    const settings = settingsWith({
      providerCredentials: { ...DEFAULT_SETTINGS.providerCredentials, openRouterApiKey: "sk-or-abc" },
    });
    const bad = new Set<AIProvider>(["openrouter"]);
    expect(hasWorkingProvider(settings, bad, "slashCommand")).toBe(false);
    // A different provider in the bad set doesn't affect this feature.
    const otherBad = new Set<AIProvider>(["anthropic"]);
    expect(hasWorkingProvider(settings, otherBad, "slashCommand")).toBe(true);
  });

  it("hasAnyProviderPresent is false with zero credentials", () => {
    expect(hasAnyProviderPresent(structuredClone(DEFAULT_SETTINGS))).toBe(false);
  });

  it("hasAnyProviderPresent is true when any single provider has a credential", () => {
    const settings = settingsWith({
      providerCredentials: { ...DEFAULT_SETTINGS.providerCredentials, anthropicApiKey: "sk-ant-xyz" },
    });
    expect(hasAnyProviderPresent(settings)).toBe(true);
  });

  it("hasAnyProviderPresent does NOT auto-true just because Ollama is assumed present", () => {
    // Ollama's "always present" rule is per-feature (hasWorkingProvider), not
    // global — otherwise onboarding's Connect step would auto-skip and
    // Settings' banner would never show, even with zero credentials.
    const settings = structuredClone(DEFAULT_SETTINGS);
    expect(settings.featureProviders.slashCommand.provider).not.toBe("ollama");
    expect(hasAnyProviderPresent(settings)).toBe(false);
  });

  it("hasAnyProviderPresent is true once a feature is actually set to ollama", () => {
    const settings = settingsWith({
      featureProviders: {
        ...DEFAULT_SETTINGS.featureProviders,
        slashCommand: { ...DEFAULT_SETTINGS.featureProviders.slashCommand, provider: "ollama" },
      },
    });
    expect(hasAnyProviderPresent(settings)).toBe(true);
  });
});
