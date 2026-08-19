"use client";

import { createContext, useContext } from "react";

/**
 * A way for something deep inside AI settings to send the reader to the
 * Providers tab. The model dropdown needs it: the honest answer to "where are
 * the rest of the models" is "you have not connected that provider yet", and
 * an answer you cannot act on from where you are standing is half an answer.
 *
 * Deliberately a context with a null default rather than a required prop.
 * ModelSelector renders outside AI settings too, and there the same sentence
 * still holds without a button to press.
 */
export interface AiNav {
  goToProviders: () => void;
}

const AiNavContext = createContext<AiNav | null>(null);

export const AiNavProvider = AiNavContext.Provider;

export function useAiNav(): AiNav | null {
  return useContext(AiNavContext);
}
