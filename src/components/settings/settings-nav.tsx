"use client";

import { ArrowLeft, Mic, ImageIcon, Sparkles, ScrollText, User } from "lucide-react";

export type SettingsSection = "profile" | "writing" | "photos" | "ai" | "logs";

const NAV_ITEMS: {
  id: SettingsSection;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}[] = [
  { id: "profile", label: "Profile", icon: User },
  { id: "writing", label: "Brand Voice", icon: Mic },
  { id: "photos", label: "Photo Generation", icon: ImageIcon },
  { id: "ai", label: "AI", icon: Sparkles },
  { id: "logs", label: "API Logs", icon: ScrollText },
];

interface SettingsNavProps {
  activeSection: SettingsSection;
  onSelect: (section: SettingsSection) => void;
  onClose: () => void;
}

export function SettingsNav({
  activeSection,
  onSelect,
  onClose,
}: SettingsNavProps) {
  return (
    <div className="flex flex-col h-full w-[220px] bg-surface rounded-[var(--radius-xl)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-7 pt-6 pb-4 shrink-0">
        <button
          onClick={onClose}
          className="p-2 rounded-[var(--radius-default)] text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-all duration-150"
        >
          <ArrowLeft size={16} />
        </button>
        <span className="font-[family-name:var(--font-display)] text-lg text-text-primary tracking-tight">
          Settings
        </span>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              className={`relative w-full flex items-center gap-3 px-4 py-3 rounded-[var(--radius-lg)] text-[13px] font-medium transition-all duration-150 ${
                isActive
                  ? "bg-surface-3 text-text-primary border border-border-strong"
                  : "text-text-muted hover:text-text-secondary hover:bg-surface-2"
              }`}
            >
              {isActive && (
                <div className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full bg-gold" />
              )}
              <Icon size={15} />
              {item.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
