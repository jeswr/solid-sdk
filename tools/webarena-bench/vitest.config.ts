// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Both opt-in admin files use the same fixture account and authentication state.
    fileParallelism: !process.env.SAB_LIVE_SITE_URL,
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    server: { deps: { inline: ["@jeswr/test-shop"] } },
  },
});
