// AUTHORED-BY Codex GPT-6
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "screens.spec.ts",
  fullyParallel: true,
  workers: 2,
  reporter: "list",
  outputDir: "./e2e/results",
  use: { baseURL: "http://127.0.0.1:5184", browserName: "chromium", trace: "retain-on-failure" },
  projects: [375, 768, 1280].flatMap((width) =>
    (["light", "dark"] as const).map((colorScheme) => ({
      name: `${width}-${colorScheme}`,
      use: { viewport: { width, height: 960 }, colorScheme },
    })),
  ),
  webServer: {
    command: "pnpm exec vite --mode screens --host 127.0.0.1 --port 5184 --strictPort",
    url: "http://127.0.0.1:5184",
    reuseExistingServer: false,
  },
});
