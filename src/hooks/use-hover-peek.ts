"use client";

import { useCallback, useEffect, useRef } from "react";

/** Grace period before a peeked panel collapses, in ms. */
export const PEEK_CLOSE_DELAY = 300;

interface HoverPeekOptions {
  /** While true, leaving never closes: the panel was opened deliberately. */
  pinned: boolean;
  /** Extra reasons to hold the panel open, e.g. an in-flight drag. */
  held?: boolean;
  onOpen: () => void;
  onClose: () => void;
}

export interface HoverPeek {
  /** Put on the edge strip: entering peeks the panel open. */
  onTriggerEnter: () => void;
  onTriggerLeave: () => void;
  /** Put on the panel itself, so crossing into it cancels the close. */
  onPanelEnter: () => void;
  onPanelLeave: () => void;
}

/**
 * Hover to peek, click to pin — the gesture the Snip Bar's pull-tab has always
 * had, factored out so the left rail behaves identically rather than growing a
 * second, subtly different copy.
 *
 * The delay on close is the whole reason this needs state: the pointer crosses
 * a few pixels of gap between the strip and the panel edge during ordinary
 * movement, and without a grace period the panel snaps shut on the way in.
 */
export function useHoverPeek({ pinned, held, onOpen, onClose }: HoverPeekOptions): HoverPeek {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether the pointer is currently inside the trigger. React delivers
  // onMouseEnter via delegated mouseover, so swapping the panel's contents
  // under a stationary cursor fires "enter" again. Without this latch,
  // collapsing the sidebar with the button inside it would immediately peek
  // it back open and the collapse would look like it did nothing.
  const insideRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // A pending close must not fire after the component is gone.
  useEffect(() => clearTimer, [clearTimer]);

  const scheduleClose = useCallback(() => {
    if (pinned || held) return;
    clearTimer();
    timerRef.current = setTimeout(onClose, PEEK_CLOSE_DELAY);
  }, [pinned, held, clearTimer, onClose]);

  const onTriggerEnter = useCallback(() => {
    if (insideRef.current) return;
    insideRef.current = true;
    clearTimer();
    onOpen();
  }, [clearTimer, onOpen]);

  const onTriggerLeave = useCallback(() => {
    insideRef.current = false;
    scheduleClose();
  }, [scheduleClose]);

  return {
    onTriggerEnter,
    onTriggerLeave,
    onPanelEnter: clearTimer,
    onPanelLeave: scheduleClose,
  };
}
