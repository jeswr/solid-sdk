// AUTHORED-BY Codex GPT-6.1-Sol
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    maxWorkers: 2,
    // The integrated agent-reference engine verifies and materialises RDF on every hop;
    // CI runners under the parallel Turbo gate run these flows about twice as slowly as a
    // workstation. A hang still fails, at this budget instead of the 5 s default.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/test-support/**"],
      reporter: ["text-summary", "json-summary"],
    },
  },
});
