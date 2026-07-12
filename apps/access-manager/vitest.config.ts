// AUTHORED-BY Claude Fable 5
//
// Two environments: the data layer (test/lib) runs in node; the React views
// (test/ui) run in jsdom. Every test stubs `fetch` through the injectable
// authenticated-fetch seam — NO live Solid server is needed for the gate.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    // Default node; UI tests opt into jsdom via a per-file
    // `// @vitest-environment jsdom` docblock (vitest 4 dropped
    // environmentMatchGlobs).
    environment: "node",
    // Required for @testing-library/react's auto-cleanup between tests.
    globals: true,
    // Node 25 exposes an incomplete global localStorage unless it is started
    // with --localstorage-file. That stub makes Vitest skip jsdom's real
    // Storage implementation when it populates the test global. Disable the
    // Node API in workers that support the flag so jsdom supplies localStorage.
    execArgv: process.allowedNodeEnvironmentFlags.has("--no-webstorage") ? ["--no-webstorage"] : [],
    setupFiles: ["test/setup.ts"],
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
});
