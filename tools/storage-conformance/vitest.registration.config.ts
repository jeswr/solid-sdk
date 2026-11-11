// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { defineConfig } from "vitest/config";

// ADR-009: socket-based integration is its own required lane, separate from offline package tests.
export default defineConfig({
  test: {
    environment: "node",
    // CSS 7 calls jest.requireActual whenever NODE_ENV is "test" (sst-75rp); Vitest sets that default.
    env: { NODE_ENV: "development" },
    include: ["integration/registration.test.ts"],
    fileParallelism: false,
    coverage: { enabled: false },
  },
});
