// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Local CSS + Vite smoke test for shared sign-in and private browsing.
// The shared core owns credential challenges; Drive preserves public global fetch.
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
  // The private-browsing spec drives a real OIDC popup login + a container listing, so it
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
      // In-memory WAC CSS, pinned major 7 (the suite-standard local Solid server).
      // reuseExistingServer:false ALWAYS — global-setup seeds a FIXED `alice` account/pod,
      // so a reused (stateful) CSS from a prior run would make the second pod-create 4xx
      // (the roborev LOW finding). A fresh in-memory CSS per run guarantees clean state
      // locally AND in CI; the ~13s boot is paid once per `playwright test` invocation.
      command: `npx -y @solid/community-server@7 -p ${CSS_PORT}`,
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
