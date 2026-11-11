// AUTHORED-BY GPT-6.1 Sol
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
    coverage: {
      enabled: true,
      provider: "v8",
      reporter: ["text", "json", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts"],
      thresholds: { perFile: true, lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
