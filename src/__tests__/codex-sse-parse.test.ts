import { describe, it, expect } from "vitest";
import {
  extractCodexCompletedPayloadFromSse,
  parseCodexResponseBody,
  extractCodexResponseText,
} from "@/lib/codex-api";

/**
 * Regression: the Codex Responses API is called with `store: false`, so the
 * final `response.completed` event carries an EMPTY `output` array — the text
 * lives only in the per-item SSE events (`response.output_item.done` /
 * `response.output_text.done`). Non-streaming callers (analyze-voice, label)
 * parse the completed payload, so the parser must graft the item text back on.
 * Without that, extractCodexResponseText returned "" and voice analysis failed
 * with "Couldn't read the analysis result."
 */

const RESULT_JSON = '{"summary":"Blunt and punchy.","traits":["direct"],"exampleExcerpts":["Ship the thing."],"doGuidance":["Be concrete"],"dontGuidance":["Avoid fluff"]}';

// Minimal reproduction of the real store:false stream shape.
const STORE_FALSE_SSE = [
  `event: response.created\ndata: ${JSON.stringify({ type: "response.created", response: { output: [] } })}`,
  `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: RESULT_JSON })}`,
  `event: response.output_text.done\ndata: ${JSON.stringify({ type: "response.output_text.done", text: RESULT_JSON })}`,
  `event: response.output_item.done\ndata: ${JSON.stringify({
    type: "response.output_item.done",
    item: { id: "msg_1", type: "message", role: "assistant", content: [{ type: "output_text", text: RESULT_JSON }] },
  })}`,
  `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { id: "resp_1", model: "gpt-5.4", output: [], usage: { input_tokens: 222, output_tokens: 213, total_tokens: 435 } } })}`,
].join("\n\n");

describe("Codex store:false SSE parsing", () => {
  it("extracts the message text even though response.completed.output is empty", () => {
    const payload = extractCodexCompletedPayloadFromSse(STORE_FALSE_SSE);
    expect(extractCodexResponseText(payload)).toBe(RESULT_JSON);
  });

  it("parseCodexResponseBody yields usable text for the event-stream content type", () => {
    const payload = parseCodexResponseBody(STORE_FALSE_SSE, "text/event-stream");
    expect(extractCodexResponseText(payload)).toContain('"summary"');
  });

  it("falls back to accumulated deltas when only delta events carry text", () => {
    const deltaOnly = [
      `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: RESULT_JSON })}`,
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { output: [] } })}`,
    ].join("\n\n");
    const payload = extractCodexCompletedPayloadFromSse(deltaOnly);
    expect(extractCodexResponseText(payload)).toBe(RESULT_JSON);
  });

  it("still works when a proxy strips the SSE event: lines (uses payload.type)", () => {
    const noEventLines = STORE_FALSE_SSE.split("\n")
      .filter((l) => !l.startsWith("event:"))
      .join("\n");
    const payload = extractCodexCompletedPayloadFromSse(noEventLines);
    expect(extractCodexResponseText(payload)).toBe(RESULT_JSON);
  });
});
