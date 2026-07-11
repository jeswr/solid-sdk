// AUTHORED-BY Claude Fable 5
// Scope the ROOT vitest run to the workspace-level script tests only. Without this,
// vitest's default include would slurp every packages/*/test suite from the root run —
// bypassing each package's own vitest config (e.g. solid-dpop excludes its live-CSS spec
// there) and double-running everything `pnpm -r test` already covers.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.mjs"],
  },
});
