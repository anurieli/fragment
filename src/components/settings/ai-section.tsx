"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { Layers, Scissors, Wand2, Pencil } from "lucide-react";
import { ProviderSettings } from "./provider-settings";
import { LabelingSettings } from "./labeling-settings";
import { GenerationSettings } from "./generation-settings";
import { InlineEditSettings } from "./inline-edit-settings";

type AiSubSection = "providers" | "snip" | "flow" | "refine";

const SUB_NAV: {
  id: AiSubSection;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}[] = [
  { id: "providers", label: "Providers", icon: Layers },
  { id: "snip", label: "Snip", icon: Scissors },
  { id: "flow", label: "Flow", icon: Wand2 },
  { id: "refine", label: "Refine", icon: Pencil },
];

export function AiSection() {
  const [active, setActive] = useState<AiSubSection>("providers");
  const contentRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<AiSubSection, HTMLDivElement | null>>({
    providers: null,
    snip: null,
    flow: null,
    refine: null,
  });

  function scrollTo(id: AiSubSection) {
    setActive(id);
    sectionRefs.current[id]?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  const handleScroll = useCallback(() => {
    const container = contentRef.current;
    if (!container) return;

    const containerTop = container.getBoundingClientRect().top;
    const sections: AiSubSection[] = ["refine", "flow", "snip", "providers"];

    for (const id of sections) {
      const el = sectionRefs.current[id];
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.top <= containerTop + 120) {
          setActive(id);
          return;
        }
      }
    }
    setActive("providers");
  }, []);

  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

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
              onClick={() => scrollTo(item.id)}
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
      <div ref={contentRef} className="flex-1 overflow-y-auto p-8 space-y-12">
        {/* AI Providers */}
        <div
          ref={(el) => {
            sectionRefs.current.providers = el;
          }}
        >
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

        {/* Divider */}
        <hr className="border-border" />

        {/* Snip */}
        <div
          ref={(el) => {
            sectionRefs.current.snip = el;
          }}
        >
          <LabelingSettings />
        </div>

        {/* Divider */}
        <hr className="border-border" />

        {/* Flow */}
        <div
          ref={(el) => {
            sectionRefs.current.flow = el;
          }}
        >
          <GenerationSettings />
        </div>

        {/* Divider */}
        <hr className="border-border" />

        {/* Refine */}
        <div
          ref={(el) => {
            sectionRefs.current.refine = el;
          }}
        >
          <InlineEditSettings />
        </div>
      </div>
    </div>
  );
}
