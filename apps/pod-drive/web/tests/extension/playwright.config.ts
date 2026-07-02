// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Playwright config for the EXTENSION↔APP integration suite (bead suite-tracker-lpo). It proves
// Pod Drive works with the @jeswr Solid browser extension INSTALLED, and that the app hides its
// own duplicate account chrome (the app-shell <AccountMenu/>) when the extension is present.
//
// It reuses the SAME two-webServer harness as the base e2e config (CSS@3000 + vite@5173) and the
// SAME globalSetup (seeds the `alice` account/pod + writes tests/e2e/.seeded-account.json). The
// difference is the browser: the spec brings its OWN persistent context with the built extension
// loaded (--load-extension), because a standard Playwright context cannot host an MV3 extension.
// So there is NO `projects` browser here — the fixture in extension-app.spec.ts owns the context.
//
// The built extension `dist/` is located via POD_APP_EXTENSION_DIST (an absolute path) or the
// default sibling checkout `../../solid-browser-extension/dist`; the spec SKIPS-with-reason if it
// is absent, so this suite never fails merely because the sibling extension wasn't built.
//
// LOCAL-ONLY: every request targets the local CSS / local vite — never the live deploy.
//
// RUN: (build the extension first) then
//   POD_APP_EXTENSION_DIST=/abs/path/to/solid-browser-extension/dist \
//     npx playwright test --config tests/extension/playwright.config.ts
import { defineConfig } from "@playwright/test";

const CSS_PORT = 3000;
const APP_PORT = 5173;

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  // Loads an extension + drives an OIDC popup login → a generous ceiling.
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${APP_PORT}` },
  // Reuse the base e2e globalSetup (seeds the pod + writes .seeded-account.json into tests/e2e).
  globalSetup: "../e2e/global-setup.ts",
  webServer: [
    {
      command: `npx -y @solid/community-server@7 -p ${CSS_PORT}`,
      url: `http://localhost:${CSS_PORT}/`,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `npm run dev -- --port ${APP_PORT} --strictPort`,
      url: `http://localhost:${APP_PORT}`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
