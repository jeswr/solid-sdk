// AUTHORED-BY Claude Opus 5.5
import { defineConfig } from "@playwright/test";

/** The demo flows at phone and desktop widths. Set PW_CHROMIUM to use a preinstalled browser. */
export default defineConfig({
  testDir: "./e2e",
  reporter: "list",
  outputDir: "./e2e/results",
  timeout: 90_000,
  use: {
    baseURL: "http://127.0.0.1:5191",
    browserName: "chromium",
    trace: "off",
    ...(process.env.PW_CHROMIUM ? { launchOptions: { executablePath: process.env.PW_CHROMIUM } } : {}),
  },
  projects: [
    { name: "phone", use: { viewport: { width: 390, height: 844 } } },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 5191 --strictPort",
    url: "http://127.0.0.1:5191",
    reuseExistingServer: false,
  },
});
