// AUTHORED-BY GPT-6.1 Sol
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { defineConfig, devices } from "@playwright/test";

// E2E uses a real local CSS on :3000 and the app on :3200. The app must
// run in development: production deliberately forbids insecure loopback auth.
const APP_PORT = 3200;
const CSS_PORT = 3000;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: "retain-on-failure",
    headless: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  globalSetup: "./e2e/global-setup.ts",
  webServer: [
    {
      command: `npx -y @solid/community-server@7 -p ${CSS_PORT}`,
      url: `http://localhost:${CSS_PORT}/`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `pnpm exec next dev --webpack -p ${APP_PORT}`,
      env: { NEXT_PUBLIC_HOME_IDP: `http://localhost:${CSS_PORT}` },
      url: `http://localhost:${APP_PORT}`,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
