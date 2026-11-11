// AUTHORED-BY Codex GPT-6.1-Sol
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    coverage: {
      enabled: true,
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/listing.ts"],
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
});
