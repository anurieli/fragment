"use client";

import { getProvider } from "@/lib/providers";
import type { AIProvider } from "@/lib/providers";
import { getProviderKey } from "@/lib/ai/provider-runtime";
import { useSettingsStore } from "@/stores/settings-store";
import { isHosted } from "@/lib/edition";

interface ProviderToggleProps {
  value: AIProvider;
  onChange: (provider: AIProvider) => void;
}

/** Short label without the parenthetical (e.g. "Local (Ollama)" → "Local"). */
function shortName(name: string): string {
  return name.replace(/\s*\(.*\)\s*$/, "");
}

/** Providers flagged as beta in this switcher. */
const BETA_PROVIDERS = new Set<AIProvider>(["ollama"]);

/** Whether a provider is ready to use (has a key / is signed in / is local). */
function useProviderReady(): (id: AIProvider) => boolean {
  const creds = useSettingsStore((s) => s.settings.providerCredentials);
  const hosted = isHosted();
  return (id: AIProvider) => {
    if (id === "ollama") return true;
    if (id === "codex") return !!creds.codexAccessToken;
    // Hosted SaaS provides managed AI, so cloud providers always work.
    if (hosted) return true;
    return getProviderKey(id, creds).length > 0;
  };
}

function ProviderButton({
  id,
  active,
  ready,
  onSelect,
  hero = false,
  caption,
}: {
  id: AIProvider;
  active: boolean;
  ready: boolean;
  onSelect: () => void;
  hero?: boolean;
  caption?: string;
}) {
  const provider = getProvider(id);
  const Icon = provider.icon;
  const isBeta = BETA_PROVIDERS.has(id);

  const notReadyHint =
    provider.authType === "oauth"
      ? "Sign in with ChatGPT in Providers first"
      : `Add a ${provider.name} API key in Providers first`;

  const title = ready
    ? provider.name
    : active
      ? `Currently selected, but ${provider.authType === "oauth" ? "not signed in" : "no key set"} — ${notReadyHint.toLowerCase()}`
      : `${provider.name} — ${notReadyHint.toLowerCase()}`;

  return (
    <button
      type="button"
      disabled={!ready}
      onClick={onSelect}
      title={title}
      className={`relative flex items-center gap-1.5 rounded-[var(--radius-sm)] border text-[11px] font-medium transition-colors duration-150 ${
        hero ? "px-3 py-2 justify-start" : "px-2 py-1.5 justify-center"
      } ${
        !ready
          ? active
            ? "bg-gold/5 text-gold/50 border-gold/20 opacity-70 cursor-not-allowed"
            : "opacity-40 cursor-not-allowed bg-surface-3 text-text-faint border-border-strong"
          : active
            ? "bg-gold/15 text-gold border-gold/40"
            : "bg-surface-3 text-text-muted border-border-strong hover:text-text-secondary"
      }`}
    >
      <Icon size={hero ? 14 : 12} className="shrink-0" />
      <span className="flex flex-col items-start min-w-0 leading-tight">
        <span className="flex items-center gap-1 min-w-0">
          <span className="truncate">{shortName(provider.name)}</span>
          {isBeta && (
            <span className="shrink-0 text-[8px] px-1 rounded-sm bg-surface-2 text-text-faint uppercase tracking-wider">
              Beta
            </span>
          )}
        </span>
        {caption && (
          <span className="text-[9px] text-text-faint font-normal truncate">{caption}</span>
        )}
      </span>
      {!ready && !hero && (
        <span
          className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-text-faint"
          title="Not connected"
        />
      )}
    </button>
  );
}

export function ProviderToggle({ value, onChange }: ProviderToggleProps) {
  const isReady = useProviderReady();

  function select(id: AIProvider) {
    if (!isReady(id)) return;
    onChange(id);
  }

  const codexReady = isReady("codex");

  return (
    <div className="space-y-1.5">
      {/* Codex — the primary sign-in path, separated from the BYOK providers below */}
      <ProviderButton
        id="codex"
        active={value === "codex"}
        ready={codexReady}
        onSelect={() => select("codex")}
        hero
        caption={codexReady ? "Connected" : "Sign in with ChatGPT"}
      />

      <div className="h-px bg-border" />

      {/* OpenRouter — one key, hundreds of models */}
      <ProviderButton
        id="openrouter"
        active={value === "openrouter"}
        ready={isReady("openrouter")}
        onSelect={() => select("openrouter")}
      />

      {/* OpenAI + Anthropic — individual provider keys */}
      <div className="grid grid-cols-2 gap-1.5">
        <ProviderButton
          id="openai"
          active={value === "openai"}
          ready={isReady("openai")}
          onSelect={() => select("openai")}
        />
        <ProviderButton
          id="anthropic"
          active={value === "anthropic"}
          ready={isReady("anthropic")}
          onSelect={() => select("anthropic")}
        />
      </div>

      {/* Perplexity (research) + Local (Ollama, beta) */}
      <div className="grid grid-cols-2 gap-1.5">
        <ProviderButton
          id="perplexity"
          active={value === "perplexity"}
          ready={isReady("perplexity")}
          onSelect={() => select("perplexity")}
          caption="For research"
        />
        <ProviderButton
          id="ollama"
          active={value === "ollama"}
          ready={isReady("ollama")}
          onSelect={() => select("ollama")}
        />
      </div>
    </div>
  );
}
