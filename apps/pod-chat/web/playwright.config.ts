// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Local CSS + Vite smoke test for shared sign-in and private room browsing.
// The shared core owns credential challenges; Chat preserves public global fetch.
import { defineConfig, devices } from "@playwright/test";

const CSS_PORT = 3000;
// The Vite dev server default port — and the dev clientid origin
// (scripts/gen-clientid.mjs DEV_DEFAULT), so the served origin matches its clientid.
const APP_PORT = 5173;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  // The sign-in spec drives a real OIDC popup login + a room listing, so it
  // needs a generous ceiling (CSS round-trips + the popup dance).
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: "retain-on-failure",
    headless: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  globalSetup: "./tests/e2e/global-setup.ts",
  webServer: [
    {
      // In-memory WAC CSS, pinned to an EXACT 7.x patch (the suite-standard local Solid
      // server). Pinning the exact version — not the floating `@7` major — makes the e2e
      // REPRODUCIBLE: a new CSS patch release can't silently change behaviour without a
      // repo change (the roborev LOW finding). We deliberately keep `npx` (not a declared
      // devDependency): CSS pulls ~635 packages, so vendoring it into every pod-app's
      // node_modules would balloon disk for an e2e-only, ephemeral server — the suite's
      // disk-hygiene rule. `npx` caches it in the shared npm cache after first fetch.
      // reuseExistingServer:false ALWAYS — global-setup seeds a FIXED `alice` account/pod,
      // so a reused (stateful) CSS from a prior run would make the second pod-create 4xx.
      // A fresh in-memory CSS per run guarantees clean state locally AND in CI; the ~13s
      // boot is paid once per `playwright test` invocation.
      command: `npx -y @solid/community-server@7.1.9 -p ${CSS_PORT}`,
      url: `http://localhost:${CSS_PORT}/`,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      // The Vite host. `npm run dev` runs gen-clientid (dev default origin = :5173)
      // then `vite`. `--strictPort` so a port clash fails loudly rather than silently
      // moving the app off the clientid origin.
      command: `npm run dev -- --port ${APP_PORT} --strictPort`,
      url: `http://localhost:${APP_PORT}`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
