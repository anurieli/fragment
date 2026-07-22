"use client";

import { useState } from "react";
import { X, ChevronDown, ChevronRight } from "lucide-react";
import { ProviderSettings } from "./provider-settings";
import { LabelingSettings } from "./labeling-settings";
import { GenerationSettings } from "./generation-settings";

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [openSection, setOpenSection] = useState<string | null>("providers");

  function toggle(section: string) {
    setOpenSection((prev) => (prev === section ? null : section));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-[560px] max-h-[80vh] bg-surface border border-border-strong rounded-[var(--radius-lg)] shadow-2xl overflow-hidden flex flex-col"
        style={{ animation: "fadeIn 0.15s ease-out" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-medium text-text-primary">Settings</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-[var(--radius-sm)] text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-all duration-150"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {/* AI Providers */}
          <Section
            title="AI Providers"
            isOpen={openSection === "providers"}
            onToggle={() => toggle("providers")}
          >
            <ProviderSettings />
          </Section>

          {/* Snippet Labeling */}
          <Section
            title="Snippet Labeling"
            isOpen={openSection === "labeling"}
            onToggle={() => toggle("labeling")}
          >
            <LabelingSettings />
          </Section>

          {/* Slash Command Generation */}
          <Section
            title="Slash Command Generation"
            isOpen={openSection === "generation"}
            onToggle={() => toggle("generation")}
          >
            <GenerationSettings />
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  isOpen,
  onToggle,
  children,
}: {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-default)] border border-border-strong bg-surface-2 overflow-hidden">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full px-4 py-3 text-left hover:bg-surface-3 transition-colors duration-150"
      >
        {isOpen ? (
          <ChevronDown size={14} className="text-text-muted" />
        ) : (
          <ChevronRight size={14} className="text-text-muted" />
        )}
        <span className="text-xs font-medium text-text-secondary uppercase tracking-wide">
          {title}
        </span>
      </button>
      {isOpen && (
        <div className="px-4 pb-4 space-y-4" style={{ animation: "fadeIn 0.12s ease-out" }}>
          {children}
        </div>
      )}
    </div>
  );
}
