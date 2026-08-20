import { describe, expect, it } from "vitest";
import { AGENTS } from "@/lib/agents/registry";
import {
  buildNoteCreationPrompt,
  DEFAULT_NOTE_CREATION_PROMPT,
} from "@/lib/defaults";

describe("content generation prompt", () => {
  it("ships as the draft writer agent default", () => {
    expect(AGENTS.find((agent) => agent.id === "draft-writer")?.defaultPrompt).toBe(
      DEFAULT_NOTE_CREATION_PROMPT,
    );
  });

  it("builds the chosen format and length into the server prompt", () => {
    const rendered = buildNoteCreationPrompt("essay", "short");
    expect(rendered).toContain("Shape it as an essay");
    expect(rendered).toContain("Keep it short: roughly 150-300 words");
    expect(rendered).toContain("{goal}");
    expect(rendered).toContain("{userInstruction}");
  });

  it("defaults to freeform and automatic length", () => {
    const rendered = buildNoteCreationPrompt();
    expect(rendered).toContain("Use whatever structure fits the content best");
    expect(rendered).toContain("Choose a length that fits the subject and format");
  });
});
