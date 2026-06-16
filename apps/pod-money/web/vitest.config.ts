// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Vitest config for the Pod Money static host. It MERGES the Vite build config
// (vite.config.ts) so the test run inherits the same resolve.alias (the local
// @jeswr/pod-money source + the single-React dedupe) and the `__APP_VERSION__`
// `define` the App reads — then layers the test-only settings on top.
//
// The environment is `jsdom` because the suite now has a COMPONENT test (the
// header FeedbackButton render) alongside the pure-logic tests. jsdom is a
// superset for the pure tests (they touch no conflicting DOM globals), so a
// single environment covers both. The setup file installs the jest-dom matchers
// + the `matchMedia` polyfill jsdom lacks (the app-shell ThemeProvider reads
// `prefers-color-scheme`).
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./test/setup.ts"],
      // src TS/TSX suites + the gen-clientid generator suite (a `.test.mjs` in
      // scripts/, kept OUT of tsc — see its header — but RUN by vitest).
      include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
      // INLINE the silent-restore package so the silent-restore wiring test can
      // mock `oauth4webapi` UNDERNEATH the package's real `restoreSession` (a
      // pre-bundled node_modules ESM dep is otherwise externalised, so a
      // `vi.mock("oauth4webapi")` would not reach its transitive import). The
      // package is pure ESM + side-effect-free, so inlining it is safe.
      server: {
        deps: {
          inline: ["@jeswr/solid-session-restore"],
        },
      },
    },
  }),
);
