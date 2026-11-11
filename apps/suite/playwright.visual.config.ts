// AUTHORED-BY Claude Opus 5.5
// DS-13 visual gate: `pnpm test:visual` (check) and `pnpm test:visual:update` (refresh).
// Same server and 6 width × theme projects as playwright.config.ts, limited to e2e/visual.
// Baselines are Linux-container renders (see e2e/visual/__screenshots__/README.md), so this
// suite stays out of the default `playwright test` run and out of CI.
import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testDir: "./e2e/visual",
  testIgnore: [],
  outputDir: "../../artifacts/playwright/DS-13",
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  use: { ...base.use, locale: "en-GB", timezoneId: "UTC" },
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.001, animations: "disabled", caret: "hide" },
  },
});
