// AUTHORED-BY Codex GPT-6
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  test: {
    include: ["test/css/*.test.ts", "test/css/*.integration.ts"],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 300_000,
    hookTimeout: 150_000,
    reporters: ["verbose"],
    coverage: { enabled: false },
  },
});
