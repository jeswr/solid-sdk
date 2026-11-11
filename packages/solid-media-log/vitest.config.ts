// AUTHORED-BY Codex (GPT-6.1 Sol)
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { maxWorkers: 2, include: ["test/**/*.test.ts"], environment: "node" },
});
