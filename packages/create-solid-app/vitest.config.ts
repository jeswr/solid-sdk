import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // CSS boot (~15s) + scaffolded `tsc --noEmit` (slow) need generous timeouts.
    testTimeout: 600_000,
    hookTimeout: 240_000,
    // Serialise: the seed-pod test owns a fixed port (3088).
    fileParallelism: false,
  },
});
