import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pure unit tests — no CSS, no network, no ports. Fast and parallel-safe.
    // The live CSS spec is excluded here and run via `npm run test:live` (vitest.live.config.ts),
    // which boots an in-memory CSS on port 3086 through a globalSetup.
    include: ["test/**/*.test.ts"],
    exclude: ["test/live-authcode.test.ts", "**/node_modules/**"],
    testTimeout: 20_000,
  },
});
