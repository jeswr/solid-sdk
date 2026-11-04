// AUTHORED-BY Claude Opus 5.5
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 30_000,
    include: ["test/**/*.test.ts"],
    coverage: {
      enabled: true,
      provider: "v8",
      include: ["src/**/*.ts"],
      // The stdio entry point only wires createWorldSandbox to createMcpProxy (both tested).
      exclude: ["src/mcp/cli.ts"],
      reporter: ["text", "json-summary"],
      thresholds: { perFile: true, branches: 80, functions: 85, lines: 90, statements: 90 },
    },
  },
});
