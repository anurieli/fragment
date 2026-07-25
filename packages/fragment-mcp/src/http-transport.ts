import type { Idea, PieceHandoff, PieceStatus } from "../../../src/lib/content-engine/index.js";

import type { CreateIdeaInput, IdeaListEntry, PieceView, Transport } from "./transport.js";
import { TransportError } from "./transport.js";

export interface HttpTransportConfig {
  baseUrl: string;
  apiKey: string;
}

// The hosted M2 seam. Same Transport interface, same contract shapes — a
// fragment-mcp pointed at a hosted Fragment account would call this instead
// of writing local files. Deliberately unimplemented until M2 ships a real
// agent-inbox HTTP endpoint; every method throws a clearly-labeled error so
// misconfiguration fails loud rather than silently doing nothing.
export class HttpTransport implements Transport {
  constructor(private readonly config: HttpTransportConfig) {}

  createIdea(_input: CreateIdeaInput): Promise<Idea> {
    return this.unimplemented("createIdea");
  }

  addPiece(_handoff: PieceHandoff): Promise<{ pieceId: string; ideaId: string }> {
    return this.unimplemented("addPiece");
  }

  listIdeas(_status?: PieceStatus): Promise<IdeaListEntry[]> {
    return this.unimplemented("listIdeas");
  }

  getPiece(_pieceId: string): Promise<PieceView> {
    return this.unimplemented("getPiece");
  }

  updateStatus(_pieceId: string, _status: PieceStatus): Promise<never> {
    return this.unimplemented("updateStatus");
  }

  private unimplemented(method: string): Promise<never> {
    return Promise.reject(
      new TransportError(
        `HttpTransport.${method} is not implemented yet (baseUrl: ${this.config.baseUrl}). ` +
          "The hosted Fragment API (M2) is the seam this class fills in; until it ships, use " +
          "FRAGMENT_INBOX_DIR / the file transport.",
        "unimplemented",
      ),
    );
  }
}
