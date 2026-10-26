// AUTHORED-BY Codex GPT-6.1-Sol
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    maxWorkers: 2,
    include: ["src/**/*.test.ts"],
    coverage: { thresholds: { branches: 100 } },
  },
});
