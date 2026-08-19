"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { ChevronDown, Loader2, Search } from "lucide-react";
import { Portal } from "@/components/common/portal";
import { useMenuPlacement } from "@/hooks/use-menu-placement";
import { Z_FLOATING } from "@/lib/z-layers";
import type { AIProvider } from "@/lib/providers";
import type { ProviderModel } from "@/lib/types";
import { useSettingsStore } from "@/stores/settings-store";
import { getProviderKey, isApiKeyProvider } from "@/lib/ai/provider-runtime";
import { useProviderModels } from "@/hooks/use-provider-models";

/** The list's own height cap (the old max-h-64), now that an inline
 * viewport-aware maxHeight is what actually lands on the element. */
const MAX_LIST_HEIGHT = 256;

interface ModelSelectorProps {
  value: string;
  provider: AIProvider;
  onChange: (modelId: string) => void;
}

export function ModelSelector({ value, provider, onChange }: ModelSelectorProps) {
  const { models, loading, error: loadError } = useProviderModels(provider);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // Settings panels scroll, so this list was cut off at the panel's edge on
  // any field far enough down. Left-aligned and matched to the field's width,
  // which is what `w-full` used to do before it left the container.
  const placement = useMenuPlacement(open && !loading, containerRef, dropdownRef, "left");
  const credentials = useSettingsStore((s) => s.settings.providerCredentials);
  const codexEnabledModels = useSettingsStore((s) => s.settings.codexEnabledModels);

  useEffect(() => {
    if (open && searchRef.current) {
      searchRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      // The list is portaled to <body> now, so it is no longer inside
      // containerRef: without checking both, the first click on a model would
      // close the list before the click could land on it.
      if (containerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
      setSearch("");
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const grouped = useMemo(() => {
    // Codex: honor the user's model allowlist (empty = all models)
    const visible =
      provider === "codex" && codexEnabledModels.length > 0
        ? models.filter((m) => codexEnabledModels.includes(m.id))
        : models;

    const term = search.toLowerCase();
    const filtered = term
      ? visible.filter(
          (m) =>
            m.name.toLowerCase().includes(term) ||
            m.id.toLowerCase().includes(term) ||
            m.provider.toLowerCase().includes(term),
        )
      : visible;

    const groups: Record<string, ProviderModel[]> = {};
    for (const m of filtered) {
      (groups[m.provider] ??= []).push(m);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [models, search, provider, codexEnabledModels]);

  const selectedName =
    models.find((m) => m.id === value)?.name ?? value;

  const emptyMessage =
    provider === "ollama"
      ? "No local models found. Is Ollama running?"
      : provider === "codex"
        ? !credentials.codexAccessToken
          ? "No models found. Sign in with ChatGPT first."
          : loadError
            ? `Couldn't load models: ${loadError}`
            : "No models found for your ChatGPT plan."
        : isApiKeyProvider(provider) && !getProviderKey(provider, credentials)
          ? "Add your API key in Providers first."
          : loadError
            ? `Couldn't load models: ${loadError}`
            : "No models found";

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between bg-surface-3 border border-border-strong rounded-[var(--radius-sm)] px-3 py-2 text-xs text-text-primary outline-none hover:border-border-active focus:border-border-active transition-colors duration-150"
      >
        <span className="truncate text-left">
          {loading ? "Loading models..." : selectedName}
        </span>
        {loading ? (
          <Loader2 size={12} className="animate-spin text-text-muted shrink-0 ml-2" />
        ) : (
          <ChevronDown size={12} className="text-text-muted shrink-0 ml-2" />
        )}
      </button>

      {open && !loading && (
        <Portal>
        <div
          ref={dropdownRef}
          className={`fixed ${Z_FLOATING} bg-surface-2 border border-border-strong rounded-[var(--radius-sm)] shadow-xl overflow-hidden flex flex-col`}
          style={{
            ...placement.style,
            width: placement.triggerWidth || undefined,
            // The list's own 16rem cap, unless there is less room than that.
            // placement.style carries the available room, which for a list
            // this long is nearly always the taller of the two.
            maxHeight: Math.min(placement.maxHeight || MAX_LIST_HEIGHT, MAX_LIST_HEIGHT),
          }}
        >
          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <Search size={12} className="text-text-muted shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={provider === "ollama" ? "Search local models..." : "Search models or providers..."}
              className="w-full bg-transparent text-xs text-text-primary placeholder:text-text-faint outline-none"
            />
          </div>

          {/* Model list */}
          <div className="flex-1 overflow-y-auto">
            {grouped.length === 0 ? (
              <div className="px-3 py-4 text-[11px] text-text-faint text-center">
                {emptyMessage}
              </div>
            ) : (
              grouped.map(([groupName, providerModels]) => (
                <div key={groupName}>
                  <div className="px-3 py-1.5 text-[10px] font-medium text-text-muted uppercase tracking-wider bg-surface-3 sticky top-0">
                    {groupName}
                  </div>
                  {providerModels.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        onChange(m.id);
                        setOpen(false);
                        setSearch("");
                      }}
                      className={`w-full text-left px-3 py-1.5 text-xs transition-colors duration-100 ${
                        m.id === value
                          ? "bg-gold/10 text-gold"
                          : "text-text-secondary hover:bg-surface-3"
                      }`}
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
        </Portal>
      )}
    </div>
  );
}
