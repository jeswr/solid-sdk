import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      // The clientid.jsonld publisher and the barrel are config/aggregation; the
      // load-bearing data layer (model, vocab, gpx, serialise, type-index,
      // accessors) is held to ~100%.
      exclude: ["src/index.ts"],
      thresholds: {
        lines: 100,
        functions: 100,
        statements: 100,
        branches: 95,
      },
    },
  },
});
