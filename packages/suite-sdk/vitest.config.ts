// AUTHORED-BY Codex GPT-6.1-Sol
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    coverage: {
      enabled: true,
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      thresholds: {
        "src/use-registration.ts": { branches: 100, functions: 100, lines: 100, statements: 100 },
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
        "src/search/**": { branches: 100, functions: 100, lines: 100, statements: 100 },
        "src/preferences/**": { branches: 100, functions: 100, lines: 100, statements: 100 },
      },
    },
  },
});
