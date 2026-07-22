/**
 * Usage data extracted from the final SSE event.
 */
export interface SSEStreamUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/**
 * Result object returned by parseSSEStreamWithUsage.
 * Callers access .usage after the stream completes.
 */
export interface SSEStreamResult {
  stream: AsyncGenerator<string>;
  getUsage: () => SSEStreamUsage | undefined;
}

/**
 * Uniform SSE stream parser.
 *
 * Reads a ReadableStream<Uint8Array> of Server-Sent Events in the format:
 *   data: {"content":"token text"}\n\n
 *   data: {"done":true}\n\n
 *   data: {"done":true,"usage":{"promptTokens":10,"completionTokens":20,"totalTokens":30}}\n\n
 *
 * Yields content strings as they arrive. Handles partial chunks correctly.
 */
export async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const { stream } = parseSSEStreamWithUsage(body);
  yield* stream;
}

/**
 * SSE stream parser that also captures usage data from the done event.
 *
 * Returns a stream (async generator of content strings) and a getUsage()
 * accessor that returns token counts once the stream completes.
 */
export function parseSSEStreamWithUsage(
  body: ReadableStream<Uint8Array>,
): SSEStreamResult {
  let capturedUsage: SSEStreamUsage | undefined;

  async function* generate(): AsyncGenerator<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines (SSE events are terminated by \n\n)
        const parts = buffer.split("\n");
        // Keep the last part as it may be incomplete
        buffer = parts.pop() ?? "";

        for (const line of parts) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(":")) continue;

          if (trimmed.startsWith("data: ")) {
            const jsonStr = trimmed.slice(6);
            if (jsonStr === "[DONE]") return;

            try {
              const parsed = JSON.parse(jsonStr) as {
                content?: string;
                done?: boolean;
                error?: string;
                usage?: SSEStreamUsage;
              };
              if (parsed.done) {
                if (parsed.usage) {
                  capturedUsage = parsed.usage;
                }
                return;
              }
              if (parsed.error) throw new Error(parsed.error);
              if (parsed.content) yield parsed.content;
            } catch (e) {
              // If it's our own error rethrow, otherwise skip malformed JSON
              if (e instanceof Error && !e.message.startsWith("Unexpected")) {
                throw e;
              }
            }
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith("data: ")) {
          const jsonStr = trimmed.slice(6);
          if (jsonStr !== "[DONE]") {
            try {
              const parsed = JSON.parse(jsonStr) as {
                content?: string;
                done?: boolean;
                usage?: SSEStreamUsage;
              };
              if (parsed.done && parsed.usage) {
                capturedUsage = parsed.usage;
              }
              if (parsed.content && !parsed.done) yield parsed.content;
            } catch {
              // Skip malformed trailing data
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  return {
    stream: generate(),
    getUsage: () => capturedUsage,
  };
}
