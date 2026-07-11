import { defineConfig } from "vitest/config";

/**
 * LIVE config for the authorization-code spec: boots ONE in-memory CSS v8 on port 3086 via
 * globalSetup, then runs only the live spec (the offline suites are covered by `npm test`). Boot is
 * slow, so serialise and grant generous timeouts.
 */
export default defineConfig({
  test: {
    globalSetup: ["./test/live-setup.ts"],
    include: ["test/live-authcode.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
