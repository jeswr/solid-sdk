import { defineConfig } from "@playwright/test";

/**
 * The starter suite exercises only the TOUR shell (disclaimers + axe), so no
 * zone app or Solid server boots here: zones honestly degrade to placeholder
 * links. Once your apps carry real pod flows, follow the house pattern — each
 * suite boots its OWN local in-memory Solid server + seeded accounts (wire the
 * seed layout from seeds/) rather than sharing a long-lived one.
 *
 * Browsers: `pnpm exec playwright install` once before `pnpm e2e`.
 */
export default defineConfig({
  testDir: ".",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
  },
  webServer:
    process.env.E2E_BASE_URL !== undefined
      ? undefined
      : {
          command: "pnpm --filter @__CSD_SLUG__/app-tour dev",
          reuseExistingServer: true,
          timeout: 120_000,
          url: "http://localhost:3000",
        },
});
