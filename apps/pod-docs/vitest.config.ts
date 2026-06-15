import { defineConfig } from "vitest/config";

// The data layer is pure TypeScript run under Node; tests live next to source
// (`src/**/*.test.ts`). The coverage gate ratchets the data layer to 100%
// statements / lines / functions, with a high branch floor.
//
// `src/index.ts` (a re-export barrel) and `src/test-helpers.ts` (test infra) are
// excluded from the threshold rather than padded with trivial tests.
//
// Branch floor < 100: the v8 provider's AST branch model counts a phantom "else"
// for every bare `if`-without-`else` (e.g. the guard `if (!res.ok) throw …`), so
// 100% branches is unachievable under it even when every real branch is taken —
// the istanbul-remapped (json/lcov) report shows 100% branches. We hold a strict
// 95% floor; raising it to 100 would force `else {}` noise that buys nothing.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/test-helpers.ts"],
      thresholds: {
        lines: 100,
        statements: 100,
        functions: 100,
        branches: 95,
      },
    },
  },
});
