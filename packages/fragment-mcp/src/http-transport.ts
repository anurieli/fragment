import type { Idea, PieceHandoff, PieceStatus } from "../../../src/lib/content-engine/index.js";

import type { AddResourceInput, CreateIdeaInput, IdeaListEntry, PieceView, Transport } from "./transport.js";
import { TransportError } from "./transport.js";

export interface HttpTransportConfig {
  baseUrl: string;
  apiKey: string;
}

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * The hosted transport (ARI-161): the same Transport interface as the file
 * transport, spoken to a Fragment server's /api/v1/agent routes with a
 * per-account bearer token (minted in Settings → Agent access).
 *
 * Where the file transport's writes are eventually consistent (files wait on
 * disk until the app polls), this one's are durable on return: a 2xx means
 * the piece is in the account's cloud store and will reach every signed-in
 * device on its next sync tick, whether or not any Fragment tab is open.
 * There is deliberately no local deliverability preflight — the HTTP
 * response IS the delivery verdict, and a refused token fails loudly right
 * here rather than filling a directory nothing reads.
 */
export class HttpTransport implements Transport {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: HttpTransportConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
  }

  async createIdea(input: CreateIdeaInput): Promise<Idea> {
    const body = await this.request<{ idea: Idea }>("POST", "/api/v1/agent/ideas", {
      title: input.title,
      summary: input.summary,
      parentId: input.parentId,
    });
    return body.idea;
  }

  async addPiece(handoff: PieceHandoff): Promise<{ pieceId: string; ideaId: string }> {
    return this.request<{ pieceId: string; ideaId: string }>("POST", "/api/v1/agent/pieces", handoff);
  }

  async listIdeas(status?: PieceStatus): Promise<IdeaListEntry[]> {
    const path = status
      ? `/api/v1/agent/ideas?status=${encodeURIComponent(status)}`
      : "/api/v1/agent/ideas";
    const body = await this.request<{ ideas: IdeaListEntry[] }>("GET", path);
    return body.ideas;
  }

  async getPiece(pieceId: string): Promise<PieceView> {
    return this.request<PieceView>("GET", `/api/v1/agent/pieces/${encodeURIComponent(pieceId)}`);
  }

  async updateStatus(pieceId: string, status: PieceStatus): Promise<void> {
    await this.request("POST", `/api/v1/agent/pieces/${encodeURIComponent(pieceId)}/status`, {
      status,
    });
  }

  async addResource(input: AddResourceInput): Promise<{ resourceId: string; ideaId: string }> {
    return this.request<{ resourceId: string; ideaId: string }>(
      "POST",
      "/api/v1/agent/resources",
      input,
    );
  }

  /** The hosted connection test — what `fragment-mcp doctor` reports on. */
  async ping(): Promise<{ ok: boolean; tokenName: string; scopes: string[]; account: string }> {
    return this.request("GET", "/api/v1/agent/ping");
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new TransportError(
        `could not reach Fragment at ${this.baseUrl} (${detail})`,
        "invalid",
      );
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) {
      return (await res.json()) as T;
    }

    const message = await this.readErrorMessage(res);
    if (res.status === 401) {
      throw new TransportError(
        `Fragment rejected the agent token (${message}). Mint a token in Settings → Agent access ` +
          "and set it as FRAGMENT_API_TOKEN.",
        "invalid",
      );
    }
    if (res.status === 403) {
      throw new TransportError(message, "invalid");
    }
    if (res.status === 404) {
      throw new TransportError(message, "not_found");
    }
    if (res.status === 429) {
      throw new TransportError(`rate limited by Fragment: ${message}`, "invalid");
    }
    throw new TransportError(`Fragment answered ${res.status}: ${message}`, "invalid");
  }

  private async readErrorMessage(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body?.error === "string" && body.error) return body.error;
    } catch {
      /* non-JSON error body; fall through */
    }
    return res.statusText || `HTTP ${res.status}`;
  }
}

/**
 * Resolve hosted-mode config from the environment. Both variables or
 * neither: exactly one set is a misconfiguration worth failing loudly on,
 * not a silent fallback to writing local files nobody will import.
 */
export function resolveHttpConfig(): HttpTransportConfig | null {
  const baseUrl = process.env.FRAGMENT_API_URL;
  const apiKey = process.env.FRAGMENT_API_TOKEN;
  if (!baseUrl && !apiKey) return null;
  if (!baseUrl || !apiKey) {
    throw new TransportError(
      "hosted mode needs both FRAGMENT_API_URL and FRAGMENT_API_TOKEN " +
        `(got only ${baseUrl ? "FRAGMENT_API_URL" : "FRAGMENT_API_TOKEN"}). ` +
        "Unset both to use the local file inbox instead.",
      "invalid",
    );
  }
  return { baseUrl, apiKey };
}
