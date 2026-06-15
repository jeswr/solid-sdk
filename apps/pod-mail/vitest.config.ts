// AUTHORED-BY Claude Opus 4.8
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
    // for the node-environment data-layer suites (no `document`).
    setupFiles: ["./test/setup-dom.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      // The non-throwaway core (the data layer) AND the React view are held to
      // a 100% bar. The single genuinely-unreachable defensive guard (the
      // in-memory n3.Writer error callback) is excluded via a `/* v8 ignore */`
      // comment, so 100% is real.
      include: ["src/model/**/*.ts", "src/ui/**/*.{ts,tsx}"],
      thresholds: {
        lines: 100,
        functions: 100,
        statements: 100,
        branches: 100,
      },
    },
  },
});
