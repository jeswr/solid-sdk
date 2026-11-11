// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    maxWorkers: 1,
    coverage: {
      enabled: true,
      provider: "v8",
      include: ["src/access.ts", "src/repository.ts"],
      reporter: ["text"],
      thresholds: { perFile: true, statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
