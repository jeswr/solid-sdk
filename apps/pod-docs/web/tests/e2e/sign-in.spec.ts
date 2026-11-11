// AUTHORED-BY Claude Opus 5.5
// Shared pod-auth attaches credentials on a 401 challenge, so the former proactive 401 budget no
// longer applies. This keeps a real popup sign-in and private document browsing through the
// host's explicit auth.fetch, and checks that global fetch stays public.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

interface Seeded {
  webId: string;
  email: string;
  password: string;
  podRoot: string;
  docsContainer: string;
  documentCount: number;
}
function readSeeded(): Seeded {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL("./.seeded-account.json", import.meta.url)), "utf8"),
  );
}

async function login(page: Page, seeded: Seeded) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "WebID", exact: true }).fill(seeded.webId);
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const popup = await popupPromise;
  await popup.getByLabel("Email", { exact: true }).fill(seeded.email);
  await popup.getByLabel("Password", { exact: true }).fill(seeded.password);
  await popup.getByRole("button", { name: /log ?in/i }).click();
  // A fresh account must explicitly authorize this app.
  await popup.getByRole("button", { name: /authorize|consent/i }).click();
}

test("shared sign-in lists private documents while global fetch stays public", async ({
  page,
  request,
}) => {
  const seeded = readSeeded();
  const anonymous = await request.get(seeded.docsContainer);
  expect([401, 403]).toContain(anonymous.status());
  await login(page, seeded);
  await expect
    .poll(async () => page.locator(".pod-docs-table tbody tr.pod-docs-row").count(), {
      timeout: 30_000,
    })
    .toBeGreaterThanOrEqual(seeded.documentCount);
  // Ambient fetch never gains the app's credentials, even after auth.fetch succeeded.
  const status = await page.evaluate(
    async (url) => (await fetch(url)).status,
    seeded.docsContainer,
  );
  expect([401, 403]).toContain(status);
});
