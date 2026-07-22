"use client";

import { Check } from "lucide-react";
import { useToastStore } from "@/hooks/use-toast";

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 items-center">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="flex items-center gap-2.5 bg-surface-3 border border-border-strong rounded-[var(--radius-lg)] px-5 py-3 shadow-2xl"
          style={{ animation: "slideUp 0.2s ease-out" }}
        >
          <Check size={13} className="text-green shrink-0" />
          <span className="text-[12px] text-text-secondary whitespace-nowrap">
            {toast.message}
          </span>
        </div>
      ))}
    </div>
  );
}
