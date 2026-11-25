// AUTHORED-BY Codex GPT-6.1-Sol
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    coverage: {
      enabled: true,
      provider: "v8",
      include: ["src/{device,message,translator,locale,react}.{ts,tsx}"],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
