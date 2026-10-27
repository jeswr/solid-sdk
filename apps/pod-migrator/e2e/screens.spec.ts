// AUTHORED-BY Codex GPT-6
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

test("connection, options, review, run, and result screens", async ({ page }, info) => {
  const directory = fileURLToPath(new URL("./screens/", import.meta.url));
  await mkdir(directory, { recursive: true });
  const capture = async (screen: string) => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `${directory}/${info.project.name}-${screen}.png`,
      fullPage: true,
      animations: "disabled",
    });
  };
  await page.goto("/?signed-out");
  await expect(page.getByRole("button", { name: "Sign in to source" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to target" })).toBeDisabled();
  await capture("connect");
  await page.goto("/");
  await page.getByRole("button", { name: "Continue to target" }).click();
  await page.getByRole("button", { name: "Continue to options" }).click();
  await capture("options");
  await page.getByRole("button", { name: "Create migration plan" }).click();
  await expect(page.getByRole("button", { name: "Start migration" })).toBeDisabled();
  await page.getByText("Choose what happens to your friends group", { exact: true }).click();
  await capture("review");
  await page.getByRole("radio", { name: /Stop the migration/ }).check();
  await expect(page.getByText("Migration will not run.")).toBeVisible();
  await page.getByRole("radio", { name: /Leave out the group grant/ }).check();
  await page.getByRole("button", { name: "Start migration" }).click();
  await expect(page.getByRole("progressbar")).toHaveAttribute("value", "42");
  await capture("run");
  await page.evaluate(() => window.dispatchEvent(new Event("finish-fixture-migration")));
  await expect(page.getByText("Verification passed", { exact: true })).toBeVisible();
  await capture("result");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download report JSON" }).click();
  expect((await download).suggestedFilename()).toBe("pod-migration-report.json");
});
