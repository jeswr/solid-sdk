// AUTHORED-BY Claude Opus 5.5
//
// LIVE sign-in suite: drives Drive's deployed build (GitHub Pages by default) against a real
// identity provider. Never part of the default `test:e2e` run; it is opted into by the scheduled
// sign-in-live workflow (or `pnpm run test:e2e:live` with LIVE_APP_URL / LIVE_ISSUER set).
// It creates a throwaway account with random, never-logged credentials on the test IdP only.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  // Live providers are slower than a local CSS; one retry absorbs a transient network blip.
  retries: process.env.CI ? 1 : 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    headless: true,
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
