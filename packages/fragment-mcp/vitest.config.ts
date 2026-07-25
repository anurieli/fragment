import { defineConfig } from "vitest/config";

// The root vitest.config.ts only includes src/**/*.test.ts (relative to the
// repo root), so it never picks up this package's tests. This is a small,
// standalone config scoped to packages/fragment-mcp — run with
// `npx vitest run` from inside this directory (see package.json "test").
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: true,
  },
});
