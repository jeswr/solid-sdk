// AUTHORED-BY Codex GPT-6.1-Sol
// Shared pod-auth uses reactive challenges. The former proactive 401 budget no longer applies.
// Keep a real popup and private-container browsing test for the host's explicit fetch seam.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

interface Seeded {
  webId: string;
  email: string;
  password: string;
  podRoot: string;
  manyContainer: string;
  manyChildCount: number;
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
  await expect(page.getByRole("region", { name: "Your files" })).toBeVisible();
}

test("shared sign-in opens private files while global fetch stays public", async ({
  page,
  request,
}) => {
  const seeded = readSeeded();
  const anonymous = await request.get(seeded.manyContainer);
  expect([401, 403]).toContain(anonymous.status());
  await login(page, seeded);
  await page.getByRole("button", { name: "many", exact: true }).click();
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(seeded.manyChildCount + 1);
  // Ambient fetch never gains Drive's credentials, even after the explicit auth.fetch succeeded.
  const status = await page.evaluate(
    async (url) => (await fetch(url)).status,
    seeded.manyContainer,
  );
  expect([401, 403]).toContain(status);
});
