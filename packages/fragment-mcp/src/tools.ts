import { checkDelivery } from "./delivery-check.js";

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import {
  CONTENT_FORMATS,
  CONTRACT_VERSION,
  ContractError,
  PIECE_STATUSES,
  RESOURCE_KINDS,
  RESOURCE_OWNER_TYPES,
  parsePieceHandoffJson,
} from "../../../src/lib/content-engine/index.js";

import { TransportError, type Transport } from "./transport.js";

// Registers the five ARI-151 tools against a Transport. Kept independent of
// *which* transport (file, http) is wired in — see file-transport.ts /
// http-transport.ts. All inputs are validated with the contract's own zod
// schemas before they reach a transport, so a transport never has to
// re-validate what a well-behaved caller sent.
//
// The resource input schema is passed to zod's `.array()` here as a plain
// object shape rather than the contract's z.array(resourceInputSchema)
// value, so tool registration never depends on this package's zod instance
// structurally matching the content-engine's zod instance (they are pinned
// to the same version, but tool schemas are re-declared locally to stay
// robust to that pin drifting).
const resourceInputToolSchema = z.object({
  kind: z.enum(["link", "note", "asset"]),
  url: z.string().min(1).optional(),
  title: z.string().min(1),
  note: z.string().optional(),
});

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown): CallToolResult {
  const message =
    err instanceof ContractError || err instanceof TransportError || err instanceof Error
      ? err.message
      : String(err);
  return { content: [{ type: "text", text: message }], isError: true };
}


/**
 * A write to the inbox only counts if the running app can still pick it up.
 * When the app's agent-inbox is closed to the operator's browser origin,
 * pushes land on disk and are never imported, so the honest move is to refuse
 * the call rather than report a success the user will never see. An app that
 * is merely closed right now is fine: files legitimately queue for it.
 */
async function assertDeliverable(): Promise<void> {
  const finding = await checkDelivery();
  if (finding.state === "ingress_blocked") {
    throw new TransportError(
      finding.summary +
        (finding.fix ? " " + finding.fix : "") +
        " (run `fragment-mcp doctor` for the full report)",
      "invalid",
    );
  }
}

export function registerTools(server: McpServer, transport: Transport): void {
  server.registerTool(
    "create_idea",
    {
      title: "Create idea",
      description:
        "Create a new idea (a container for one line of thinking) that pieces get attached to. " +
        "Optionally nest it under an existing root idea (max depth 2).",
      inputSchema: {
        title: z.string().min(1).describe("Idea title"),
        summary: z.string().optional().describe("Brief summary of the idea"),
        agent: z.string().optional().describe("Name of the agent creating this idea"),
        parentId: z
          .string()
          .optional()
          .describe("Id of an existing root idea to nest this idea under (max depth 2)"),
      },
    },
    async ({ title, summary, agent, parentId }) => {
      try {
        await assertDeliverable();
        const idea = await transport.createIdea({ title, summary, agent, parentId });
        return ok({ ideaId: idea.id, title: idea.title, parentId: idea.parentId });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "add_piece",
    {
      title: "Add piece",
      description:
        "Push a content piece (LinkedIn post, tweet thread, essay, etc.) into an idea's inbox. " +
        "Append-only: this always creates a new piece, never edits an existing one — a re-draft " +
        "should set `supersedes` to the id of the piece it replaces. Lands with status: inbox.",
      inputSchema: {
        ideaId: z.string().optional().describe("Id of an existing idea. One of ideaId/ideaTitle is required."),
        ideaTitle: z
          .string()
          .optional()
          .describe("Title of an idea to match (or create if none matches). One of ideaId/ideaTitle is required."),
        format: z.enum(CONTENT_FORMATS).describe("Content format"),
        title: z.string().optional().describe("Piece label shown in the workspace"),
        content: z.string().describe("Markdown body of the piece, preserved byte-exact"),
        priority: z.number().int().min(0).max(4).optional().describe("0 none / 1 urgent / 2 high / 3 medium / 4 low"),
        supersedes: z.string().optional().describe("Id of a piece this one replaces"),
        resources: z.array(resourceInputToolSchema).optional().describe("Links, notes, or assets attached to the piece"),
        scheduledAt: z
          .union([z.number(), z.string()])
          .optional()
          .describe("Target publish time: epoch ms or ISO-8601"),
        agent: z.string().optional().describe("Name of the agent that drafted this piece"),
        model: z.string().optional().describe("Model used to draft this piece"),
      },
    },
    async (args) => {
      try {
        await assertDeliverable();
        const handoff = parsePieceHandoffJson({
          fragment: CONTRACT_VERSION,
          ideaId: args.ideaId,
          ideaTitle: args.ideaTitle,
          format: args.format,
          status: "inbox",
          origin: "agent",
          title: args.title,
          body: args.content,
          priority: args.priority ?? 0,
          scheduledAt: args.scheduledAt,
          agent: args.agent,
          model: args.model,
          supersedes: args.supersedes,
          resources: args.resources ?? [],
        });
        const result = await transport.addPiece(handoff);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "list_ideas",
    {
      title: "List ideas",
      description: "Browse ideas with per-status piece counts. Reads are eventually consistent.",
      inputSchema: {
        status: z.enum(PIECE_STATUSES).optional().describe("Only return ideas with at least one piece in this status"),
      },
    },
    async ({ status }) => {
      try {
        const ideas = await transport.listIdeas(status);
        return ok({ ideas });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_piece",
    {
      title: "Get piece",
      description: "Read a piece back by id, including its current status. Reads are eventually consistent.",
      inputSchema: {
        pieceId: z.string().min(1).describe("Piece id"),
      },
    },
    async ({ pieceId }) => {
      try {
        const piece = await transport.getPiece(pieceId);
        return ok(piece);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "update_status",
    {
      title: "Update status",
      description:
        'Move a piece to "published" after posting it on the user\'s behalf. This is the only status ' +
        "transition an agent may make — every other status change is a user verdict inside Fragment.",
      inputSchema: {
        pieceId: z.string().min(1).describe("Piece id"),
        status: z.enum(PIECE_STATUSES).describe('Must be "published"'),
      },
    },
    async ({ pieceId, status }) => {
      try {
        await transport.updateStatus(pieceId, status);
        return ok({ pieceId, status });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "add_resource",
    {
      title: "Add resource",
      description:
        "Attach a reference resource (link, note, or asset) to an idea or a piece. Resources are never " +
        "copied on inheritance: an idea's resources are visible to its child ideas and their pieces, and " +
        "a piece's own resources are its alone — Fragment composes the effective set at read time.",
      inputSchema: {
        ownerType: z.enum(RESOURCE_OWNER_TYPES).describe("Whether this resource belongs to an idea or a piece"),
        ownerId: z.string().min(1).describe("Id of the idea or piece this resource is attached to"),
        kind: z.enum(RESOURCE_KINDS).describe("link, note, or asset"),
        title: z.string().min(1).describe("Resource title"),
        url: z.string().min(1).optional().describe("URL, typically set for kind: link"),
        note: z.string().optional().describe("Optional note"),
      },
    },
    async ({ ownerType, ownerId, kind, title, url, note }) => {
      try {
        const result = await transport.addResource({ ownerType, ownerId, kind, title, url, note });
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );
}
