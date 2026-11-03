// AUTHORED-BY Codex GPT-6.1-Sol
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./src/storage-setup.ts"],
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
