// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { seedDemoSession } from "./demo-session";

test.beforeEach(async ({ page }) => {
  await seedDemoSession(page);
});
for (const width of [375, 768, 1280]) {
  for (const theme of ["light", "dark"] as const) {
    test(`Markdown to edited presentation at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/slides");
      await expect(
        page.getByRole("button", { name: "Open A greener neighbourhood", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "From Markdown", exact: true }).last().click();
      const dialog = page.getByRole("dialog", { name: "Create from Markdown" });
      await dialog
        .getByLabel("Markdown", { exact: true })
        .fill(
          "# Lantern launch\nA fictional project\n???\nWelcome to our launch\n---\n# Our next step\nMake something small",
        );
      await dialog.getByRole("button", { name: "Create presentation", exact: true }).click();
      await page.getByLabel("Presentation name", { exact: true }).fill("Lantern launch revised");
      await page
        .getByLabel("Slide body · Markdown", { exact: true })
        .fill("**Ready** for a new idea");
      await page.getByLabel("Speaker notes", { exact: true }).fill("Remember to pause");
      await page.getByRole("button", { name: "Add slide", exact: true }).click();
      await page.getByLabel("Slide title", { exact: true }).fill("Thank you");
      for (const [label, option] of [
        ["Layout", "Section"],
        ["Theme", "Warm"],
        ["Aspect ratio", "4:3"],
      ] as const) {
        await page.getByRole("combobox", { name: label, exact: true }).click();
        await page.getByRole("option", { name: option, exact: true }).click();
      }
      await page.getByRole("checkbox", { name: "Skip when presenting", exact: true }).click();
      await page.getByRole("checkbox", { name: "Skip when presenting", exact: true }).click();
      await page.getByRole("button", { name: "Move slide 2 down", exact: true }).click();
      await expect(page.getByRole("list", { name: "Slide sorter" })).toContainText("3. Thank you");
      await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(result.violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export Markdown", exact: true }).click();
      expect((await download).suggestedFilename()).toBe("Lantern launch revised.md");
      await page.getByRole("button", { name: "Present", exact: true }).click();
      const presentation = page.getByRole("dialog", { name: "Presentation", exact: true });
      await expect(presentation).toContainText("Slide 1 of 3");
      await page.keyboard.press("End");
      await expect(presentation).toContainText("Slide 3 of 3");
      await page.keyboard.press("Home");
      await page.keyboard.press("Space");
      await expect(presentation).toContainText("Slide 2 of 3");
      await page.keyboard.press("Escape");
      await expect(presentation).toBeHidden();
      await page.getByRole("button", { name: "All presentations", exact: true }).click();
      await page.reload();
      await page.getByRole("button", { name: "Open Lantern launch revised", exact: true }).click();
      await expect(page.getByLabel("Slide body · Markdown", { exact: true })).toHaveValue(
        "**Ready** for a new idea",
      );
      await page.getByRole("button", { name: "All presentations", exact: true }).click();
      await page
        .getByRole("button", { name: "Delete Lantern launch revised", exact: true })
        .click();
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Open Lantern launch revised", exact: true }),
      ).toBeVisible();
    });
  }
}
test("presenter view syncs notes and navigation between windows", async ({ page, context }) => {
  await page.goto("/slides");
  await page.getByRole("button", { name: "Open A greener neighbourhood", exact: true }).click();
  const popup = context.waitForEvent("page");
  await page.getByRole("button", { name: "Presenter view", exact: true }).click();
  const presenter = await popup;
  await expect(
    presenter.getByRole("heading", { name: "Presenter view", exact: true }),
  ).toBeVisible();
  await expect(
    presenter.getByText("Welcome everyone to our fictional autumn gathering.", { exact: true }),
  ).toBeVisible();
  await presenter.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Presentation", exact: true })).toContainText(
    "Slide 2 of 3",
  );
  await expect(presenter.getByRole("timer", { name: "Elapsed time" })).toBeVisible();
  await presenter.getByRole("button", { name: "End presentation", exact: true }).click();
  await expect(presenter.getByText("Presentation ended", { exact: true })).toBeVisible();
  await presenter.close();
});
