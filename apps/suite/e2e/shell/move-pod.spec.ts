// AUTHORED-BY Codex GPT-6.1-Sol
import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("Settings links to the migration section and explains the real-pod requirement", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "suite.accounts.v1",
      JSON.stringify({
        activeId: "demo",
        accounts: [
          {
            id: "demo",
            name: "Alice Wilder",
            webId: "https://alice.demo.pod/profile/card#me",
            storageUrl: "https://alice.demo.pod/",
            kind: "demo",
          },
        ],
      }),
    );
  });
  await page.goto("/settings/account");
  const link = page.getByRole("link", { name: "Move to another pod", exact: true });
  if ((page.viewportSize()?.width ?? 1280) < 1024) {
    await page.getByRole("button", { name: /sidebar/i }).click();
  }
  await expect(link).toHaveAttribute("href", "/settings/move-pod");
  await link.click();
  await expect(page).toHaveURL(/\/settings\/move-pod$/);
  await expect(page.getByText(/Moving to another pod needs a real pod/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Move to another pod", level: 1, exact: true }),
  ).toBeVisible();
  if (info.project.name.endsWith("dark")) await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("button", { name: /Sign in to target|Start migration/ })).toHaveCount(
    0,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir("/tmp/migrator-shots", { recursive: true });
  await page.screenshot({
    path: `/tmp/migrator-shots/settings-${info.project.name}.png`,
    fullPage: true,
  });
});
