// AUTHORED-BY Codex (GPT-6.1 Sol)
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { seedDemoSession } from "./demo-session";

test.beforeEach(({ page }) => seedDemoSession(page));
test("demo shelves, add, rate, review, finish, reload, CSV import and year in review", async ({
  page,
}) => {
  await page.goto("/media");
  await expect(page.getByRole("heading", { name: "Your media", exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Media items" }).getByRole("listitem")).toHaveCount(
    10,
    { timeout: 30000 },
  );
  await page
    .getByRole("button", { name: "Add item", exact: true })
    .filter({ visible: true })
    .click();
  const editor = page.getByRole("dialog");
  await expect(editor).toBeVisible();
  await editor.getByLabel("Title", { exact: true }).fill("Lanterns over the Estuary");
  await editor.getByLabel("Release or publication year").fill("2026");
  await editor.getByLabel("Creator or author").fill("Aster Vale");
  await editor.getByLabel("Your rating (0.5–5)").fill("4.5");
  await editor.getByLabel("Your review").fill("A beautiful fictional journey.");
  await editor.getByRole("button", { name: "Save item", exact: true }).click();
  await expect(editor).toBeHidden();
  await page.getByLabel("Search media", { exact: true }).fill("Lanterns over the Estuary");
  const library = page.getByRole("list", { name: "Media items" });
  await expect(library.getByRole("listitem")).toHaveCount(1);
  await expect(page.locator(".media-save-status")).toHaveText("", { timeout: 30000 });
  await page
    .getByRole("button", { name: "Edit & review Lanterns over the Estuary", exact: true })
    .click();
  const edit = page.getByRole("dialog");
  await edit.getByLabel("Shelf", { exact: true }).click();
  await page.getByRole("option", { name: "Finished", exact: true }).click();
  await edit.getByLabel("Finished on", { exact: true }).fill("2026-11-11");
  await edit.getByRole("button", { name: "Save item", exact: true }).click();
  await expect(page.locator(".media-save-status")).toHaveText("", { timeout: 30000 });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Edit & review Lanterns over the Estuary", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page.getByLabel("Search media", { exact: true }).fill("Lanterns over the Estuary");
  await expect(page.getByText("Finished 11 Nov 2026", { exact: true })).toBeVisible();
  await expect(page.getByText("A beautiful fictional journey.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
  const importer = page.getByRole("dialog");
  await importer.getByLabel("CSV file (up to 4 MiB, 5,000 rows)").setInputFiles({
    name: "watched.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Name,Year,Watched Date,Rating\nThe Copper Shore,2025,2026-10-12,4"),
  });
  await expect(
    importer.getByText("1 ready to import · 0 skipped · 0 already in your library"),
  ).toBeVisible();
  await importer.getByRole("button", { name: "Import 1 item", exact: true }).click();
  await page.getByLabel("Search media", { exact: true }).fill("Copper Shore");
  await expect(library.getByRole("listitem")).toHaveCount(1);
  await expect(page.locator(".media-save-status")).toHaveText("", { timeout: 30000 });
  await expect(page.getByText("Imported 1 · skipped 0 · failed 0", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
  const diary = page.getByRole("dialog");
  await diary.getByLabel("CSV file (up to 4 MiB, 5,000 rows)").setInputFiles({
    name: "diary.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Date,Name,Year,Letterboxd URI,Watched Date,Rating\n2026-10-12,The Copper Shore,2025,https://letterboxd.com/aster-fiction/film/the-copper-shore/1/,2026-10-12,4",
    ),
  });
  await expect(
    diary.getByText("0 ready to import · 0 skipped · 1 already in your library"),
  ).toBeVisible();
  await expect(diary.getByRole("button", { name: "Import items", exact: true })).toBeDisabled();
  await diary.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .locator(".media-heading")
    .getByRole("button", { name: "Your year", exact: true })
    .click();
  await expect(page.getByRole("region", { name: "Year in review" })).toBeVisible();
  await page.getByLabel("Year", { exact: true }).fill("2026");
  await expect(page.getByRole("table")).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator(".media-heading").getByRole("button", { name: "Back to shelves" }).click();
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
});
