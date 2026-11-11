// AUTHORED-BY Codex GPT-6.1-Sol
import { accessible, expect, test, warmLiveRoutes } from "./fixtures";

const caps = JSON.parse(process.env.SUITE_TEST_CAPS ?? "{}") as Record<string, boolean>;

test.beforeAll(({ request }) => warmLiveRoutes(request));

test("scenario 11: a chosen theme persists across a real session reload", async ({ page }) => {
  await page.goto("/settings/appearance");
  // Choose the opposite of the project's OS theme to prove the preference wins on reload.
  const dark = await page.evaluate(() => !matchMedia("(prefers-color-scheme: dark)").matches);
  const choice = page.getByRole("radio", { name: dark ? "Dark" : "Light", exact: true });
  await choice.check();
  await expect(choice).toBeChecked();
  await expect(page.locator("html")).toHaveClass(dark ? /\bdark\b/ : /\blight\b/);
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  await accessible(page);
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: "Appearance", exact: true }),
  ).toBeVisible();
  await expect(choice).toBeChecked();
  await expect(page.locator("html")).toHaveClass(dark ? /\bdark\b/ : /\blight\b/);
  await accessible(page);
});

test("scenario 11: density changes the computed row height and persists", async ({ page }) => {
  await page.goto("/settings/appearance");
  const density = page.getByRole("combobox", { name: "Density", exact: true });
  await density.selectOption({ label: "Comfortable" });
  const rowHeight = () =>
    page
      .locator("html")
      .evaluate((html) => getComputedStyle(html).getPropertyValue("--row-h").trim());
  await expect.poll(rowHeight).toBe("44px");
  await density.selectOption({ label: "Compact" });
  await expect(density).toHaveValue("compact");
  await expect.poll(rowHeight).toBe("32px");
  await accessible(page);
  await page.reload();
  await expect(density).toHaveValue("compact");
  await expect.poll(rowHeight).toBe("32px");
  await accessible(page);
  await density.selectOption({ label: "Comfortable" });
  await expect.poll(rowHeight).toBe("44px");
});

test("scenario 11: the storage capability table matches SUITE_TEST_CAPS", async ({ page }) => {
  await page.goto("/settings/storage");
  await expect(page.getByRole("heading", { level: 1, name: "Storage", exact: true })).toBeVisible();
  const table = page.getByRole("table", { name: "What your storage supports", exact: true });
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader")).toHaveText(["Feature", "Available"]);
  const features = [
    ["realtimeCollab", "Live co-editing"],
    ["liveUpdates", "Live updates"],
    ["serverSearch", "Search"],
    ["accessRequests", "Access requests"],
    ["versioning", "Version history"],
    ["trash", "Trash"],
    ["publicLinks", "Link sharing"],
    ["grantExpiry", "Expiring access"],
    ["move", "Move"],
  ] as const;
  await expect(table.getByRole("row")).toHaveCount(features.length + 1);
  for (const [key, label] of features) {
    const row = table.getByRole("row").filter({
      has: page.getByRole("rowheader", { name: label, exact: true }),
    });
    await expect(row.getByRole("cell")).toHaveText(caps[key] === true ? "Yes" : "No");
  }
  await accessible(page);
});
