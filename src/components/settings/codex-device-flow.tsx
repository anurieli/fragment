"use client";

import { Check, Loader2, Copy, ExternalLink } from "lucide-react";
import type { useCodexSignIn } from "@/hooks/use-codex-signin";

type SignIn = ReturnType<typeof useCodexSignIn>;

/**
 * The two-step device-code UI (copy code → open OpenAI → wait), shared by the
 * Settings provider card and the global reconnect modal. Purely presentational:
 * all state and actions come from the useCodexSignIn hook.
 */
export function CodexDeviceFlow({ signIn }: { signIn: SignIn }) {
  const { phase, userCode, copied, copy, openVerification } = signIn;

  return (
    <div className="space-y-3">
      {/* Step 1: Copy the code */}
      <div className="space-y-1.5">
        <p className="text-[11px] text-text-secondary font-medium">
          Step 1 — Copy this code
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-center text-lg font-bold text-gold font-[family-name:var(--font-mono)] tracking-[0.3em] bg-surface rounded-[var(--radius-sm)] border border-border-strong py-2">
            {userCode}
          </code>
          <button
            onClick={copy}
            className="p-2 rounded-[var(--radius-sm)] text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-colors duration-150"
            title="Copy code"
          >
            {copied ? <Check size={14} className="text-green" /> : <Copy size={14} />}
          </button>
        </div>
      </div>

      {/* Step 2: Open verification page */}
      <div className="space-y-1.5">
        <p className="text-[11px] text-text-secondary font-medium">
          Step 2 — Paste it on OpenAI
        </p>
        <button
          onClick={openVerification}
          disabled={phase === "polling"}
          className="flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-[var(--radius-sm)] bg-gold/15 text-gold text-[11px] font-medium hover:bg-gold/25 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ExternalLink size={12} />
          Open OpenAI verification page
        </button>
      </div>

      {phase === "polling" && (
        <div className="flex items-center gap-2">
          <Loader2 size={12} className="animate-spin text-text-muted" />
          <p className="text-[10px] text-text-faint">Waiting for you to authorize...</p>
        </div>
      )}
    </div>
  );
}
