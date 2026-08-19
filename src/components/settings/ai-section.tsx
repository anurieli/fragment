"use client";

import { useState } from "react";
import { Bot, Layers } from "lucide-react";
import { ProviderSettings } from "./provider-settings";
import { AgentsSection } from "./agents/agents-section";

/**
 * AI settings, in two halves: the accounts that power it, and the agents that
 * spend it.
 *
 * This used to be one long scroll with a hand-built panel per process, which
 * meant every new agent needed a new component and the list of what Fragment's
 * AI does existed only in this file's imports. Agents now render from the
 * registry.
 */
type AiSubSection = "providers" | "agents";

const SUB_NAV: {
  id: AiSubSection;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}[] = [
  { id: "providers", label: "Providers", icon: Layers },
  { id: "agents", label: "Agents", icon: Bot },
];

export function AiSection() {
  const [active, setActive] = useState<AiSubSection>("providers");

  return (
    <div className="flex h-full">
      {/* Sub-nav */}
      <nav className="w-[120px] shrink-0 border-r border-border py-6 space-y-0.5">
        {SUB_NAV.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActive(item.id)}
              className={`w-full flex items-center gap-2 px-4 py-2 text-[11px] transition-colors duration-150 ${
                isActive
                  ? "text-gold bg-gold-muted"
                  : "text-text-muted hover:text-text-secondary hover:bg-surface-2"
              }`}
            >
              <Icon size={12} />
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8">
        {active === "providers" ? (
          <div>
            <h3 className="text-base font-[family-name:var(--font-display)] text-text-primary mb-1">
              AI Providers
            </h3>
            <p className="text-[11px] text-text-faint mb-5">
              Connect your accounts to power AI features.
            </p>
            <div className="max-w-[480px]">
              <ProviderSettings />
            </div>
          </div>
        ) : (
          <AgentsSection />
        )}
      </div>
    </div>
  );
}
