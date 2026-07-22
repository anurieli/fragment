"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { generateId } from "@/lib/utils";

const BUILT_IN_PRESETS = [
  {
    id: "editorial",
    label: "Editorial",
    desc: "Clean, modern, slightly abstract",
    gradient: "linear-gradient(135deg, #d4c5a9 0%, #f5f0e8 50%, #e8dcc8 100%)",
  },
  {
    id: "photorealistic",
    label: "Photorealistic",
    desc: "Journalism, reporting, documentation",
    gradient: "linear-gradient(135deg, #5b8fb9 0%, #89b4d4 40%, #6d9e5e 100%)",
  },
  {
    id: "sketch",
    label: "Sketch",
    desc: "Hand-drawn, personal, zine-like",
    gradient: "linear-gradient(135deg, #e8e4de 0%, #d5cfc4 50%, #c8c1b4 100%)",
  },
  {
    id: "diagram",
    label: "Diagram",
    desc: "Technical, explainers, tutorials",
    gradient: "linear-gradient(135deg, #2a3a4a 0%, #3d5a6e 50%, #1e2d3d 100%)",
  },
  {
    id: "minimalist",
    label: "Minimalist",
    desc: "Clean, text-focused publications",
    gradient: "linear-gradient(135deg, #f8f6f2 0%, #eae6de 50%, #f2efe8 100%)",
  },
  {
    id: "watercolor",
    label: "Watercolor",
    desc: "Soft, organic, painterly textures",
    gradient: "linear-gradient(135deg, #c9a8d4 0%, #a8c9d4 40%, #d4c9a8 100%)",
  },
] as const;

