// AUTHORED-BY Claude Fable 5
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // The packed-bin + scaffold-verify suites shell out (npm pack / pnpm install).
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
