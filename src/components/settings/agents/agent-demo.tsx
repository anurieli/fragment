"use client";

import { useState } from "react";

/**
 * A short recording of an agent at work. Most agents do not have one yet, and
 * the earlier panels filled that gap with an instruction to drop a file at a
 * path, which reads like a bug to anyone who is not us. A missing recording
 * now takes up no space at all.
 */
export function AgentDemo({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  return (
    <div className="w-full rounded-[var(--radius-default)] border border-border-strong bg-surface-2 overflow-hidden">
      <video
        src={src}
        autoPlay
        loop
        muted
        playsInline
        onError={() => setFailed(true)}
        className="w-full h-auto"
      />
    </div>
  );
}
