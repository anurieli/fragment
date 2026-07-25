import { promises as fs } from "node:fs";

import { parsePieceFile } from "../../../src/lib/content-engine/index.js";

import type { Transport } from "./transport.js";

// Shared by the CLI's `push` subcommand and its tests. Reads a contract-format
// handoff file from disk, validates it (parsePieceFile runs it through the
// contract's zod schema), and hands it to the transport unchanged.
export async function pushFile(
  filePath: string,
  transport: Transport,
): Promise<{ pieceId: string; ideaId: string }> {
  const raw = await fs.readFile(filePath, "utf8");
  const handoff = parsePieceFile(raw);
  return transport.addPiece(handoff);
}
