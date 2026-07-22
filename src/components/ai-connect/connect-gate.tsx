"use client";

import { X } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { PROVIDER_REGISTRY } from "@/lib/providers";
import { ConnectPanel } from "./connect-panel";

const HEADLINES: Record<"no-provider" | "auth-failed", { title: string; body: string }> = {
  "no-provider": {
    title: "Connect an AI provider",
    body: "Snip, Flow, and Refine need an AI backend. Connect one to continue — you can keep writing without it.",
  },
  "auth-failed": {
    title: "Your AI connection stopped working",
    body: "Reconnect to keep using AI features.",
  },
};

/**
 * Global modal that gates AI features only — writing is never blocked. Opens
 * when an AI feature is invoked with no working provider, or a live call
 * rejects the credential (401 / Codex invalid_grant). Dismissible; the
 * triggering action does not auto-run on dismiss or on connect (§7.4) — the
 * user simply re-invokes the feature once the gate closes.
 *
 * Mounted once in app-shell. Replaces the old Codex-only reconnect banner —
 * every provider now shares this one gate.
 */
export function ConnectGate() {
  const aiGate = useAppStore((s) => s.aiGate);
  const closeAiGate = useAppStore((s) => s.closeAiGate);

  if (!aiGate) return null;

  const copy = HEADLINES[aiGate.reason];
  const providerName = aiGate.provider ? PROVIDER_REGISTRY[aiGate.provider].name : null;
  const title =
    aiGate.reason === "auth-failed" && providerName
      ? `Your ${providerName} connection stopped working`
      : copy.title;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="w-[min(480px,100%)] max-h-[85vh] overflow-y-auto rounded-[var(--radius-xl)] border border-border-strong bg-surface-2 p-5 space-y-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="text-sm font-medium text-text-primary">{title}</h3>
            <p className="text-[11px] text-text-muted leading-relaxed">{copy.body}</p>
          </div>
          <button
            type="button"
            onClick={closeAiGate}
            className="p-1 text-text-faint hover:text-text-muted transition-colors duration-150 shrink-0"
            title="Not now"
          >
            <X size={14} />
          </button>
        </div>

        <ConnectPanel onConnected={closeAiGate} compact />

        <button
          type="button"
          onClick={closeAiGate}
          className="text-xs text-text-faint hover:text-text-muted transition-colors duration-150"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
