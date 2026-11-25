// AUTHORED-BY Claude Sonnet 5.5
import { defineConfig } from "vitest/config";

// Opt-in real-server lane for @jeswr/pod-media-store (same shape as vitest.registration.config.ts):
// `pnpm --filter @jeswr/storage-conformance run test:media-store`. It is not part of `test`.
export default defineConfig({
  test: {
    environment: "node",
    // CSS 7 calls jest.requireActual whenever NODE_ENV is "test" (sst-75rp); Vitest sets that default.
    env: { NODE_ENV: "development" },
    include: ["integration/pod-media-store.test.ts"],
    fileParallelism: false,
    coverage: { enabled: false },
  },
});
