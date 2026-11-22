// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    maxWorkers: 2,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
