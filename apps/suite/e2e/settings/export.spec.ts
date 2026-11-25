// AUTHORED-BY Codex GPT-6.1-Sol
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { seedDemoSession } from "../demo-session";

test("Settings exports the demo pod as a readable ZIP", async ({ page }) => {
  await seedDemoSession(page);
  await page.goto("/settings/storage");
  if ((page.viewportSize()?.width ?? 1280) < 1024)
    await page.getByRole("button", { name: "Toggle sidebar", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Settings sections", exact: true })
    .filter({ visible: true })
    .getByRole("link", { name: "Export", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Download your data" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start export", exact: true })).toBeEnabled({
    timeout: 60000,
  });
  await page.getByRole("button", { name: "Start export", exact: true }).click();
  const downloadLink = page.getByRole("link", { name: "Download ZIP" });
  await expect(downloadLink).toBeVisible({ timeout: 60000 });
  const downloading = page.waitForEvent("download");
  await downloadLink.click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^pod-export-\d{4}-\d{2}-\d{2}\.zip$/);
  const path = await download.path();
  expect(path).not.toBeNull();
  const files = unzipSync(new Uint8Array(await readFile(path as string)));
  expect(files["pod/profile/card"]).toBeDefined();
  expect(strFromU8(files["pod/profile/card"] as Uint8Array)).toContain("Alice Wilder");
  expect(files["pod/.acl"]).toBeDefined();
  const manifest = JSON.parse(strFromU8(files["export-manifest.json"] as Uint8Array));
  expect(manifest.entries.length).toBeGreaterThan(10);
  expect(
    manifest.entries.some(
      (entry: { path: string; kind: string }) => entry.path === "pod/.acl" && entry.kind === "acl",
    ),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
