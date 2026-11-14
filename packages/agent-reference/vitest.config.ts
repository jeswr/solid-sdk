// AUTHORED-BY Claude Opus 5.5
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    maxWorkers: 2,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
