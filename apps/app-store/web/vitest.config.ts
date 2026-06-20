// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Vitest config for the Solid App Store. MERGES the Vite build config so the test run
// inherits the same resolve.dedupe (single React) + the `__APP_VERSION__` define the
// App reads, then layers the test-only settings on top. The environment is `jsdom`
// because the suite has component tests (the header FeedbackButton render, the auth
// seam's restore-latch) alongside the pure-logic tests. The setup file installs the
// jest-dom matchers + the matchMedia / localStorage polyfills jsdom lacks.
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./test/setup.ts"],
      // The src component/logic tests AND the `scripts/` generator suites (plain
      // `.test.mjs`, kept out of tsc): gen-clientid (origin precedence) + gen-catalog
      // (DCAT shape + Turtle/JSON-LD isomorphism). Keeping `scripts/**/*.test.mjs` in
      // the include preserves their coverage under `npm test`.
      include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
    },
  }),
);
