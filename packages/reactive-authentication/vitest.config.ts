// AUTHORED-BY Codex GPT-6.1-Sol
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Shared browser/interop fixtures import the built entry points in plain Node.
    // Keep one module identity with the source imports in Vitest.
    alias: [
      {
        find: /^(?:\.\.\/)+dist\/(.*)\.js$/,
        replacement: `${fileURLToPath(new URL("./src/", import.meta.url))}$1.ts`,
      },
    ],
  },
  test: {
    environment: "node",
    include: ["test/*.test.js"],
    fileParallelism: false,
    restoreMocks: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      enabled: true,
      provider: "v8",
      reporter: ["text", "json", "json-summary"],
      include: ["src/**/*.ts"],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});
