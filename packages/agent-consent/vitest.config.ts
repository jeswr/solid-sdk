// AUTHORED-BY Claude Opus 5.5
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "json-summary"],
      thresholds: { perFile: true, branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
});
