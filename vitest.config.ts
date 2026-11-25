// AUTHORED-BY Claude Fable 5
// AUTHORED-BY Claude Opus 5.5 (testTimeout)
// Scope the ROOT vitest run to the workspace-level script tests only. Without this,
// vitest's default include would slurp every packages/*/test suite from the root run —
// bypassing each package's own vitest config (e.g. solid-dpop excludes its live-CSS spec
// there) and double-running everything `pnpm -r test` already covers.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.mjs"],
    // The guard tests spawn the real scripts over temporary workspaces; on a loaded CI
    // runner a single case can pass 5 s (check-app-duplication hit 5.48 s), so allow 30 s.
    testTimeout: 30_000,
  },
});
