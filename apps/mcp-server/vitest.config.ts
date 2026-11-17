// AUTHORED-BY Codex GPT-6.1-Sol
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Both integration files own the same fixed loopback CSS/MCP ports.
    fileParallelism: false,
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