export function ImageGenerationSection() {
  const { settings, updateImageGeneration } = useSettingsStore();
  const imgGen = settings.imageGeneration;
  const [newLabel, setNewLabel] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);

  const allPresets = [
    ...BUILT_IN_PRESETS,
    ...imgGen.customPresets.map((p) => ({
      ...p,
      gradient:
        "linear-gradient(135deg, var(--color-surface-3) 0%, var(--color-surface-hover) 100%)",
    })),
  ];

  function handleCreatePreset() {
    if (!newLabel.trim()) return;
    const preset = {
      id: generateId(),
      label: newLabel.trim(),
      description: newDesc.trim(),
    };
    updateImageGeneration({
      customPresets: [...imgGen.customPresets, preset],
      stylePreset: preset.id,
    });
    setNewLabel("");
    setNewDesc("");
    setShowCreateForm(false);
  }

  function handleDeleteCustomPreset(id: string) {
    updateImageGeneration({
      customPresets: imgGen.customPresets.filter((p) => p.id !== id),
      stylePreset:
        imgGen.stylePreset === id ? "editorial" : imgGen.stylePreset,
    });
  }

  const isCustomPreset = (id: string) =>
    imgGen.customPresets.some((p) => p.id === id);

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-8 max-w-[640px] mx-auto">
        <h2 className="text-xl font-[family-name:var(--font-display)] text-text-primary mb-1">
          Photo Generation
        </h2>
        <p className="text-xs text-text-muted mb-8">
          Define your visual identity. This theme applies to all AI-generated
          images so your visuals stay consistent.
        </p>

        {/* 1. Style Presets */}
        <div className="mb-8">
          <label className="block text-[11px] text-text-muted font-[family-name:var(--font-mono)] uppercase tracking-wider mb-3">
            Style Preset
          </label>
          <div className="grid grid-cols-3 gap-3">
            {allPresets.map((preset) => {
              const isActive = imgGen.stylePreset === preset.id;
              const isCustom = isCustomPreset(preset.id);
              return (
                <button
                  key={preset.id}
                  onClick={() =>
                    updateImageGeneration({ stylePreset: preset.id })
                  }
                  className={`group relative text-left rounded-[var(--radius-default)] border overflow-hidden transition-all duration-150 ${
                    isActive
                      ? "border-gold ring-1 ring-gold/20"
                      : "border-border-strong hover:border-border-active"
                  }`}
                >
                  {/* Preview swatch */}
                  <div
                    className="h-16 w-full"
                    style={{ background: preset.gradient }}
                  />
                  {/* Label */}
                  <div className="px-3 py-2.5 bg-surface-2">
                    <span
                      className={`block text-xs font-medium ${
                        isActive ? "text-gold" : "text-text-secondary"
                      }`}
                    >
                      {preset.label}
                    </span>
                    <span className="block text-[10px] text-text-faint mt-0.5 leading-snug">
                      {"desc" in preset ? preset.desc : preset.description}
                    </span>
                  </div>
                  {/* Delete for custom presets */}
                  {isCustom && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteCustomPreset(preset.id);
                      }}
                      className="absolute top-1.5 right-1.5 p-1 rounded-[var(--radius-sm)] bg-bg/70 text-text-faint hover:text-red hover:bg-red-muted opacity-0 group-hover:opacity-100 transition-all duration-150"
                    >
                      <X size={10} />
                    </button>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. Theme Description */}
        <div className="mb-8">
          <label className="block text-[11px] text-text-muted font-[family-name:var(--font-mono)] uppercase tracking-wider mb-1.5">
            Theme Description
          </label>
          <textarea
            value={imgGen.themeDescription}
            onChange={(e) =>
              updateImageGeneration({ themeDescription: e.target.value })
            }
            placeholder={`Describe your visual style in natural language. For example:\n\n"Warm, muted earth tones. Soft natural lighting. Editorial photography feel with negative space for text overlay. Never cartoonish."`}
            rows={5}
            className="w-full bg-surface-3 border border-border-strong rounded-[var(--radius-sm)] px-3 py-2 text-xs text-text-secondary font-[family-name:var(--font-body)] leading-relaxed outline-none focus:border-border-active transition-colors duration-150 resize-y placeholder:text-text-faint"
          />
          <p className="text-[10px] text-text-faint mt-1.5">
            Prepended to every image prompt as a style directive. Overrides the
            preset for finer control.
          </p>
        </div>

        {/* 3. Create Your Own */}
        <div>
          <label className="block text-[11px] text-text-muted font-[family-name:var(--font-mono)] uppercase tracking-wider mb-2">
            Create Your Own Preset
          </label>
          {showCreateForm ? (
            <div className="rounded-[var(--radius-default)] border border-border-strong bg-surface-2 p-4 space-y-3">
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Preset name"
                className="w-full bg-surface-3 border border-border-strong rounded-[var(--radius-sm)] px-3 py-2 text-xs text-text-primary placeholder:text-text-faint outline-none focus:border-border-active transition-colors duration-150"
                autoFocus
              />
              <input
                type="text"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Short description (e.g., 'Bold neon cyberpunk aesthetic')"
                className="w-full bg-surface-3 border border-border-strong rounded-[var(--radius-sm)] px-3 py-2 text-xs text-text-primary placeholder:text-text-faint outline-none focus:border-border-active transition-colors duration-150"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreatePreset();
                }}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleCreatePreset}
                  disabled={!newLabel.trim()}
                  className="px-3 py-1.5 rounded-[var(--radius-sm)] text-[11px] font-medium bg-gold text-bg hover:bg-gold-hover transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Create
                </button>
                <button
                  onClick={() => {
                    setShowCreateForm(false);
                    setNewLabel("");
                    setNewDesc("");
                  }}
                  className="px-3 py-1.5 rounded-[var(--radius-sm)] text-[11px] text-text-muted hover:text-text-secondary transition-colors duration-150"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowCreateForm(true)}
              className="flex items-center gap-2 px-4 py-3 w-full rounded-[var(--radius-default)] border border-dashed border-border-strong text-xs text-text-muted hover:text-text-secondary hover:border-border-active hover:bg-surface-2 transition-all duration-150"
            >
              <Plus size={14} />
              Create a custom style preset
            </button>
          )}
        </div>

        {/* Reference images placeholder */}
        <div className="mt-8">
          <label className="block text-[11px] text-text-muted font-[family-name:var(--font-mono)] uppercase tracking-wider mb-2">
            Reference Images
          </label>
          <div className="rounded-[var(--radius-default)] border border-dashed border-border-strong p-6 text-center">
            <p className="text-[11px] text-text-faint">
              Drag and drop reference images to define your visual style.
              Coming soon.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
