// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// DOM env: jsdom.
//
// We use jsdom (not happy-dom) for the same reason @jeswr/solid-elements does:
// happy-dom has a reproducible bug with Lit's conditional templates rendering an
// escaped `&lt;?&gt;` marker on a second component instance in one file. jsdom
// renders Lit's conditional parts correctly.
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve the `browser` export condition so Lit + @lit/react pick their browser
  // builds under jsdom (the `node` SSR build of @lit/react deliberately does not
  // set element properties at render time).
  resolve: {
    conditions: ["browser", "development", "import", "module", "default"],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
    // The packaged-dist smoke test builds dist/ on a cold checkout — allow time.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
