"use client";

import { MessageSquarePlus } from "lucide-react";

interface FeedbackButtonProps {
  onClick: () => void;
}

export function FeedbackButton({ onClick }: FeedbackButtonProps) {
  return (
    <button
      onClick={onClick}
      title="Send Feedback"
      aria-label="Send Feedback"
      className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius-lg)] text-[12px] text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-colors duration-150 w-full"
    >
      <MessageSquarePlus size={15} />
      Feedback
    </button>
  );
}
