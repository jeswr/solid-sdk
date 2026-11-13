// AUTHORED-BY Claude Opus 5.5
import { expect, type Page, test } from "@playwright/test";

async function hold(page: Page, name: RegExp, ms = 1500) {
  const button = page.getByRole("button", { name }).last();
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  if (!box) throw new Error("button not visible");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

async function send(page: Page, text: string) {
  const box = page.getByRole("textbox").first();
  await box.fill(text);
  await box.press("Enter");
}

test("shopping: blocked upsell, set a limit, buy inside it, ask when over it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Find me running sneakers under $25" }).first().click();
  await page.getByRole("button", { name: "Choose" }).first().click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Buy Roadrunner Lite for $20?" })).toBeVisible();
  await expect(page.getByText("I ignored an instruction that was not from you")).toBeVisible();
  await sheet.getByRole("button", { name: "Set a spending limit" }).click();
  await expect(sheet.getByText(/can spend up to \$100 a month at Stride & Co without asking/)).toBeVisible();
  await hold(page, /Hold to set limit/);
  await expect(page.getByText(/New rule: up to \$100\/month at Stride & Co/)).toBeVisible();
  await send(page, "Reorder my usual socks");
  await expect(page.locator(".limit-chip").last()).toContainText("$32 of $100");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await send(page, "Get the Stormshell jacket too");
  await expect(page.getByRole("heading", { name: /This goes over your \$100 a month at Stride & Co by \$17/ })).toBeVisible();
  await page.getByRole("button", { name: "Not now" }).last().click();
  await expect(page.getByText(/Nothing was charged/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("mortgage: share only what is needed, face check, signed decision", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Get a mortgage decision in principle" }).first().click();
  await page.getByRole("button", { name: "Go with North Bank" }).click();
  await expect(page.getByRole("heading", { name: "Share 3 things with North Bank?" })).toBeVisible();
  await expect(page.getByText("3 years of bank transactions")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: /^Share 3/ }).click();
  await hold(page, /hold/i);
  await expect(page.getByRole("heading", { name: /Harbour Bank needs a face check/ })).toBeVisible();
  await page.getByRole("button", { name: "Start face check" }).click();
  await expect(page.getByText("up to $285,000")).toBeVisible({ timeout: 20_000 });
});

test("stop cancels a pending approval", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Find me running sneakers under $25" }).first().click();
  await page.getByRole("button", { name: "Choose" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.locator(".topbar").getByRole("button", { name: /^Stop/ }).click();
  await expect(page.getByText(/Cancelled by stop/)).toBeVisible();
});
