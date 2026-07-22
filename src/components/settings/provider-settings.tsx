"use client";

import { useMemo, useState } from "react";
import { Eye, EyeOff, LogIn, Check, Loader2, Zap, Sparkles, RotateCcw } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { useAppStore } from "@/stores/app-store";
import { PROVIDER_REGISTRY } from "@/lib/providers";
import { getProviderKey, getProviderKeyField } from "@/lib/ai/provider-runtime";
import { hasAnyProviderPresent } from "@/lib/ai/connection-status";
import { isHosted } from "@/lib/edition";
import { openExternal } from "@/lib/ai-client";
import { useCodexSignIn } from "@/hooks/use-codex-signin";
import { clearCodexSession } from "@/lib/codex-token-manager";
import { useProviderModels } from "@/hooks/use-provider-models";
import { CodexDeviceFlow } from "@/components/settings/codex-device-flow";
import type { AIProvider } from "@/lib/providers";

/** Card title for the ChatGPT (Codex) sign-in — the flagship, no-API-key option. */
const CODEX_CARD_TITLE = "ChatGPT Pro";

export function ProviderSettings() {
  const { settings } = useSettingsStore();
  const hasAnyProvider = hasAnyProviderPresent(settings);
  const hosted = isHosted();

  return (
    <div className="space-y-8">
      {/* Hosted SaaS: AI works out of the box; BYO keys are optional. */}
      {hosted && <HostedManagedBanner />}

      {/* Onboarding banner — self-host, shown when no provider is connected */}
      {!hosted && !hasAnyProvider && <ProviderOnboarding />}

      {/* ChatGPT first — the flagship: sign in with your ChatGPT account, no API key */}
      <div className="space-y-3">
        <SectionLabel>Recommended — sign in with ChatGPT</SectionLabel>
        <CodexAuthCard />
      </div>

      {/* BYO API key — OpenRouter leads (one key, many models), then the rest */}
      <div className="space-y-3">
        <SectionLabel>Or bring your own API key</SectionLabel>
        <ApiKeyAuthCard providerId="openrouter" />
        <ApiKeyAuthCard providerId="openai" />
        <ApiKeyAuthCard providerId="anthropic" />
        <ApiKeyAuthCard providerId="perplexity" />
      </div>

      {/* Local models — free, private, still in beta */}
      <div className="space-y-3">
        <SectionLabel>Run locally</SectionLabel>
        <OllamaAuthCard />
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] text-text-faint font-[family-name:var(--font-mono)] uppercase tracking-wider">
      {children}
    </p>
  );
}

function BetaBadge() {
  return (
    <span className="text-[8px] px-1 py-0.5 rounded-sm bg-surface-2 text-text-faint uppercase tracking-wider">
      Beta
    </span>
  );
}

function HostedManagedBanner() {
  return (
    <div className="rounded-[var(--radius-default)] border border-gold/30 bg-gold/5 p-5 space-y-2">
      <div className="flex items-start gap-3">
        <div className="w-7 h-7 rounded-full bg-gold/15 flex items-center justify-center shrink-0 mt-0.5">
          <Sparkles size={14} className="text-gold" />
        </div>
        <div className="space-y-1">
          <h4 className="text-sm font-medium text-text-primary">
            Fragment AI is included on your plan
          </h4>
          <p className="text-[11px] text-text-muted leading-relaxed">
            Snip, Flow, and Refine work out of the box — no setup, no API keys. Prefer to use your
            own account? Add a provider key below and Fragment will use it instead.
          </p>
        </div>
      </div>
    </div>
  );
}

