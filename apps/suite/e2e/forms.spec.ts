// AUTHORED-BY Codex (GPT-6.1 Sol)
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("Forms demo: design, reorder by keyboard, preview, fill, responses, CSV and sharing", async ({
  page,
}) => {
  await page.goto("/signin");
  await page.getByRole("button", { name: "Try it with a demo pod", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto("/forms");
  await expect(page.getByRole("heading", { name: "Your forms" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Lantern Lane book club", exact: true }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Create form", exact: true }).click();
  await page.getByLabel("Form title", { exact: true }).fill("Fictional garden gathering");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Help us plan a gentle afternoon outdoors.");
  await page.getByRole("button", { name: "Add question", exact: true }).click();
  await page
    .getByRole("article", { name: "Question 1", exact: true })
    .getByLabel("Question title", { exact: true })
    .fill("Your favourite flower");
  await page.getByLabel("Required answer", { exact: true }).click();
  await page.getByRole("button", { name: "Duplicate question 1", exact: true }).click();
  await page
    .getByRole("article", { name: "Question 2", exact: true })
    .getByLabel("Question title", { exact: true })
    .fill("Your favourite tree");
  await page.getByRole("button", { name: "Move question 2 up", exact: true }).click();
  const movedTitle = page
    .getByRole("article", { name: "Question 1", exact: true })
    .getByLabel("Question title", { exact: true });
  await expect(movedTitle).toBeFocused();
  await expect(
    page.getByRole("status").filter({ hasText: "Your favourite tree moved to position 1 of 2." }),
  ).toHaveAttribute("aria-live", "polite");
  await page.getByRole("button", { name: "Move question 1 down", exact: true }).click();
  await expect(
    page
      .getByRole("article", { name: "Question 2", exact: true })
      .getByLabel("Question title", { exact: true }),
  ).toBeFocused();
  const grip = page.getByRole("button", { name: "Reorder question 2", exact: true });
  const dragLive = page.locator('[id^="DndLiveRegion"]');
  await grip.focus();
  await page.keyboard.press("Space");
  // Picking up announces the pick-up, then immediately that the question is over its own place.
  await expect(dragLive).toContainText(
    /Picked up Your favourite tree, position 2 of 2\.|Your favourite tree is over position 2 of 2\./,
  );
  // dnd-kit measures rects after pick-up, so a step can land before the layout settles (tasks-board does the same).
  for (let step = 0; step < 6; step++) {
    await page.keyboard.press("ArrowUp");
    if ((await dragLive.textContent())?.includes("is over position 1 of 2.")) break;
  }
  await expect(dragLive).toContainText("Your favourite tree is over position 1 of 2.");
  await page.keyboard.press("Space");
  await expect(dragLive).toContainText("Your favourite tree was dropped at position 1 of 2.");
  await expect(
    page
      .getByRole("article", { name: "Question 1", exact: true })
      .getByLabel("Question title", { exact: true }),
  ).toHaveValue("Your favourite tree");
  await page.getByRole("button", { name: "Save form", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Back to forms", exact: true }).click();
  await page.reload();
  const card = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Fictional garden gathering", exact: true }),
  });
  await card.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Fill link", { exact: true })).toHaveValue(/\/forms\/f\?form=/);
  await expect(dialog).toContainText("Copying a link doesn't change access");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await card.getByRole("link", { name: "Fill in form", exact: true }).click();
  await page.getByRole("button", { name: "Save response to my pod", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Review the highlighted answers" }),
  ).toBeVisible();
  await page.getByLabel("Your favourite tree (required)", { exact: true }).fill("Rowan");
  await expect(
    page.getByRole("alert").filter({ hasText: "Review the highlighted answers" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Your favourite flower (required)", { exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Your favourite flower (required)", { exact: true }).fill("Cornflower");
  await page.getByRole("button", { name: "Save response to my pod", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your response is saved", exact: true }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("link", { name: "Return to your forms", exact: true }).click();
  await card.getByRole("button", { name: "Responses", exact: true }).click();
  await expect(page.getByRole("table")).toContainText("Cornflower");
  await page.getByRole("button", { name: "Response 1", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Rowan");
  // The dialog focuses its Close button, whose tooltip takes the first Escape; close it directly.
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe("form-responses.csv");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
