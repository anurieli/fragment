"use client";

import { create } from "zustand";
import type { ReviewReturn, StoredReview } from "@/lib/types";
import { generateId } from "@/lib/utils";
import { loadReviewsForPiece, saveReview, deleteReview } from "@/lib/persistence";
import { shareKeyFor } from "@/lib/sharing/share-key";
import { useContentStore } from "@/stores/content-store";

interface ReviewState {
  /** Reviews loaded so far, keyed by their own id. Populated lazily per fragment. */
  reviews: Record<string, StoredReview>;
  /** Which fragments have had their review history loaded from Dexie already. */
  loadedPieceIds: Set<string>;

  /** Loads (and caches) review history for a fragment. Safe to call repeatedly. */
  loadForPiece: (pieceId: string) => Promise<void>;
  /** Returns cached reviews for a fragment, newest first. */
  listForPiece: (pieceId: string) => StoredReview[];
  /** Persists a freshly-imported `ReviewReturn` as history for `pieceId`. */
  saveReviewReturn: (pieceId: string, review: ReviewReturn) => Promise<StoredReview>;
  /**
   * Persists a review that arrived over the network rather than as a file.
   *
   * Keyed on the guest id instead of a fresh random one, so checking for
   * comments twice updates that reviewer's card rather than stacking a second
   * copy of it. A reviewer who adds a comment tomorrow replaces their entry;
   * that is the same "resend the whole set" model the review page uses.
   */
  saveHostedReview: (
    pieceId: string,
    guestId: string,
    review: ReviewReturn,
  ) => Promise<StoredReview>;
  removeReview: (id: string) => Promise<void>;
}

/** Deterministic local id for a hosted reviewer's card. */
export function hostedReviewId(guestId: string): string {
  return `hosted:${guestId}`;
}

/**
 * The id a fragment's reviews are filed under on the server side of the
 * conversation. Falls back to the fragment id for a fragment the content store
 * has not hydrated yet, which is what an unmigrated fragment would key under
 * anyway.
 */
function shareKeyForPieceId(pieceId: string): string {
  const piece = useContentStore.getState().pieces[pieceId];
  return piece ? shareKeyFor(piece) : pieceId;
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  reviews: {},
  loadedPieceIds: new Set(),

  loadForPiece: async (pieceId) => {
    if (get().loadedPieceIds.has(pieceId)) return;
    const rows = await loadReviewsForPiece(pieceId);
    set((s) => {
      const reviews = { ...s.reviews };
      for (const row of rows) reviews[row.id] = row;
      const loadedPieceIds = new Set(s.loadedPieceIds);
      loadedPieceIds.add(pieceId);
      return { reviews, loadedPieceIds };
    });
  },

  listForPiece: (pieceId) => {
    // Two keys, for the same reason loadReviewsForPiece reads two: a review
    // that came back before the switchover carries only the note id it was
    // filed under, and matching on the fragment id alone would hide it.
    const shareKey = shareKeyForPieceId(pieceId);
    return Object.values(get().reviews)
      .filter((r) => r.pieceId === pieceId || r.noteId === shareKey)
      .sort((a, b) => b.receivedAt - a.receivedAt);
  },

  saveReviewReturn: async (pieceId, review) => {
    const stored: StoredReview = {
      ...review,
      id: generateId(),
      pieceId,
      noteId: shareKeyForPieceId(pieceId),
      receivedAt: Date.now(),
    };
    set((s) => ({ reviews: { ...s.reviews, [stored.id]: stored } }));
    await saveReview(stored);
    return stored;
  },

  saveHostedReview: async (pieceId, guestId, review) => {
    const stored: StoredReview = {
      ...review,
      id: hostedReviewId(guestId),
      pieceId,
      noteId: shareKeyForPieceId(pieceId),
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
