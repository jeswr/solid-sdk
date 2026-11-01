// AUTHORED-BY Codex GPT-6
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    // Access regressions retain end-to-end migration assertions against this app's harness.
    include: [
      "test/**/*.test.{ts,tsx}",
      "../../packages/pod-access/test/{systems,dialect-matrix,dialect-safety,review,edges,round6,round7,round8,round9}.test.ts",
    ],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/engine/**/*.ts"],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
