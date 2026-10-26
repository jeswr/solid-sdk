// AUTHORED-BY Codex GPT-6.1-Sol
import { defineConfig } from "@playwright/test";

// Each lane checkout sets its own SUITE_E2E_PORT so parallel runs never share a server.
const port = Number(process.env.SUITE_E2E_PORT ?? 3210);
export default defineConfig({
  testDir: "./e2e",
  outputDir: "../../artifacts/playwright/DS-01",
  fullyParallel: true,
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  timeout: 60000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
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
    // A production build is deterministic (no on-demand dev compiles timing out tests).
    command: `next build --webpack && next start --hostname 127.0.0.1 -p ${port}`,
    env: { NEXT_PUBLIC_DEV_FIXTURES: "1" },
    url: `http://127.0.0.1:${port}/dev/components`,
    reuseExistingServer: false,
    timeout: 300000,
  },
});
