"use client";

import { useLayoutEffect, useRef } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { truncateLines } from "@/lib/utils";

export function FloatingDragCard() {
  const isVisible = useAppStore((s) => !!s.floatingDragCard);
  const content = useAppStore((s) => s.floatingDragCard?.content ?? "");
  const label = useAppStore((s) => s.floatingDragCard?.label ?? null);
  const labelStatus = useAppStore((s) => s.floatingDragCard?.labelStatus ?? "loading");

  const cardRef = useRef<HTMLDivElement>(null);
  const positionedRef = useRef(false);

  // Track cursor position via both mousemove (custom drag) and dragover (native DnD fallback).
  // Position is applied directly to the DOM ref — no React re-renders needed.
  // The editor's mousedown handler ALSO positions the card on mousemove, so this effect
  // serves as a backup and handles native DnD cases (pending-return drags).
  useLayoutEffect(() => {
    if (!isVisible) {
      positionedRef.current = false;
      return;
    }

    let rafId: number | null = null;
    let lastX = 0;
    let lastY = 0;

    const update = (clientX: number, clientY: number) => {
      lastX = clientX;
      lastY = clientY;
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (cardRef.current) {
          cardRef.current.style.transform = `translate(${lastX + 16}px, ${lastY + 16}px)`;
          if (!positionedRef.current) {
            cardRef.current.style.opacity = "1";
            positionedRef.current = true;
          }
        }
      });
    };

    const onDragOver = (e: DragEvent) => update(e.clientX, e.clientY);
    const onMouseMove = (e: MouseEvent) => update(e.clientX, e.clientY);

    document.addEventListener("dragover", onDragOver);
    document.addEventListener("mousemove", onMouseMove);
    return () => {
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("mousemove", onMouseMove);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [isVisible]);

  if (!isVisible) return null;

  const preview = truncateLines(content, 3);
  const showLabelRow = !(labelStatus === "idle" && !label);

  return (
    <div
      ref={cardRef}
      data-floating-card
      className="fixed top-0 left-0 z-50 pointer-events-none"
      style={{ opacity: 0 }}
    >
      <div
        className="w-52 rounded-[var(--radius-default)] bg-surface-3 border border-gold-strong shadow-2xl overflow-hidden"
        style={{ animation: "floatIn 0.12s ease-out" }}
      >
        {/* Label area. Skipped entirely while idle with nothing to say — a
            passage being moved within the draft is never labelled, and an
            empty row would leave dead space at the top of the card. */}
        {showLabelRow && (
        <div className="flex items-start gap-2 px-3 pt-2.5 pb-1.5">
          {labelStatus === "loading" ? (
            <>
              <Loader2
                size={10}
                className="text-gold shrink-0"
                style={{ animation: "spin 1s linear infinite" }}
              />
              <span className="text-[10px] text-text-muted font-[family-name:var(--font-mono)] whitespace-normal break-words leading-relaxed">
                Labeling...
              </span>
            </>
          ) : labelStatus === "error" ? (
            <>
              <AlertCircle size={10} className="text-red shrink-0" />
              <span className="text-[10px] text-text-muted font-[family-name:var(--font-mono)] whitespace-normal break-words leading-relaxed">
                Label failed
              </span>
            </>
          ) : label ? (
            <span className="text-[10px] text-gold font-[family-name:var(--font-mono)] font-medium whitespace-normal break-words leading-relaxed">
              {label}
            </span>
          ) : null}
        </div>
        )}

        {/* Text preview */}
        <div className={`px-3 pb-2.5 ${showLabelRow ? "" : "pt-2.5"}`}>
          <p className="text-[11px] leading-relaxed text-text-secondary whitespace-pre-wrap break-words font-[family-name:var(--font-body)] line-clamp-3">
            {preview}
          </p>
        </div>
      </div>
    </div>
  );
}
