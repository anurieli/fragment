"use client";

import { useState } from "react";
import { Eye, EyeOff, LogIn, Check, Loader2, ChevronDown, AlertTriangle, ExternalLink } from "lucide-react";
import { PROVIDER_REGISTRY } from "@/lib/providers";
import { openExternal } from "@/lib/ai-client";
import { useProviderConnect, type ConnectState } from "@/hooks/use-provider-connect";
import { CodexDeviceFlow } from "@/components/settings/codex-device-flow";
import type { useCodexSignIn } from "@/hooks/use-codex-signin";
import type { AIProvider } from "@/lib/types";
import type { FeatureKey } from "@/lib/ai/connection-status";

interface ConnectPanelProps {
  /** Fired once a provider is connected and validated (or saved-anyway). */
  onConnected?: (provider: AIProvider) => void;
  /** Which features to point at the newly connected provider. Defaults to all three. */
  activateFor?: FeatureKey[];
  /** Tighter spacing for embedding in the gate modal. */
  compact?: boolean;
}

const OTHER_PROVIDERS: AIProvider[] = ["openai", "anthropic", "perplexity"];

/**
 * The reusable "connect an AI provider" body — no modal chrome, so it embeds
 * in both ConnectGate and the onboarding Connect step. ChatGPT and OpenRouter
 * are the two primary paths; everything else lives behind an expander.
 */
