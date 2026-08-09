/**
 * The one-entity switchover is only finished when the word disappears from the
 * product, not just from the code: a fragment is a fragment, an idea is an
 * idea, and nothing the user reads calls either of them a note. This walks the
 * component tree and fails on "note" wherever a person would see it.
 *
 * It is deliberately a rough parser rather than a real one. The value is
 * catching a careless new string, so it looks at the two places user-visible
 * copy actually lives (JSX text nodes and the four attributes that render as
 * text) and leaves identifiers, comments and import paths alone. Anything it
 * flags that is genuinely fine goes in ALLOWED below, with the reason.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMPONENTS_DIR = join(SRC_DIR, "components");

/** The attributes a screen or a screen reader renders as words. */
const USER_FACING_ATTRIBUTES = "placeholder|title|aria-label|alt";

/**
 * "note" and "notes" as whole words, in any case. Word boundaries keep
 * "Notion", "footnote" and "denote" out of it.
 */
const NOTE_WORD = /\bnotes?\b/i;

/**
 * "piece" and "pieces" as whole words. The wire format and the code still say
 * piece on purpose, but a reader should only ever meet the word "fragment".
 */
const PIECE_WORD = /\bpieces?\b/i;

/**
 * Matches that are not the old vocabulary. `text` is a substring of the
 * offending string, matched inside `file`.
 */
const ALLOWED: readonly { file: string; text: string; why: string }[] = [
  {
    file: "shortform/idea-resources.tsx",
    text: "sources, notes, and assets",
    why: "the three kinds a Resource can be: a link, a note, an asset",
  },
  {
    file: "shortform/idea-resources.tsx",
    text: "Note",
    why: "the option label for a resource whose kind is \"note\"",
  },
  {
    file: "settings/brand-voice/voice-samples-manager.tsx",
    text: "a piece of your writing",
    why: "\"a piece of writing\" is ordinary English, not the entity",
  },
  {
    file: "onboarding/onboarding-flow.tsx",
    text: "a piece of your writing",
    why: "\"a piece of writing\" is ordinary English, not the entity",
  },
  {
    file: "settings/labeling-settings.tsx",
    text: "puzzle pieces",
    why: "a metaphor for rearranging snips, not the entity",
  },
  {
    file: "landing/landing-page.tsx",
    text: "Hold all the pieces",
    why: "headline wordplay on the product name, not the entity",
  },
];

interface Finding {
  file: string;
  text: string;
}

function tsxFilesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...tsxFilesUnder(path));
    else if (path.endsWith(".tsx")) found.push(path);
  }
  return found;
}

/**
 * Comments explain the code to us, not the product to the user, so they are
 * allowed to say "note". Line comments are only stripped when the `//` opens
 * the line, which keeps a URL's `https://` intact.
 */
function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

/**
 * True when a run between angle brackets is source rather than rendered text.
 *
 * The JSX-text scan matches anything between `>` and `<`, which also catches
 * the tail of a generic and the body of an arrow function. Prose the user
 * reads does not contain these, and code almost always does, so this is what
 * keeps the check honest enough to act on.
 */
function looksLikeCode(text: string): boolean {
  return /[;=(){}[\]]|=>|\bconst\b|\breturn\b|\bfunction\b|\buseState\b|\buseRef\b/.test(text);
}

/** Collapses `{expr}` holes so an interpolated identifier is not read as copy. */
function stripExpressions(text: string): string {
  let stripped = text;
  for (let pass = 0; pass < 5; pass++) {
    const next = stripped.replace(/\{[^{}]*\}/g, " ");
    if (next === stripped) return stripped;
    stripped = next;
  }
  return stripped;
}

function findingsIn(file: string, word: RegExp = NOTE_WORD): Finding[] {
  const source = stripComments(readFileSync(file, "utf8"));
  const name = relative(COMPONENTS_DIR, file);
  const findings: Finding[] = [];

  const attribute = new RegExp(`\\b(${USER_FACING_ATTRIBUTES})\\s*=\\s*"([^"]*)"`, "g");
  for (const match of source.matchAll(attribute)) {
    if (word.test(match[2])) findings.push({ file: name, text: `${match[1]}="${match[2]}"` });
  }

  // A JSX text node is whatever sits between a closing and an opening angle
  // bracket. A run that still holds an unbalanced brace after the expression
  // pass is the middle of an expression rather than rendered text, so it is
  // skipped instead of guessed at.
  for (const match of source.matchAll(/>([^<>]+)</g)) {
    const text = stripExpressions(match[1]);
    if (text.includes("{") || text.includes("}")) continue;
    if (looksLikeCode(text)) continue;
    if (word.test(text)) findings.push({ file: name, text: text.replace(/\s+/g, " ").trim() });
  }

  return findings;
}

function isAllowed(finding: Finding): boolean {
  return ALLOWED.some(
    (entry) => finding.file.endsWith(entry.file) && finding.text.includes(entry.text),
  );
}

describe("product vocabulary", () => {
  it("finds components to check, so a broken walk cannot pass silently", () => {
    expect(tsxFilesUnder(COMPONENTS_DIR).length).toBeGreaterThan(20);
  });

  it("never says \"note\" in anything the user reads", () => {
    const violations = tsxFilesUnder(COMPONENTS_DIR)
      .flatMap((file) => findingsIn(file))
      .filter((finding) => !isAllowed(finding))
      .map((finding) => `${finding.file}: ${finding.text}`);

    expect(violations).toEqual([]);
  });

  it("never says \"piece\" in anything the user reads", () => {
    const violations = tsxFilesUnder(COMPONENTS_DIR)
      .flatMap((file) => findingsIn(file, PIECE_WORD))
      .filter((finding) => !isAllowed(finding))
      .map((finding) => `${finding.file}: ${finding.text}`);

    expect(violations).toEqual([]);
  });
});
