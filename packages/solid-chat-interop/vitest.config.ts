// AUTHORED-BY Codex (GPT-6.1 Sol)
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,mjs}", "test/**/*.test.ts"],
    environment: "node",
    // Bound worker startup while Turbo also builds/tests dependent applications.
    maxWorkers: 2,
    testTimeout: 30_000,
  },
});
