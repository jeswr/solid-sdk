// AUTHORED-BY Codex GPT-6.1-Sol
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      enabled: true,
      provider: "v8",
      include: ["src/apps/music/lib/metadata/**/*.ts"],
      reporter: ["text", "json-summary"],
      thresholds: { perFile: true, lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
});
