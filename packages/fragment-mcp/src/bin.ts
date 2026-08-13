#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer, FileTransport, pushFile } from "./index.js";
import { HttpTransport, resolveHttpConfig } from "./http-transport.js";
import { drainInbox, formatDrainResult, requireHostedForDrain } from "./drain.js";
import { checkDelivery, formatFinding } from "./delivery-check.js";
import type { Transport } from "./transport.js";

const HELP =
  "fragment-mcp - MCP server + CLI for pushing content into Fragment\n\n" +
  "Usage:\n" +
  "  fragment-mcp                 start the MCP server over stdio\n" +
  "  fragment-mcp push <file.md>  validate a handoff file and push it\n" +
  "  fragment-mcp doctor          check that pushes will actually arrive\n" +
  "  fragment-mcp drain           move anything stranded in the local inbox\n" +
  "                               into the hosted account (--dry-run to preview)\n\n" +
  "Transports:\n" +
  "  local (default)  writes to FRAGMENT_INBOX_DIR (~/.fragment/inbox);\n" +
  "                   the running Fragment app imports the files.\n" +
  "  hosted           set FRAGMENT_API_URL + FRAGMENT_API_TOKEN to push\n" +
  "                   straight into a Fragment account over HTTPS. Mint a\n" +
  "                   token in Fragment: Settings -> Agent access.\n";

/**
 * Pick the transport once, at startup. Hosted wins when configured: an
 * operator who set an API URL and token wants pushes to reach the account,
 * not a local directory. resolveHttpConfig throws on a half-configured
 * pair rather than silently falling back to files.
 */
function selectTransport(): Transport {
  const hosted = resolveHttpConfig();
  if (hosted) return new HttpTransport(hosted);
  return new FileTransport();
}

async function runPush(file: string | undefined): Promise<void> {
  if (!file) {
    process.stderr.write("usage: fragment-mcp push <file.md>\n");
    process.exitCode = 1;
    return;
  }
  try {
    const transport = selectTransport();
    if (transport.assertDeliverable) {
      try {
        await transport.assertDeliverable();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          "fragment-mcp push refused: " + message + "\n" +
          "  run `fragment-mcp doctor` for the full report.\n",
        );
        process.exitCode = 1;
        return;
      }
    }
    const result = await pushFile(file, transport);
    if (transport instanceof FileTransport) {
      process.stdout.write("queued 1 piece(s); open Fragment to import.\n");
      process.stdout.write(`  piece ${result.pieceId} -> idea ${result.ideaId} (${transport.inboxDir})\n`);
      // The same caution the MCP tools return to the model: a queue nothing
      // drains is not a delivery, and saying so here is the difference
      // between a fixable setup and a folder quietly filling for weeks.
      const warning = await transport.deliveryWarning();
      if (warning) process.stdout.write(`\n${warning}\n`);
    } else {
      process.stdout.write("pushed 1 piece(s) to the Fragment account.\n");
      process.stdout.write(`  piece ${result.pieceId} -> idea ${result.ideaId}\n`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`fragment-mcp push failed: ${message}\n`);
    process.exitCode = 1;
  }
}

async function runDoctor(): Promise<void> {
  const hosted = resolveHttpConfig();
  if (hosted) {
    const transport = new HttpTransport(hosted);
    try {
      const pong = await transport.ping();
      process.stdout.write(
        `[OK] Connected to ${hosted.baseUrl} as "${pong.tokenName}" (account: ${pong.account}).\n` +
          `  scopes  ${pong.scopes.join(", ")}\n` +
          "  Pushes land in the account's cloud store and sync to every signed-in device.\n",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stdout.write(`[FAIL] ${message}\n`);
      process.exitCode = 1;
    }
    return;
  }

  const finding = await checkDelivery();
  process.stdout.write(formatFinding(finding) + "\n");
  if (finding.state !== "ok") process.exitCode = 1;
}

/**
 * Rescue pieces written in local file mode into the hosted account. The
 * counterpart to the file transport's one real failure: a draft that was
 * saved perfectly and delivered to nobody.
 */
async function runDrain(args: string[]): Promise<void> {
  const dryRun = args.includes("--dry-run");
  try {
    const hosted = resolveHttpConfig();
    if (!hosted) requireHostedForDrain();

    const result = await drainInbox(new HttpTransport(hosted), { dryRun });
    process.stdout.write(formatDrainResult(result, dryRun) + "\n");
    if (result.failures.length) process.exitCode = 1;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`fragment-mcp drain failed: ${message}\n`);
    process.exitCode = 1;
  }
}

async function runServer(): Promise<void> {
  const transport = selectTransport();
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
  if (command === "drain") {
    await runDrain(rest);
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
