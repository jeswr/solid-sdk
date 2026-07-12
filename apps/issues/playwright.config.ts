import { defineConfig, devices } from "@playwright/test";

// CSS MUST own :3000 (the auth issuer map keys localhost:3000 to the local CSS issuer);
// next dev ALSO defaults to :3000, so the app moves to :3200 (AGENTS.md §Servers).


// App port is also overridable (other projects on this machine grab :3200).
const APP_PORT = Number(process.env.IT_APP_PORT ?? 3200);
// CSS normally owns :3000 (AGENTS.md §Servers). Overridable via CSS_PORT when
// :3000 is taken — safe here because the app uses the issuer-from-profile
// WebIdDPoPTokenProvider (not the published provider's hardcoded :3000 map).
// Note: do NOT use a CSS_-prefixed env var — CSS consumes those as CLI options.
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
      // Serve a PRODUCTION build, not `next dev`. Dev mode compiles each route
      // lazily on its first request and streams a half-ready page meanwhile, which
      // intermittently stalls the first keyboard/click of a test that navigates to
      // a not-yet-compiled view — the dominant source of E2E flakiness here. A
      // prod build is fully compiled up front, so the served pages are stable.
      // `next build` is idempotent and cheap; the timeout covers it on a cold run.
      command: `npx next build && npx next start -p ${APP_PORT}`,
      url: `http://localhost:${APP_PORT}`,
      timeout: 300_000,
      reuseExistingServer: !process.env.CI,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
