"use client";

import { create } from "zustand";
import { generateId } from "@/lib/utils";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: string;
  message: string;
  action?: ToastAction;
}

interface ToastState {
  toasts: Toast[];
  /** `action` (e.g. an Undo button) is optional and additive — existing showToast(message) callers are unaffected. Toasts with an action stay up longer so there's time to click it. */
  showToast: (message: string, action?: ToastAction) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  showToast: (message, action) => {
    const id = generateId();
    set((s) => ({ toasts: [...s.toasts, { id, message, action }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, action ? 5000 : 3000);
  },

  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));
