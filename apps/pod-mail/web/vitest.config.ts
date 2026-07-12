// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Vitest config for the Pod Mail static host. It MERGES the Vite build config
// (vite.config.ts) so the test run inherits the same resolve.alias (the local
// @jeswr/pod-mail source + the single-React dedupe) and the `__APP_VERSION__`
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
      include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
      // INLINE the silent-restore package so it is processed by Vitest (not loaded
      // as an opaque external CJS/ESM module). The provider's restore now delegates
      // the DPoP refresh-token GRANT to @jeswr/solid-session-restore's `restoreSession`,
      // which imports `oauth4webapi` + `dpop` as bare specifiers. The provider's
      // adversarial restore tests `vi.mock("oauth4webapi")` / `vi.mock("dpop")`; that
      // mock only reaches imports made INSIDE this package when the package is inlined.
      // Without this, restoreSession would hit the REAL oauth stack (network discovery)
      // and the provider tests could not exercise the wrapped grant.
      server: {
        deps: {
          inline: [/@jeswr\/solid-session-restore/],
        },
      },
    },
  }),
);
