# Changelog

This changelog starts at the initial public release. Earlier history lives in the private development repo.

## 2026-07-25 - Content Engine wave 0: the versioned agent handoff contract (ARI-149)

**Summary**: First code of the Content Engine epic (ARI-148). New module `src/lib/content-engine/` defines the `fragment: 1` contract every later wave consumes: `Idea` (nullable `parentId`, max depth 2 enforced via `assertIdeaParentAllowed`, priority 0-4, `pinnedAt`), `ContentPiece` (format/status/origin enums including `script`, the noteId-XOR-body "exactly one content home" rule, `seen`, `order`, `scheduledAt`, `publish`, `agentMeta` with append-only `supersedes`, tombstones), and `Resource` (idea- or piece-owned link/note/asset). One zod schema source feeds two wire parsers: YAML-frontmatter `.md` files (snake_case + ISO-8601, body preserved byte-exact — tweet threads use `---` separators inside the body without colliding with the frontmatter delimiters) and JSON API bodies (camelCase + epoch ms), both normalizing into `PieceHandoff`. Pure import rules (no clocks or ids inside; callers inject `now`/`generateId`): idea match-or-create by id or normalized title, LWW upsert that never overwrites newer local edits and never resurrects tombstones. `serializePieceFile` gives fragment-mcp its writer with a proven parse roundtrip. `docs/AGENT-API.md` documents the format as a stable public interface. The piece-requires-idea rule is explicit: every piece names its idea. Adds `yaml` dependency.

**Verification**: 35 new Vitest tests across 3 suites, all passing; `tsc --noEmit` clean.

Files: src/lib/content-engine/contract.ts, src/lib/content-engine/frontmatter.ts, src/lib/content-engine/upsert.ts, src/lib/content-engine/index.ts, docs/AGENT-API.md, src/__tests__/content-engine-contract.test.ts, src/__tests__/content-engine-frontmatter.test.ts, src/__tests__/content-engine-upsert.test.ts, package.json, package-lock.json.
