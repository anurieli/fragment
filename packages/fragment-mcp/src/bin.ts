#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer, FileTransport, pushFile } from "./index.js";
import { checkDelivery, formatFinding } from "./delivery-check.js";

const HELP =
  "fragment-mcp - MCP server + CLI for pushing content into Fragment\n\n" +
  "Usage:\n" +
  "  fragment-mcp                 start the MCP server over stdio\n" +
  "  fragment-mcp push <file.md>  validate a handoff file and drop it in the inbox\n" +
  "  fragment-mcp doctor          check that pushes will actually reach the app\n";

async function runPush(file: string | undefined): Promise<void> {
  if (!file) {
    process.stderr.write("usage: fragment-mcp push <file.md>\n");
    process.exitCode = 1;
    return;
  }
  try {
    const preflight = await checkDelivery();
    if (preflight.state === "ingress_blocked") {
      process.stderr.write(
        "fragment-mcp push refused: " + preflight.summary + "\n" +
        (preflight.fix ? "  fix: " + preflight.fix + "\n" : "") +
        "  run `fragment-mcp doctor` for the full report.\n",
      );
      process.exitCode = 1;
      return;
    }
    const transport = new FileTransport();
    const result = await pushFile(file, transport);
    process.stdout.write("queued 1 piece(s); open Fragment to import.\n");
    process.stdout.write(`  piece ${result.pieceId} -> idea ${result.ideaId} (${transport.inboxDir})\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`fragment-mcp push failed: ${message}\n`);
    process.exitCode = 1;
  }
}

async function runDoctor(): Promise<void> {
  const finding = await checkDelivery();
  process.stdout.write(formatFinding(finding) + "\n");
  if (finding.state !== "ok") process.exitCode = 1;
}

async function runServer(): Promise<void> {
  const transport = new FileTransport();
  const server = createServer(transport);
  await server.connect(new StdioServerTransport());
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  if (command === "push") {
    await runPush(rest[0]);
    return;
  }
  if (command === "doctor") {
    await runDoctor();
    return;
  }
  if (command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return;
  }
  await runServer();
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`fragment-mcp: ${message}\n`);
  process.exitCode = 1;
});
