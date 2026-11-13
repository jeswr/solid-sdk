// AUTHORED-BY Claude Opus 5.5
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/engine/**/*.ts"],
      thresholds: { lines: 90, branches: 80, functions: 90, statements: 90 },
    },
  },
});