function ProviderOnboarding() {
  return (
    <div className="rounded-[var(--radius-default)] border border-gold/30 bg-gold/5 p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-7 h-7 rounded-full bg-gold/15 flex items-center justify-center shrink-0 mt-0.5">
          <Zap size={14} className="text-gold" />
        </div>
        <div className="space-y-1">
          <h4 className="text-sm font-medium text-text-primary">
            Connect an AI provider to get started
          </h4>
          <p className="text-[11px] text-text-muted leading-relaxed">
            Fragment uses AI to label your snippets, generate text, and edit inline. Bring your own
            account from any provider below — you only pay your provider for what you use.
          </p>
        </div>
      </div>

      <div className="space-y-2.5 pl-10">
        <div className="space-y-1">
          <p className="text-[11px] text-text-secondary font-medium">
            Easiest: Sign in with ChatGPT
          </p>
          <p className="text-[10px] text-text-muted leading-relaxed">
            Already pay for ChatGPT? Sign in with your ChatGPT account below — no API key needed,
            and Fragment uses your existing subscription (any paid plan, from $20/month).
          </p>
        </div>

        <div className="space-y-1">
          <p className="text-[11px] text-text-secondary font-medium">
            Then, OpenRouter
          </p>
          <p className="text-[10px] text-text-muted leading-relaxed">
            One API key, hundreds of models (GPT, Claude, Gemini, Llama, and more).{" "}
            <button
              onClick={() => openExternal("https://openrouter.ai")}
              className="text-gold hover:text-gold/80 underline underline-offset-2 transition-colors duration-150"
            >
              Create a free account
            </button>
            , then paste your key below.
          </p>
        </div>

        <div className="space-y-1">
          <p className="text-[11px] text-text-secondary font-medium">
            Or a specific provider
          </p>
          <p className="text-[10px] text-text-muted leading-relaxed">
            Add your own OpenAI, Anthropic (Claude), or Perplexity key, or run models locally and
            free with Ollama (beta).
          </p>
        </div>
      </div>
    </div>
  );
}

