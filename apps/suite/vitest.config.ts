// AUTHORED-BY Codex GPT-6.1-Sol
import { defineConfig } from "vitest/config";

// Recurrence fixtures exercise browser-local calendar arithmetic over UK DST changes.
process.env.TZ = "Europe/London";
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      enabled: true,
      include: ["src/apps/tasks/lib/model/**/*.ts"],
      reporter: ["text", "json", "json-summary"],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
