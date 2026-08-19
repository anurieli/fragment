import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTE_CREATION_PROMPT,
  DEFAULT_SETTINGS,
  renderNoteCreationPrompt,
} from "@/lib/defaults";

/**
 * Content generation's prompt is editable, which is only safe if the format
 * and length the writer picks survive the edit. They do because they are
 * placeholders in the template rather than text baked in when it is composed.
 */
describe("content generation prompt", () => {
  it("ships as the default the agent runs", () => {
    expect(DEFAULT_SETTINGS.contentGeneration.promptTemplate).toBe(DEFAULT_NOTE_CREATION_PROMPT);
  });

  it("substitutes the format and length, and leaves the rest for the server", () => {
    const rendered = renderNoteCreationPrompt(DEFAULT_NOTE_CREATION_PROMPT, "essay", "short");
    expect(rendered).not.toContain("{format}");
    expect(rendered).not.toContain("{length}");
    expect(rendered).toContain("Shape it as an essay");
    expect(rendered).toContain("roughly 150-300 words");
    // /api/generate fills these, so they must still be here when it arrives.
    for (const token of ["{goal}", "{audience}", "{tone}", "{remember}", "{contextAbove}", "{userInstruction}"]) {
      expect(rendered).toContain(token);
    }
  });

  it("defaults to freeform and auto when nothing was picked", () => {
    const rendered = renderNoteCreationPrompt(DEFAULT_NOTE_CREATION_PROMPT);
    expect(rendered).toContain("Use whatever structure fits the content best");
    expect(rendered).toContain("Choose a length that fits the subject and format");
  });

  it("leaves an edited template that dropped the placeholders alone", () => {
    const edited = "Write it however you like. The user said: {userInstruction}";
    expect(renderNoteCreationPrompt(edited, "blog", "long")).toBe(edited);
  });
});
