"use client";

import { useState } from "react";
import { Eye, EyeOff, Plug, Check, Loader2, ExternalLink, RotateCcw } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { useLinkedInConnection } from "@/hooks/use-linkedin-connection";

/**
 * Settings → Integrations: third-party publishing connections that aren't a
 * plain "paste your key" field — today just Composio / LinkedIn (ARI-155).
 * Separate from the "Publishing" group in Profile (Substack URL, Kit key)
 * because this one has real state (connecting / polling / connected /
 * expired), not just a text field.
 */
export function IntegrationsSection() {
  const composioApiKey = useSettingsStore((s) => s.settings.userProfile.composioApiKey);
  const updateUserProfile = useSettingsStore((s) => s.updateUserProfile);

  return (
    <div className="h-full w-full bg-surface rounded-[var(--radius-xl)] flex flex-col overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-3 shrink-0">
        <Plug size={14} className="text-text-muted" />
        <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider font-[family-name:var(--font-mono)]">
          Integrations
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-6 space-y-5">
        <p className="text-[11px] text-text-faint leading-relaxed">
          Connect third-party publishing destinations. Fragment never sees your LinkedIn password —
          Composio hosts the sign-in and holds the token.
        </p>

        <ComposioKeyField value={composioApiKey} onChange={(v) => updateUserProfile({ composioApiKey: v })} />
        <LinkedInConnectCard />
      </div>
    </div>
  );
}

function ComposioKeyField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [visible, setVisible] = useState(false);
  const hasKey = value.trim().length > 0;

  return (
    <div className="rounded-[var(--radius-default)] border border-border-strong bg-surface-3 p-4 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-text-secondary">Composio API Key</span>
        <div
          className={`ml-auto w-2 h-2 rounded-full shrink-0 ${hasKey ? "bg-green" : "bg-text-faint"}`}
          title={hasKey ? "Key set" : "No key"}
        />
      </div>
      <div className="relative">
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Paste your Composio API key"
          className="w-full bg-surface border border-border-strong rounded-[var(--radius-sm)] px-3 py-2 pr-9 text-xs text-text-primary placeholder:text-text-faint outline-none focus:border-border-active transition-colors duration-150"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-text-secondary transition-colors duration-150"
        >
          {visible ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      <p className="text-[10px] text-text-faint leading-relaxed">
        From your Composio dashboard's API keys page. Powers the LinkedIn connection below.
      </p>
    </div>
  );
}

function LinkedInConnectCard() {
  const { phase, status, accountLabel, error, connectedAccountId, hasApiKey, connect, reconnect, disconnect } =
    useLinkedInConnection();

  const busy = phase === "connecting" || phase === "polling" || phase === "checking";
  const isConnected = Boolean(connectedAccountId) && status === "active";
  const needsReconnect = Boolean(connectedAccountId) && (status === "expired" || status === "revoked");

  return (
    <div className="rounded-[var(--radius-default)] border border-border-strong bg-surface-3 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-text-secondary">LinkedIn</span>
        <div className="ml-auto">
          {isConnected ? (
            <span className="flex items-center gap-1.5 text-[11px] text-green">
              <Check size={12} />
              Connected
            </span>
          ) : needsReconnect ? (
            <span className="text-[11px] text-amber-400">
              {status === "revoked" ? "Revoked" : "Expired"}
            </span>
          ) : null}
        </div>
      </div>

      {isConnected && accountLabel && (
        <p className="text-[10px] text-text-muted">Connected as {accountLabel}.</p>
      )}

      <p className="text-[10px] text-text-faint leading-relaxed">
        {isConnected
          ? "Fragment can publish LinkedIn posts directly from the Share menu."
          : "Opens Composio's hosted LinkedIn sign-in in a new tab, then Fragment waits for you to finish there."}
      </p>

      {error && <p className="text-[10px] text-red-400 leading-relaxed">{error}</p>}

      <div className="flex items-center gap-2">
        {isConnected ? (
          <button
            onClick={disconnect}
            className="text-[10px] text-text-faint hover:text-text-muted transition-colors duration-150"
          >
            Disconnect
          </button>
        ) : needsReconnect ? (
          <button
            onClick={reconnect}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] bg-gold/15 text-gold text-[11px] font-medium hover:bg-gold/25 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RotateCcw size={12} />
            Reconnect
          </button>
        ) : (
          <button
            onClick={connect}
            disabled={!hasApiKey || busy}
            title={hasApiKey ? undefined : "Add your Composio API key above first"}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] bg-gold/15 text-gold text-[11px] font-medium hover:bg-gold/25 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {phase === "connecting" ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Starting…
              </>
            ) : phase === "polling" ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Waiting for you to finish…
              </>
            ) : (
              <>
                <ExternalLink size={12} />
                Connect LinkedIn
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
