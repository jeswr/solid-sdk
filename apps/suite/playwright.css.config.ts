// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// Opt-in local CSS harness. Loopback HTTP auth requires a development build:
//   SUITE_TEST_CAPS='{}' pnpm test:e2e:css
//   MATRIX=1 SUITE_TEST_CAPS='{}' pnpm test:e2e:css  # all six scenario 13 projects
// This suite is not wired into CI.
import { createServer } from "node:net";
import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (!address || typeof address === "string") throw new Error("No free CSS port");
  return address.port;
}

// Playwright reloads the config in workers. Inherit the runner's port instead of allocating
// a different issuer in each worker. Every run starts a fresh server and fresh accounts.
process.env.SUITE_CSS_PORT ??= String(await freePort());
const cssOrigin = `http://localhost:${process.env.SUITE_CSS_PORT}`;
const port = Number(process.env.SUITE_E2E_PORT ?? 3210);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  ...base,
  testDir: "./e2e/shell-css",
  testIgnore: [],
  globalSetup: "./e2e/shell-css/global-setup.ts",
  outputDir: "../../artifacts/playwright/SH-11",
  // Next dev plus concurrent OIDC/axe pages exceeds shared lane memory limits.
  workers: 1,
  // Live DPoP reads and conditional ACL writes can span several server round trips.
  expect: { ...base.expect, timeout: 30_000 },
  // Keep the normal local run small; opt into the complete responsive/theme matrix.
  projects: (base.projects ?? []).filter(
    (project) =>
      process.env.MATRIX === "1" || ["375-light", "1280-dark"].includes(project.name ?? ""),
  ),
  use: { ...base.use, baseURL },
  webServer: [
    {
      command: "node e2e/shell-css/server.mjs",
      env: { SUITE_CSS_PORT: process.env.SUITE_CSS_PORT },
      // Bob is created last. Its public profile is available only after both accounts,
      // password login methods and pods have been seeded through the account API.
      url: `${cssOrigin}/bob/profile/card`,
      reuseExistingServer: false,
      timeout: 120000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10000 },
    },
    {
      command: `next dev --webpack --hostname 127.0.0.1 -p ${port}`,
      env: {
        NEXT_PUBLIC_DEV_FIXTURES: "",
        // Leave room for CSS and Chromium on shared 16 GB lane hosts.
        NODE_OPTIONS: process.env.NODE_OPTIONS ?? "--max-old-space-size=3072",
        SUITE_E2E: "1",
        SUITE_TEST_CAPS: process.env.SUITE_TEST_CAPS ?? "{}",
      },
      url: `${baseURL}/signin`,
      reuseExistingServer: false,
      // Cold webpack compilation can exceed two minutes on a shared lane host.
      timeout: 300000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10000 },
    },
  ],
});
