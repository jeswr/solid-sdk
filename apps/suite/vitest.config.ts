// AUTHORED-BY Codex GPT-6.1-Sol
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      enabled: true,
      provider: "v8",
      include: [
        "src/apps/photos/lib/library/**/*.ts",
        "src/apps/notes/lib/**/*.ts",
        "src/lib/order/**/*.ts",
        "src/apps/docs/lib/anchoring/**/*.ts",
        "src/apps/sheets/lib/refs/**/*.ts",
        "src/apps/calendar/lib/layout/**/*.ts",
        "src/apps/chat/lib/timeline/**/*.ts",
        "src/apps/health/lib/stats/**/*.ts",
        "src/apps/money/lib/budget/**/*.ts",
        "src/apps/sheets/lib/univer-spike/**/*.ts",
        "src/apps/money/lib/rules/**/*.ts",
      ],
      reporter: ["text", "json-summary"],
      thresholds: {
        perFile: true,
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
