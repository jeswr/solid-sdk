// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// DOM env: jsdom.
//
// We FIRST tried happy-dom (cleaner for Web Components in general), but it has a
// reproducible bug with Lit's conditional templates: a `${cond ? html`…` :
// nothing}` part renders as an escaped `&lt;?&gt;` marker on the SECOND instance
// of a component in the same test file (Lit's comment-based part markers don't
// survive happy-dom's serialisation across instances). jsdom renders Lit's
// conditional parts correctly, so we use jsdom (the documented fallback).
//
// CSS-cascade-through-shadow-boundary limitation (neither happy-dom NOR jsdom
// resolves `var(--x)` through a shadow root via getComputedStyle) is handled in
// the tests by asserting the token CONTRACT against the component's static
// styles text rather than computed style — see test/theming.test.ts.
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve the `browser` export condition. @lit/react ships a SEPARATE `node`
  // build (NODE_MODE=true) for SSR that DELIBERATELY does NOT set element
  // properties at render time (it emits `_$litProps$` for server hydration
  // instead). Under jsdom, vitest would otherwise pick the `node` condition and
  // the React wrappers would never forward props to the elements — a test-only
  // artifact, since a real browser bundler resolves the `browser` build. Forcing
  // `browser` makes the test environment match how these client-only components
  // actually run.
  resolve: {
    conditions: ["browser", "development", "import", "module", "default"],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