/** Generic API-key card — drives OpenRouter, OpenAI, Anthropic, Perplexity from the registry. */
function ApiKeyAuthCard({ providerId }: { providerId: AIProvider }) {
  const { settings, updateProviderCredentials } = useSettingsStore();
  const [showKey, setShowKey] = useState(false);
  const def = PROVIDER_REGISTRY[providerId];
  const field = getProviderKeyField(providerId);
  const value = getProviderKey(providerId, settings.providerCredentials);
  const hasKey = value.length > 0;
  const Icon = def.icon;

  if (!field) return null;

  return (
    <div className="rounded-[var(--radius-default)] border border-border-strong bg-surface-3 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Icon size={14} className="text-text-muted" />
        <span className="text-xs font-medium text-text-secondary">{def.name}</span>
        <div
          className={`ml-auto w-2 h-2 rounded-full shrink-0 ${hasKey ? "bg-green" : "bg-text-faint"}`}
          title={hasKey ? "Key set" : "No key"}
        />
      </div>
      <p className="text-[10px] text-text-muted leading-relaxed">{def.description}</p>
      <div className="relative">
        <input
          type={showKey ? "text" : "password"}
          value={value}
          onChange={(e) => updateProviderCredentials({ [field]: e.target.value })}
          placeholder={def.keyPlaceholder ?? "Paste your API key here"}
          className="w-full bg-surface border border-border-strong rounded-[var(--radius-sm)] px-3 py-2 text-xs text-text-primary placeholder:text-text-faint outline-none focus:border-border-active transition-colors duration-150 pr-9"
        />
        <button
          onClick={() => setShowKey(!showKey)}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-text-secondary transition-colors duration-150"
        >
          {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      {def.getKeyUrl && (
        <p className="text-[10px] text-text-faint">
          {"Don't have a key? "}
          <button
            onClick={() => openExternal(def.getKeyUrl!)}
            className="text-gold hover:text-gold/80 underline underline-offset-2 transition-colors duration-150"
          >
            {def.getKeyLabel ?? "Get one"}
          </button>
        </p>
      )}
    </div>
  );
}

function CodexAuthCard() {
  const { settings, updateProviderCredentials } = useSettingsStore();
  const setCodexConnection = useAppStore((s) => s.setCodexConnection);
  const isConnected = !!settings.providerCredentials.codexAccessToken;
  const signIn = useCodexSignIn();
  const { phase, error, start, cancel } = signIn;
  const Icon = PROVIDER_REGISTRY.codex.icon;

  function handleDisconnect() {
    // Kill the token manager's in-memory session first; otherwise the next
    // AI call would refresh with its remembered token and reconnect silently.
    clearCodexSession();
    updateProviderCredentials({
      codexAccessToken: "",
      codexRefreshToken: "",
    });
    setCodexConnection("disconnected");
  }

  if (isConnected) {
    return (
      <div className="rounded-[var(--radius-default)] border border-border-strong bg-surface-3 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Icon size={14} className="text-text-muted" />
          <span className="text-xs font-medium text-text-secondary">
            {CODEX_CARD_TITLE}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-[11px] text-green">
              <Check size={12} />
              Connected
            </span>
            <button
              onClick={handleDisconnect}
              className="text-[10px] text-text-faint hover:text-text-muted transition-colors duration-150"
            >
              Disconnect
            </button>
          </div>
        </div>
        <p className="text-[10px] text-text-muted leading-relaxed">
          Your ChatGPT account is connected. OpenAI&apos;s latest models are ready to use.
        </p>
        <CodexModelManager />
      </div>
    );
  }

  // Step-by-step sign-in: first copy the code, then open the verification page
  if (phase === "code" || phase === "polling") {
    return (
      <div className="rounded-[var(--radius-default)] border border-gold/30 bg-surface-3 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Icon size={14} className="text-gold" />
          <span className="text-xs font-medium text-text-secondary">
            {CODEX_CARD_TITLE}
          </span>
          <button
            onClick={cancel}
            className="ml-auto text-[10px] text-text-faint hover:text-text-muted transition-colors duration-150"
          >
            Cancel
          </button>
        </div>

        <CodexDeviceFlow signIn={signIn} />
      </div>
    );
  }

  // Idle / loading state
  return (
    <div className="rounded-[var(--radius-default)] border border-border-strong bg-surface-3 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Icon size={14} className="text-text-muted" />
        <span className="text-xs font-medium text-text-secondary">
          {CODEX_CARD_TITLE}
        </span>
        <div className="ml-auto">
          <button
            onClick={start}
            disabled={phase === "loading"}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] bg-gold/15 text-gold text-[11px] font-medium hover:bg-gold/25 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {phase === "loading" ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <LogIn size={12} />
                Sign in with ChatGPT
              </>
            )}
          </button>
        </div>
      </div>
      <p className="text-[10px] text-text-muted leading-relaxed">
        Use your ChatGPT account to run OpenAI&apos;s latest models — no API key needed.
        Works with any paid ChatGPT plan, starting at $20/month.
      </p>
      {error && <p className="text-[10px] text-red-400">{error}</p>}
    </div>
  );
}

/**
 * Codex model allowlist: choose which of the account's models appear as
 * options in the Snip/Flow/Refine pickers. An empty allowlist means "all".
 */
