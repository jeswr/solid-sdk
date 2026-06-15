import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/model/**/*.ts"],
      // The data layer is the non-throwaway core: hold it to ~100%. The single
      // genuinely-unreachable defensive guard (the in-memory n3.Writer error
      // callback) is excluded via a `/* v8 ignore */` comment, so 100% is real.
      thresholds: {
        lines: 100,
        functions: 100,
        statements: 100,
        branches: 100,
      },
    },
  },
});
