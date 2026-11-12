// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    // Each worker loads the installed CSS oracle; bound memory on shared hosts.
    maxWorkers: 2,
    include: ["test/**/*.test.{ts,tsx}"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/connections.ts", "src/journal.ts"],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
