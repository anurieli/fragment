"use client";

import { create } from "zustand";
import type { ReviewReturn, StoredReview } from "@/lib/types";
import { generateId } from "@/lib/utils";
import { loadReviewsForNote, saveReview, deleteReview } from "@/lib/persistence";

interface ReviewState {
  /** Reviews loaded so far, keyed by their own id. Populated lazily per-note. */
  reviews: Record<string, StoredReview>;
  /** Which noteIds have had their review history loaded from Dexie already. */
  loadedNoteIds: Set<string>;

  /** Loads (and caches) review history for a note. Safe to call repeatedly. */
  loadForNote: (noteId: string) => Promise<void>;
  /** Returns cached reviews for a note, newest first. */
  listForNote: (noteId: string) => StoredReview[];
  /** Persists a freshly-imported `ReviewReturn` as history for `noteId`. */
  saveReviewReturn: (noteId: string, review: ReviewReturn) => Promise<StoredReview>;
  /**
   * Persists a review that arrived over the network rather than as a file.
   *
   * Keyed on the guest id instead of a fresh random one, so checking for
   * comments twice updates that reviewer's card rather than stacking a second
   * copy of it. A reviewer who adds a comment tomorrow replaces their entry;
   * that is the same "resend the whole set" model the review page uses.
   */
  saveHostedReview: (
    noteId: string,
    guestId: string,
    review: ReviewReturn,
  ) => Promise<StoredReview>;
  removeReview: (id: string) => Promise<void>;
}

/** Deterministic local id for a hosted reviewer's card. */
export function hostedReviewId(guestId: string): string {
  return `hosted:${guestId}`;
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  reviews: {},
  loadedNoteIds: new Set(),

  loadForNote: async (noteId) => {
    if (get().loadedNoteIds.has(noteId)) return;
    const rows = await loadReviewsForNote(noteId);
    set((s) => {
      const reviews = { ...s.reviews };
      for (const row of rows) reviews[row.id] = row;
      const loadedNoteIds = new Set(s.loadedNoteIds);
      loadedNoteIds.add(noteId);
      return { reviews, loadedNoteIds };
    });
  },

  listForNote: (noteId) => {
    return Object.values(get().reviews)
      .filter((r) => r.noteId === noteId)
      .sort((a, b) => b.receivedAt - a.receivedAt);
  },

  saveReviewReturn: async (noteId, review) => {
    const stored: StoredReview = {
      ...review,
      id: generateId(),
      noteId,
      receivedAt: Date.now(),
    };
    set((s) => ({ reviews: { ...s.reviews, [stored.id]: stored } }));
    await saveReview(stored);
    return stored;
  },

  saveHostedReview: async (noteId, guestId, review) => {
    const stored: StoredReview = {
      ...review,
      id: hostedReviewId(guestId),
      noteId,
      receivedAt: Date.now(),
    };
    set((s) => ({ reviews: { ...s.reviews, [stored.id]: stored } }));
    await saveReview(stored);
    return stored;
  },

  removeReview: async (id) => {
    set((s) => {
      const reviews = { ...s.reviews };
      delete reviews[id];
      return { reviews };
    });
    await deleteReview(id);
  },
}));
