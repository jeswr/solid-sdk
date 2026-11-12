// AUTHORED-BY Codex (GPT-6.1 Sol)
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { seedDemoSession } from "./demo-session";

test.beforeEach(async ({ page }) => {
  await seedDemoSession(page);
});
for (const width of [375, 768, 1280]) {
  test(`recipe box, import, cooking and weekly plan at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/recipes");
    await expect(page.getByRole("heading", { name: "Your recipe box" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Roasted tomato & butter bean stew", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("status", { name: /Loading|Preparing/ })).toHaveCount(0);
    await page.getByLabel("Search recipes", { exact: true }).fill("butter bean");
    await page
      .getByRole("button", { name: "Roasted tomato & butter bean stew", exact: true })
      .click();
    await page.getByRole("button", { name: "Start cooking", exact: true }).click();
    await page.getByLabel("Scale recipe", { exact: true }).selectOption("2");
    await expect(page.getByText("4 tbsp olive oil", { exact: true })).toBeVisible();
    await page.getByLabel("4 tbsp olive oil", { exact: true }).check();
    await page.getByLabel(/^Step 1:/).check();
    await page.getByRole("button", { name: "Remove from favourites", exact: true }).click();
    await expect(page.getByText(/Saving your change/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Leave cook mode", exact: true })).toBeVisible();
    await expect(page.getByLabel("Scale recipe", { exact: true })).toHaveValue("2");
    await expect(page.getByLabel("4 tbsp olive oil", { exact: true })).toBeChecked();
    await expect(page.getByLabel(/^Step 1:/)).toBeChecked();
    await page.getByRole("button", { name: "Recipe box", exact: true }).last().click();
    await page.getByRole("button", { name: "Import", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Bring a recipe home" });
    await dialog.getByLabel("Page source or JSON-LD").fill(
      JSON.stringify({
        "@type": "Recipe",
        name: `Fictional kitchen soup ${width}`,
        prepTime: "PT45S",
        recipeYield: "2 servings",
        recipeIngredient: ["1 1/2 cups beans", "2 cups water"],
        recipeInstructions: [{ "@type": "HowToStep", text: "Simmer for 20 minutes." }],
      }),
    );
    await dialog.getByRole("button", { name: "Review recipe" }).click();
    const sheet = page.getByRole("dialog", { name: "Edit recipe" });
    await expect(sheet.getByLabel("Prep time (minutes)", { exact: true })).toHaveValue("0.75");
    await sheet.getByRole("button", { name: "Save recipe" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText(/Saving your change/)).toHaveCount(0);
    await page
      .getByLabel("Search recipes", { exact: true })
      .fill(`Fictional kitchen soup ${width}`);
    await expect(
      page.getByRole("button", { name: `Fictional kitchen soup ${width}`, exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: `Fictional kitchen soup ${width}`, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Plan this week", exact: true }).click();
    await page.getByLabel(/^tuesday/i).selectOption({ label: `Fictional kitchen soup ${width}` });
    await expect(page.getByText(/Saving your change/)).toHaveCount(0);
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
        .violations,
    ).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.emulateMedia({ colorScheme: "dark" });
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations,
    ).toEqual([]);
  });
}