export function ConnectPanel({ onConnected, activateFor, compact }: ConnectPanelProps) {
  const [activeProvider, setActiveProvider] = useState<AIProvider | null>(null);
  const [expanded, setExpanded] = useState(false);
  const connect = useProviderConnect({ activateFor, onConnected });

  const rowState = (provider: AIProvider): ConnectState =>
    activeProvider === provider ? connect.state : "idle";
  const rowError = (provider: AIProvider): string | null =>
    activeProvider === provider ? connect.error : null;
  const rowCanSaveAnyway = (provider: AIProvider): boolean =>
    activeProvider === provider && connect.canSaveAnyway;

  async function handleKeyConnect(provider: AIProvider, value: string) {
    if (!value.trim()) return;
    setActiveProvider(provider);
    await connect.connectKeyProvider(provider, value);
  }

  async function handleOllamaConnect() {
    setActiveProvider("ollama");
    await connect.connectOllama();
  }

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      <CodexConnectRow signIn={connect.codex} onStart={() => setActiveProvider("codex")} />

      <KeyConnectRow
        provider="openrouter"
        state={rowState("openrouter")}
        error={rowError("openrouter")}
        canSaveAnyway={rowCanSaveAnyway("openrouter")}
        onConnect={(value) => handleKeyConnect("openrouter", value)}
        onSaveAnyway={() => connect.saveAnyway("openrouter")}
      />

      <div className="pt-1">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 text-[11px] text-text-faint hover:text-text-muted transition-colors duration-150"
        >
          <ChevronDown size={12} className={`transition-transform duration-150 ${expanded ? "rotate-180" : ""}`} />
          Other providers
        </button>
        {expanded && (
          <div className="mt-3 space-y-3">
            {OTHER_PROVIDERS.map((provider) => (
              <KeyConnectRow
                key={provider}
                provider={provider}
                state={rowState(provider)}
                error={rowError(provider)}
                canSaveAnyway={rowCanSaveAnyway(provider)}
                onConnect={(value) => handleKeyConnect(provider, value)}
                onSaveAnyway={() => connect.saveAnyway(provider)}
              />
            ))}
            <OllamaConnectRow
              state={rowState("ollama")}
              error={rowError("ollama")}
              canSaveAnyway={rowCanSaveAnyway("ollama")}
              onConnect={handleOllamaConnect}
              onSaveAnyway={() => connect.saveAnyway("ollama")}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sign in with ChatGPT (Codex) ──────────────────────────────────────────

function CodexConnectRow({
  signIn,
  onStart,
}: {
  signIn: ReturnType<typeof useCodexSignIn>;
  onStart: () => void;
}) {
  const Icon = PROVIDER_REGISTRY.codex.icon;
  const { phase, error, cancel } = signIn;

  if (phase === "code" || phase === "polling") {
    return (
      <div className="rounded-[var(--radius-default)] border border-gold/30 bg-surface-3 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Icon size={14} className="text-gold" />
          <span className="text-xs font-medium text-text-secondary">{PROVIDER_REGISTRY.codex.name}</span>
          <button
            type="button"
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

  return (
    <div className="rounded-[var(--radius-default)] border border-border-strong bg-surface-3 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Icon size={14} className="text-text-muted" />
        <span className="text-xs font-medium text-text-secondary">{PROVIDER_REGISTRY.codex.name}</span>
        <button
          type="button"
          onClick={() => {
            onStart();
            signIn.start();
          }}
          disabled={phase === "loading"}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] bg-gold/15 text-gold text-[11px] font-medium hover:bg-gold/25 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
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
      <p className="text-[10px] text-text-muted leading-relaxed">
        Try an eligible ChatGPT account without an API key. This connection is experimental;
        account and workspace limits apply, and some accounts may need an OpenAI API key.
      </p>
      {error && (
        <p className="text-[10px] text-red flex items-center gap-1">
          <AlertTriangle size={11} /> {error}
        </p>
      )}
    </div>
  );
}

// ─── API-key providers (OpenRouter, OpenAI, Anthropic, Perplexity) ────────

interface KeyConnectRowProps {
  provider: AIProvider;
  state: ConnectState;
  error: string | null;
  canSaveAnyway: boolean;
  onConnect: (value: string) => void;
  onSaveAnyway: () => void;
}

function KeyConnectRow({ provider, state, error, canSaveAnyway, onConnect, onSaveAnyway }: KeyConnectRowProps) {
  const def = PROVIDER_REGISTRY[provider];
  const Icon = def.icon;
  const [value, setValue] = useState("");
  const [showKey, setShowKey] = useState(false);
  const isValidating = state === "validating";
  const isSuccess = state === "success";

  return (
    <div className="rounded-[var(--radius-default)] border border-border-strong bg-surface-3 p-4 space-y-2.5">
      <div className="flex items-center gap-2">
        <Icon size={14} className="text-text-muted" />
        <span className="text-xs font-medium text-text-secondary">{def.name}</span>
        {isSuccess && (
          <span className="ml-auto flex items-center gap-1 text-[11px] text-green">
            <Check size={12} /> Connected
          </span>
        )}
      </div>
      <p className="text-[10px] text-text-muted leading-relaxed">{def.description}</p>
      {!isSuccess && (
        <>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type={showKey ? "text" : "password"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onConnect(value);
                }}
                placeholder={def.keyPlaceholder ?? "Paste your API key here"}
                className="w-full bg-surface border border-border-strong rounded-[var(--radius-sm)] px-3 py-2 text-xs text-text-primary placeholder:text-text-faint outline-none focus:border-border-active transition-colors duration-150 pr-9"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-text-secondary transition-colors duration-150"
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <button
              type="button"
              onClick={() => onConnect(value)}
              disabled={!value.trim() || isValidating}
              className="flex items-center gap-1.5 px-3 py-2 rounded-[var(--radius-sm)] bg-gold/15 text-gold text-[11px] font-medium hover:bg-gold/25 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              {isValidating ? <Loader2 size={12} className="animate-spin" /> : "Connect"}
            </button>
          </div>
          {def.getKeyUrl && (
            <p className="text-[10px] text-text-faint">
              {"Don't have a key? "}
              <button
                type="button"
                onClick={() => openExternal(def.getKeyUrl!)}
                className="text-gold hover:text-gold/80 underline underline-offset-2 transition-colors duration-150"
              >
                {def.getKeyLabel ?? "Get one"}
              </button>
            </p>
          )}
          {error && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] text-red flex items-center gap-1">
                <AlertTriangle size={11} /> {error}
              </p>
              {canSaveAnyway && (
                <button
                  type="button"
                  onClick={onSaveAnyway}
                  className="text-[10px] text-gold hover:text-gold/80 underline underline-offset-2 transition-colors duration-150 shrink-0"
                >
                  Use anyway
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Ollama (local) ─────────────────────────────────────────────────────────

interface OllamaConnectRowProps {
  state: ConnectState;
  error: string | null;
  canSaveAnyway: boolean;
  onConnect: () => void;
  onSaveAnyway: () => void;
}

function OllamaConnectRow({ state, error, canSaveAnyway, onConnect, onSaveAnyway }: OllamaConnectRowProps) {
  const Icon = PROVIDER_REGISTRY.ollama.icon;
  const isValidating = state === "validating";
  const isSuccess = state === "success";

  return (
    <div className="rounded-[var(--radius-default)] border border-border-strong bg-surface-3 p-4 space-y-2.5">
      <div className="flex items-center gap-2">
        <Icon size={14} className="text-text-muted" />
        <span className="text-xs font-medium text-text-secondary">{PROVIDER_REGISTRY.ollama.name}</span>
        {isSuccess ? (
          <span className="ml-auto flex items-center gap-1 text-[11px] text-green">
            <Check size={12} /> Connected
          </span>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            disabled={isValidating}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] bg-gold/15 text-gold text-[11px] font-medium hover:bg-gold/25 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isValidating ? <Loader2 size={12} className="animate-spin" /> : "Use local Ollama"}
          </button>
        )}
      </div>
      <p className="text-[10px] text-text-muted leading-relaxed">
        Run AI models locally on your machine — free, private, no account needed. Requires{" "}
        <button
          type="button"
          onClick={() => openExternal("https://ollama.com")}
          className="text-gold hover:text-gold/80 underline underline-offset-2 transition-colors duration-150 inline-flex items-center gap-0.5"
        >
          Ollama <ExternalLink size={9} />
        </button>{" "}
        to be installed and running.
      </p>
      {error && !isSuccess && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] text-red flex items-center gap-1">
            <AlertTriangle size={11} /> {error}
          </p>
          {canSaveAnyway && (
            <button
              type="button"
              onClick={onSaveAnyway}
              className="text-[10px] text-gold hover:text-gold/80 underline underline-offset-2 transition-colors duration-150 shrink-0"
            >
              Use anyway
            </button>
          )}
        </div>
      )}
    </div>
  );
}
