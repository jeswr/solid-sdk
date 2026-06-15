import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      // The data layer is held to 100% lines + functions. The single uncovered
      // statement/branch is the defensive `writer.end(error => reject(error))`
      // arm in serialise.ts: n3.Writer does not surface an error for the valid
      // quads the typed accessors can ever produce, so it cannot be triggered
      // deterministically through the public n3 API. The arm is correct
      // defensive code (a future n3 could error) and is kept rather than
      // removed; statements/branches are pinned just below 100% to allow ONLY
      // that one arm — any new uncovered code fails the gate.
      thresholds: {
        lines: 100,
        functions: 100,
        statements: 99.5,
        branches: 98,
      },
    },
  },
});
