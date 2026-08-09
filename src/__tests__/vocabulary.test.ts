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
 * "fragment" used as a word for content.
 *
 * The word briefly replaced "piece" in the interface and has been reverted:
 * an idea has pieces, some long, some short, all parts of the larger idea,
 * which is the sentence that actually describes the product.
 *
 * Deliberately case-sensitive, because the app is called Fragment and the
 * two uses are told apart by exactly that. Capitalised and singular is the
 * product ("Fragment could not finish this update"). Lowercase anywhere, or
 * plural in any case, is the entity, and the entity is a piece.
 */
const FRAGMENT_WORD = /\bfragments?\b|\bFragments\b/;

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
    file: "editor/export-menu.tsx",
    text: ".fragment-review.json",
    why: "the review file's extension, named after the app, not after a piece",
  },
  {
    file: "landing/landing-page.tsx",
    text: "anurieli/fragment",
    why: "the GitHub repo path",
  },
  {
    file: "help/help-overlay.tsx",
    text: "fragment-mcp",
    why: "the npm package an agent connects through, named after the app",
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

/**
 * True when a quoted string is prose rather than a class list, a path, or an
 * identifier. Copy inside a JSX expression, most often a ternary picking an
 * empty state, is invisible to the text and attribute scans, and that is
 * exactly where a stale sentence hides longest.
 */
function looksLikeProse(text: string): boolean {
  if (text.length < 25) return false;
  if ((text.match(/ /g) ?? []).length < 3) return false;
  if (text.includes("/")) return false;
  // Tailwind class lists are long and spaced, but they never contain a
  // sentence's worth of ordinary punctuation.
  if (/\b(?:flex|grid|rounded|px-|py-|mt-|mb-|gap-|bg-|border-|font-\[)/.test(text)) return false;
  return /[a-z] [a-z]/.test(text);
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
  // pass has an expression starting inside it, so only the words before that
  // brace are rendered text. Skipping the whole run instead is what let a
  // literal "Fragments" label sit in the space toggle for two releases: the
  // word was followed by `{hasUnseen && (`, and the check gave up at the
  // brace rather than reading the line in front of it.
  for (const match of source.matchAll(/>([^<>]+)</g)) {
    const expanded = stripExpressions(match[1]);
    const text = expanded.split(/[{}]/)[0];
    if (looksLikeCode(text)) continue;
    if (word.test(text)) findings.push({ file: name, text: text.replace(/\s+/g, " ").trim() });
  }

  // Copy that reaches the screen through an expression rather than as a text
  // node: `{condition ? "one sentence" : "another"}`. The class was once
  // written `[^"\\n]`, which in a regex literal excludes the letter n as well
  // as the newline — so every sentence containing an "n" went unread, which
  // is most of them.
  for (const match of source.matchAll(/"([^"\n]{25,})"/g)) {
    const text = match[1];
    if (!looksLikeProse(text)) continue;
    if (word.test(text)) findings.push({ file: name, text });
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

  it("never calls a piece a \"fragment\" in anything the user reads", () => {
    const violations = tsxFilesUnder(COMPONENTS_DIR)
      .flatMap((file) => findingsIn(file, FRAGMENT_WORD))
      .filter((finding) => !isAllowed(finding))
      .map((finding) => `${finding.file}: ${finding.text}`);

    expect(violations).toEqual([]);
  });
});
