// AUTHORED-BY Codex GPT-6.1-Sol
// Opt-in local CSS harness; build separately before running (capabilities are build-time):
//   SUITE_E2E=1 SUITE_TEST_CAPS='{}' NEXT_PUBLIC_DEV_FIXTURES= npx next build --webpack
//   SUITE_TEST_CAPS='{}' pnpm test:e2e:css
// Use the same SUITE_TEST_CAPS for both commands. This suite is not wired into CI.
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
  outputDir: "../../artifacts/playwright/SH-11",
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
      command: `next start --hostname 127.0.0.1 -p ${port}`,
      env: {
        NEXT_PUBLIC_DEV_FIXTURES: "",
        SUITE_E2E: "1",
        SUITE_TEST_CAPS: process.env.SUITE_TEST_CAPS ?? "{}",
      },
      url: `${baseURL}/signin`,
      reuseExistingServer: false,
      timeout: 120000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10000 },
    },
  ],
});
