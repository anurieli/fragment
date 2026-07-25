import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerTools } from "./tools.js";
import type { Transport } from "./transport.js";

export { CONTRACT_VERSION } from "../../../src/lib/content-engine/index.js";

export { FileTransport, resolveInboxDir } from "./file-transport.js";
export { HttpTransport, type HttpTransportConfig } from "./http-transport.js";
export { TransportError, type CreateIdeaInput, type IdeaListEntry, type PieceListView, type PieceView, type Transport } from "./transport.js";
export { registerTools } from "./tools.js";
export { generateIdeaId, generatePieceId } from "./id.js";
export { pushFile } from "./cli.js";

export function createServer(transport: Transport): McpServer {
  const server = new McpServer({ name: "fragment-mcp", version: "0.1.0" });
  registerTools(server, transport);
  return server;
}
