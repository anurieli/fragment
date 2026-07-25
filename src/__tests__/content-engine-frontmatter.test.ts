import { describe, it, expect } from "vitest";

import {
  ContractError,
  parsePieceFile,
  serializePieceFile,
  splitFrontmatter,
} from "@/lib/content-engine";
import type { PieceHandoff } from "@/lib/content-engine";

const fullFile = `---
fragment: 1
id: pc_a1b2c3
idea_title: "Voice is the moat"
format: linkedin
status: inbox
title: "Post 1 of 4"
priority: 2
created_at: 2026-07-24T09:30:00Z
agent: claude-code
model: claude-fable-5
resources:
  - kind: link
    url: https://example.com/talk
    title: Conference talk
---
First line.

Second paragraph with  two  spaces kept.
`;

describe("content-engine — frontmatter parsing", () => {
  it("parses snake_case fields into the canonical handoff", () => {
    const handoff = parsePieceFile(fullFile);
    expect(handoff.id).toBe("pc_a1b2c3");
    expect(handoff.ideaTitle).toBe("Voice is the moat");
    expect(handoff.format).toBe("linkedin");
    expect(handoff.priority).toBe(2);
    expect(handoff.createdAt).toBe(Date.parse("2026-07-24T09:30:00Z"));
    expect(handoff.agent).toBe("claude-code");
    expect(handoff.resources).toEqual([
      { kind: "link", url: "https://example.com/talk", title: "Conference talk" },
    ]);
  });

  it("keeps the body byte-exact, including blank lines and double spaces", () => {
    const handoff = parsePieceFile(fullFile);
    expect(handoff.body).toBe(
      "First line.\n\nSecond paragraph with  two  spaces kept.\n",
    );
  });

  it("treats --- inside the body as content, not a delimiter (tweet threads)", () => {
    const thread = `---
fragment: 1
idea_title: Threads
format: tweet
---
Tweet one.
---
Tweet two.
---
Tweet three.`;
    const handoff = parsePieceFile(thread);
    expect(handoff.body).toBe("Tweet one.\n---\nTweet two.\n---\nTweet three.");
  });

  it("allows an empty body", () => {
    const handoff = parsePieceFile("---\nfragment: 1\nidea_title: T\nformat: tweet\n---");
    expect(handoff.body).toBe("");
  });

  it("rejects files without frontmatter, unclosed blocks, and invalid YAML", () => {
    expect(() => parsePieceFile("just markdown")).toThrow(/must start/);
    expect(() => parsePieceFile("---\nfragment: 1\nno closing")).toThrow(/never closed/);
    expect(() => parsePieceFile('---\nfragment: [1\n---\nbody')).toThrow(/not valid YAML/);
  });

  it("rejects missing idea reference and wrong version with clear errors", () => {
    expect(() => parsePieceFile("---\nfragment: 1\nformat: tweet\n---\nx")).toThrow(
      /idea_id.*idea_title|ideaId.*ideaTitle/,
    );
    expect(() => parsePieceFile("---\nfragment: 9\nidea_title: T\nformat: tweet\n---\nx")).toThrow(
      /unsupported contract version/,
    );
  });

  it("splitFrontmatter separates header and body without touching either", () => {
    const { header, body } = splitFrontmatter("---\na: 1\n---\n  spaced body ");
    expect(header).toBe("a: 1");
    expect(body).toBe("  spaced body ");
  });

  it("throws ContractError instances for all failure modes", () => {
    expect(() => parsePieceFile("nope")).toThrow(ContractError);
  });
});

describe("content-engine — serialization roundtrip", () => {
  it("serialize → parse preserves every field and the exact body", () => {
    const handoff: PieceHandoff = {
      fragment: 1,
      id: "pc_xyz",
      ideaTitle: "Roundtrip",
      format: "substack",
      status: "ready",
      origin: "agent",
      title: "Essay draft",
      body: "Para one.\n\n> quote\n\nPara   spaced.\n",
      priority: 1,
      createdAt: Date.parse("2026-07-25T08:00:00.000Z"),
      scheduledAt: Date.parse("2026-08-01T15:00:00.000Z"),
      agent: "hermes/penny",
      model: "gpt-5.6-sol",
      supersedes: "pc_old",
      resources: [{ kind: "note", title: "Angle", note: "contrarian take" }],
    };
    const roundtripped = parsePieceFile(serializePieceFile(handoff));
    expect(roundtripped).toEqual(handoff);
  });

  it("omits defaults and undefined fields from the header", () => {
    const serialized = serializePieceFile({
      fragment: 1,
      ideaTitle: "Minimal",
      format: "tweet",
      status: "inbox",
      origin: "agent",
      body: "hi",
      priority: 0,
      resources: [],
    });
    expect(serialized).not.toContain("priority");
    expect(serialized).not.toContain("resources");
    expect(serialized).not.toContain("supersedes");
    expect(serialized.endsWith("---\nhi")).toBe(true);
  });
});