function CodexModelManager() {
  const { models, loading, error, reload } = useProviderModels("codex");
  const enabled = useSettingsStore((s) => s.settings.codexEnabledModels);
  const setEnabled = useSettingsStore((s) => s.setCodexEnabledModels);
  const [expanded, setExpanded] = useState(false);

  const allIds = useMemo(() => models.map((m) => m.id), [models]);
  const isRestricted = enabled.length > 0;
  const isModelOn = (id: string) => !isRestricted || enabled.includes(id);
  const activeCount = isRestricted ? enabled.length : models.length;

  function toggle(id: string) {
    // Start from the current effective set (all ids when unrestricted).
    const current = isRestricted ? enabled : allIds;
    const next = current.includes(id)
      ? current.filter((m) => m !== id)
      : [...current, id];
    // Empty or full both collapse to "all" so a picker is never left empty.
    if (next.length === 0 || next.length === allIds.length) {
      setEnabled([]);
    } else {
      setEnabled(next);
    }
  }

  return (
    <div className="mt-2 border-t border-border pt-3 space-y-2">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 text-left min-w-0"
        >
          <span className="text-[11px] font-medium text-text-secondary shrink-0">
            Available models
          </span>
          <span className="text-[10px] text-text-faint truncate">
            {loading
              ? "loading…"
              : models.length === 0
                ? "none found"
                : isRestricted
                  ? `${activeCount} of ${models.length} shown`
                  : `all ${models.length} shown`}
          </span>
        </button>
        <button
          onClick={reload}
          disabled={loading}
          title="Refresh model list"
          className="ml-auto flex items-center gap-1 text-[10px] text-text-faint hover:text-text-muted transition-colors duration-150 disabled:opacity-50 shrink-0"
        >
          <RotateCcw size={10} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-[10px] text-gold hover:text-gold/80 transition-colors duration-150 shrink-0"
        >
          {expanded ? "Hide" : "Choose"}
        </button>
      </div>

      {!expanded && (
        <p className="text-[10px] text-text-faint leading-relaxed">
          Pick which models show up as options across Snip, Flow, and Refine. All are shown by
          default.
        </p>
      )}

      {expanded && (
        <div className="space-y-2">
          {loading && (
            <div className="flex items-center gap-2 text-[10px] text-text-faint">
              <Loader2 size={11} className="animate-spin" /> Loading models from your account…
            </div>
          )}
          {error && !loading && (
            <p className="text-[10px] text-red-400 leading-relaxed">Couldn&apos;t load models: {error}</p>
          )}
          {!loading && !error && models.length === 0 && (
            <p className="text-[10px] text-text-faint leading-relaxed">
              No models came back. This is usually a momentary hiccup right after connecting —
              hit Refresh. If it persists, sign out and back in.
            </p>
          )}

          {!loading && models.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-text-faint leading-relaxed">
                  Checked models appear as options. Uncheck to hide.
                </p>
                {isRestricted && (
                  <button
                    onClick={() => setEnabled([])}
                    className="flex items-center gap-1 text-[10px] text-text-faint hover:text-text-muted transition-colors duration-150 shrink-0"
                  >
                    <RotateCcw size={10} />
                    Show all
                  </button>
                )}
              </div>
              <div className="max-h-56 overflow-y-auto rounded-[var(--radius-sm)] border border-border-strong bg-surface divide-y divide-border">
                {models.map((m) => {
                  const on = isModelOn(m.id);
                  return (
                    <button
                      key={m.id}
                      onClick={() => toggle(m.id)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-3 transition-colors duration-100"
                    >
                      <span
                        className={`w-3.5 h-3.5 rounded-[3px] border shrink-0 flex items-center justify-center transition-colors duration-100 ${
                          on ? "bg-gold border-gold" : "border-border-strong bg-transparent"
                        }`}
                      >
                        {on && <Check size={10} className="text-surface" />}
                      </span>
                      <span className="text-[11px] text-text-secondary truncate">{m.name}</span>
                      <span className="ml-auto text-[9px] text-text-faint font-[family-name:var(--font-mono)] truncate max-w-[45%]">
                        {m.id}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function OllamaAuthCard() {
  const Icon = PROVIDER_REGISTRY.ollama.icon;

  return (
    <div className="rounded-[var(--radius-default)] border border-border-strong bg-surface-3 p-4 space-y-2">
      <div className="flex items-center gap-2">
        <Icon size={14} className="text-text-muted" />
        <span className="text-xs font-medium text-text-secondary">
          {PROVIDER_REGISTRY.ollama.name}
        </span>
        <BetaBadge />
      </div>
      <p className="text-[10px] text-text-muted leading-relaxed">
        Run AI models locally on your machine — free, private, no account needed. Requires{" "}
        <button
          onClick={() => openExternal("https://ollama.com")}
          className="text-gold hover:text-gold/80 underline underline-offset-2 transition-colors duration-150"
        >
          Ollama
        </button>{" "}
        to be installed and running.
      </p>
    </div>
  );
}
