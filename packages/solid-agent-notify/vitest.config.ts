// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts"],
    },
  },
});
