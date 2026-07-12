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
      // The clientid.jsonld publisher and the barrels are config/aggregation;
      // the load-bearing data layer (model, vocab, gpx, serialise, type-index,
      // accessors, entries) AND the view are held to ~100%.
      exclude: ["src/index.ts", "src/ui/index.ts"],
      thresholds: {
        lines: 100,
        functions: 100,
        statements: 100,
        branches: 95,
      },
    },
  },
});
