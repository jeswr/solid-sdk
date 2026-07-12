import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The data layer is pure TypeScript run under Node; the OPTIONAL React view
// (`src/ui/`) is a thin render layer over it. Tests live next to source
// (`src/**/*.test.{ts,tsx}`). The coverage gate ratchets the data layer AND the
// view to 100% statements / lines / functions, with a high branch floor.
//
// `src/index.ts` / `src/ui/index.ts` (re-export barrels) and
// `src/test-helpers.ts` (test infra) are excluded from the threshold rather
// than padded with trivial tests.
//
// Branch floor < 100: the v8 provider's AST branch model counts a phantom "else"
// for every bare `if`-without-`else` (e.g. the guard `if (!res.ok) throw …`), so
// 100% branches is unachievable under it even when every real branch is taken —
// the istanbul-remapped (json/lcov) report shows 100% branches. We hold a strict
// 95% floor; raising it to 100 would force `else {}` noise that buys nothing.
export default defineConfig({
  // @vitejs/plugin-react transpiles the .tsx view + its tests (JSX, the
  // react-jsx runtime). The data-layer tests are plain .ts and unaffected.
  plugins: [react()],
  test: {
    // Default to node (the data-layer tests need nothing else); the component
    // tests opt into jsdom per-file via a `// @vitest-environment jsdom`
    // docblock, so we never pay the jsdom cost for the pure-RDF suite.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "dist/**"],
    // Loaded once before the suite: @testing-library/jest-dom matchers
    // (toBeInTheDocument, …) + automatic React cleanup between tests. A no-op
    // for the node-environment data-layer suites (no `document`).
    setupFiles: ["./src/ui/setup-dom.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/index.ts",
        "src/ui/index.ts",
        "src/ui/setup-dom.ts",
        "src/test-helpers.ts",
      ],
      thresholds: {
        lines: 100,
        statements: 100,
        functions: 100,
        branches: 95,
      },
    },
  },
});
