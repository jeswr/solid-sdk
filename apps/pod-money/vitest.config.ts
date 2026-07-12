// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // @vitejs/plugin-react transpiles the .tsx view + its tests (JSX, the
  // react-jsx runtime). The data-layer tests are plain .ts and unaffected.
  plugins: [react()],
  test: {
    // Both the data-layer (.test.ts) and the React view (.test.tsx) suites.
    include: ["test/**/*.test.{ts,tsx}"],
    // Default to node (the data-layer tests need nothing else); the component
    // tests opt into jsdom per-file via a `// @vitest-environment jsdom`
    // docblock, so we never pay the jsdom cost for the pure-RDF suite.
    environment: "node",
    // Loaded once before the suite: @testing-library/jest-dom matchers
    // (toBeInTheDocument, …) + automatic React cleanup between tests. A no-op
    // for the node-environment data-layer tests (no `document`).
    setupFiles: ["./test/setup-dom.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
      include: ["src/**/*.{ts,tsx}"],
      // The data layer AND the view are held to 100% lines + functions. The
      // single uncovered statement/branch is the defensive
      // `writer.end(error => reject(error))` arm in serialise.ts: n3.Writer does
      // not surface an error for the valid quads the typed accessors can ever
      // produce, so it cannot be triggered deterministically through the public
      // n3 API. The arm is correct defensive code (a future n3 could error) and
      // is kept rather than removed; statements/branches are pinned just below
      // 100% to allow ONLY that one arm — any new uncovered code fails the gate.
      thresholds: {
        lines: 100,
        functions: 100,
        statements: 99.5,
        branches: 98,
      },
    },
  },
});
