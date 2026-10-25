// AUTHORED-BY Codex GPT-6.1-Sol
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  outputDir: "../../artifacts/playwright/DS-01",
  fullyParallel: true,
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:3210",
    browserName: "chromium",
    contextOptions: { reducedMotion: "reduce" },
    trace: "retain-on-failure",
  },
  projects: [375, 768, 1280].flatMap((width) =>
    (["light", "dark"] as const).map((colorScheme) => ({
      name: `${width}-${colorScheme}`,
      use: { viewport: { width, height: 900 }, colorScheme },
    })),
  ),
  webServer: {
    command: "pnpm dev --hostname 127.0.0.1",
    url: "http://127.0.0.1:3210/dev/components",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
