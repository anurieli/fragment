import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import {
  CONTRACT_VERSION,
  ContractError,
  contractErrorFromZod,
  pieceHandoffFrontmatterSchema,
  type PieceHandoff,
} from "./contract";

// Agent handoff files are markdown with a YAML frontmatter header:
//
//   ---
//   fragment: 1
//   idea_title: "Why writing tools fragment ideas"
//   format: linkedin
//   ---
//   Body markdown, preserved byte-exact.
//
// The body is everything after the closing delimiter's newline. It is never
// trimmed, normalized, or re-wrapped: what the agent wrote is what the user
// publishes, spaces and newlines included.

const OPEN_DELIMITER = /^---\r?\n/;
const CLOSE_DELIMITER = /\r?\n---[ \t]*(\r?\n|$)/;

export function splitFrontmatter(raw: string): { header: string; body: string } {
  const open = raw.match(OPEN_DELIMITER);
  if (!open) {
    throw new ContractError('handoff file must start with a "---" frontmatter block');
  }
  const afterOpen = raw.slice(open[0].length);
  const close = afterOpen.match(CLOSE_DELIMITER);
  if (!close || close.index === undefined) {
    throw new ContractError('handoff frontmatter block is never closed with "---"');
  }
  return {
    header: afterOpen.slice(0, close.index),
    body: afterOpen.slice(close.index + close[0].length),
  };
}

export function parsePieceFile(raw: string): PieceHandoff {
  const { header, body } = splitFrontmatter(raw);

  let frontmatter: unknown;
  try {
    frontmatter = parseYaml(header);
  } catch (error) {
    throw new ContractError(
      `handoff frontmatter is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (frontmatter === null || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
    throw new ContractError("handoff frontmatter must be a YAML mapping of fields");
  }

  const result = pieceHandoffFrontmatterSchema.safeParse(frontmatter);
  if (!result.success) {
    throw contractErrorFromZod("invalid piece handoff (frontmatter)", result.error);
  }
  return { ...result.data, body };
}

// Serializer for fragment-mcp and anything else that writes handoff files.
// Emits snake_case keys and ISO-8601 dates; round-trips through parsePieceFile.
export function serializePieceFile(handoff: PieceHandoff): string {
  const header: Record<string, unknown> = { fragment: CONTRACT_VERSION };

  const set = (key: string, value: unknown) => {
    if (value !== undefined) header[key] = value;
  };
  const iso = (epochMs: number | undefined) =>
    epochMs === undefined ? undefined : new Date(epochMs).toISOString();

  set("id", handoff.id);
  set("idea_id", handoff.ideaId);
  set("idea_title", handoff.ideaTitle);
  set("idea_summary", handoff.ideaSummary);
  set("format", handoff.format);
  set("status", handoff.status);
  set("origin", handoff.origin);
  set("title", handoff.title);
  if (handoff.priority !== 0) set("priority", handoff.priority);
  set("created_at", iso(handoff.createdAt));
  set("updated_at", iso(handoff.updatedAt));
  set("scheduled_at", iso(handoff.scheduledAt));
  set("agent", handoff.agent);
  set("model", handoff.model);
  set("supersedes", handoff.supersedes);
  if (handoff.resources.length > 0) set("resources", handoff.resources);

  return `---\n${stringifyYaml(header)}---\n${handoff.body}`;
}
