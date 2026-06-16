// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Vitest config for the Pod Chat static host. It MERGES the Vite build config
// (vite.config.ts) so the test run inherits the same resolve.alias (the local
// @jeswr/pod-chat source + the single-React dedupe) and the `__APP_VERSION__`
// `define` the App reads — then layers the test-only settings on top.
//
// ENVIRONMENT: the DEFAULT stays `node` — the existing auth + gen-clientid tests
// were written for a DOM-less environment and deliberately install their OWN
// stubs on `globalThis` (a `customElements` registry, a `sessionStorage`
// stand-in, `crypto.subtle`), so switching the WHOLE suite to jsdom would make
// them race jsdom's pre-existing DOM globals instead of their controlled stubs.
// The single COMPONENT test (the header FeedbackButton render) opts INTO jsdom
// per-file via a `// @vitest-environment jsdom` pragma at the top of
// src/feedback-button.test.tsx — so only that file gets a DOM, and the auth/
// script tests keep the exact node environment they were authored against.
//
// The setup file (jest-dom matchers + a `matchMedia` polyfill the app-shell
// ThemeProvider reads) is safe to run for ALL files: the matchers are inert in
// node and the polyfill is guarded by `typeof window !== "undefined"`, so it only
// installs in the jsdom-pragma'd component test.
//
// INCLUDE: `src/**/*.test.{ts,tsx}` covers the auth-logic + component tests; the
// extra `scripts/**/*.test.mjs` glob KEEPS the existing gen-clientid generator
// test (a `.mjs` vitest suite that co-locates with the plain-JS generator script)
// in the run — a default-config drop would silently lose that coverage.
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "node",
      globals: true,
      setupFiles: ["./test/setup.ts"],
      include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
    },
  }),
);
