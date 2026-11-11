// AUTHORED-BY Codex (GPT-6.1 Sol)
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { seedDemoSession } from "./demo-session";

test.beforeEach(({ page }) => seedDemoSession(page));
async function audit(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
test("creates a private site, previews and publishes Markdown, updates and unpublishes", async ({
  page,
}) => {
  await page.goto("/publish");
  await expect(page.getByRole("heading", { name: "Your sites", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "The little field journal", exact: true }).last(),
  ).toBeVisible();
  await audit(page);
  await page.getByRole("button", { name: "Create site", exact: true }).click();
  const create = page.getByRole("dialog", { name: "Create a site" });
  await create.getByLabel("Site name", { exact: true }).fill("A small green notebook");
  await create
    .getByLabel("Tagline", { exact: true })
    .fill("Fictional walks and small discoveries.");
  await create.getByLabel("Author name", { exact: true }).fill("Robin Fiction");
  await create.getByLabel("Theme", { exact: true }).selectOption("garden");
  await create.getByRole("button", { name: "Create site", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A small green notebook", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Your drafts are private.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "New post", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("An autumn walk");
  await page.getByLabel("URL slug", { exact: true }).fill("an-autumn-walk");
  await page.getByLabel("Summary", { exact: true }).fill("A quiet afternoon by a fictional river.");
  await page
    .getByLabel("Markdown", { exact: true })
    .fill(
      "## Along the river\n\nThe leaves were **golden**.\n\n<script>window.evil=true</script>\n\n[Elsewhere](https://example.org)",
    );
  const toggle = page.getByRole("button", { name: "Preview", exact: true });
  if (await toggle.isVisible()) await toggle.click();
  const preview = page.frameLocator('iframe[title="Published page preview"]');
  await expect(preview.getByRole("heading", { name: "An autumn walk", exact: true })).toBeVisible();
  await expect(preview.locator("strong")).toHaveText("golden");
  await expect(page.locator('iframe[title="Published page preview"]')).toHaveAttribute(
    "sandbox",
    "",
  );
  expect(
    await page.locator('iframe[title="Published page preview"]').getAttribute("srcdoc"),
  ).not.toContain("<script>");
  if (await toggle.isVisible())
    await page.getByRole("button", { name: "Write", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved to your pod", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Make this site public?" });
  await expect(confirmation).toBeVisible();
  await audit(page);
  await confirmation.getByRole("button", { name: "Publish publicly", exact: true }).click();
  await expect(page.getByText("Published to your pod", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Update", exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: /public\/sites\/a-small-green-notebook\/an-autumn-walk\/index.html/,
    }),
  ).toBeVisible();
  await audit(page);
  await page.getByLabel("Markdown", { exact: true }).fill("## A second look\n\nA new paragraph.");
  await page.getByRole("button", { name: "Update", exact: true }).click();
  await expect(page.locator(".pub-save-status")).toHaveText("");
  await expect(page.getByText("Published to your pod", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "Back to pages", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "A small green notebook", exact: true }).last().click();
  await page.getByRole("button", { name: "An autumn walk", exact: true }).click();
  await expect(page.getByLabel("Markdown", { exact: true })).toHaveValue(
    "## A second look\n\nA new paragraph.",
  );
  await page.getByRole("button", { name: "Unpublish", exact: true }).click();
  await expect(
    page.getByText("Page unpublished. It is now a private draft.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeVisible();
  await audit(page);
});
test("keeps an editor draft while offline and recovers it after reconnecting", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => sessionStorage.getItem("publish-offline") !== "1",
    });
  });
  await page.goto("/publish");
  await page.getByRole("button", { name: "The little field journal", exact: true }).last().click();
  await page.getByRole("button", { name: "A winter window box", exact: true }).click();
  await page.evaluate(() => {
    sessionStorage.setItem("publish-offline", "1");
    dispatchEvent(new Event("offline"));
  });
  await page.getByLabel("Markdown", { exact: true }).fill("Writing while offline.");
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
  await expect(page.getByText("Draft kept on this device.", { exact: false })).toBeVisible();
  await page.evaluate(() => {
    sessionStorage.removeItem("publish-offline");
    dispatchEvent(new Event("online"));
  });
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Back to pages", exact: true }).click();
  await page.getByRole("button", { name: "A winter window box", exact: true }).click();
  await expect(page.getByLabel("Markdown", { exact: true })).toHaveValue("Writing while offline.");
  await audit(page);
});
