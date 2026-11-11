// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
// AUTHORED-BY Codex GPT-6.1-Sol
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
    coverage: {
      enabled: true,
      provider: "v8",
      reporter: ["text", "text-summary", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts"],
      thresholds: {
        "src/client.ts": { branches: 100, functions: 100, lines: 100, statements: 100 },
        "src/client-discovery.ts": { branches: 100, functions: 100, lines: 100, statements: 100 },
        "src/inbox-client.ts": { branches: 100, functions: 100, lines: 100, statements: 100 },
        "src/security/clientFetch.ts": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
      },
    },
  },
});
