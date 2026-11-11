import { defineConfig, devices } from "@playwright/test";

// AUTHORED-BY GPT-6.1 Sol
// Distinct ports let the local CSS issuer and Next development host run together.
const APP_PORT = Number(process.env.IT_APP_PORT ?? 3200);
// Pod-auth discovers the issuer from the profile; it has no hardcoded port map.
const CSS_PORT = Number(process.env.IT_CSS_PORT ?? 3000);

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  // These golden-path tests drive a real popup OIDC login + cross-pod WAC/WebSocket
  // sync against a live local CSS, so an occasional auth/network stall under the
  // long sequential run is timing, not a logic failure. One retry lets a transient
  // flake self-recover; a genuine break still fails both attempts.
  retries: 1,
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
      // In-memory WAC CSS, pinned major 7 (AGENTS.md §Servers).
      command: `npx -y @solid/community-server@7 -p ${CSS_PORT}`,
      url: `http://localhost:${CSS_PORT}/`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      // HTTP and dynamic registration are restricted to a development loopback host.
      // Production builds remain checked separately by the scoped Turbo gate.
      command: `pnpm exec next dev -p ${APP_PORT}`,
      url: `http://localhost:${APP_PORT}`,
      timeout: 300_000,
      reuseExistingServer: !process.env.CI,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
