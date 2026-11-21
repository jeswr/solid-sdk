// AUTHORED-BY Codex GPT-6.1-Sol
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    hookTimeout: 120_000,
    testTimeout: 30_000,
    // Browser suites own real Chromium processes; avoid contention with their short guard tests.
    fileParallelism: false,
  },
});
