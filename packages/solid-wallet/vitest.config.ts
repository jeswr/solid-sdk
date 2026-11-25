// AUTHORED-BY Codex (GPT-6.1 Sol)
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    maxWorkers: 1,
    coverage: {
      enabled: true,
      provider: "v8",
      include: ["src/*.ts"],
      exclude: ["src/generated/**"],
      thresholds: { perFile: true, statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
