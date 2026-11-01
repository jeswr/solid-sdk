// AUTHORED-BY Codex GPT-6.1-Sol
import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function audit(page: Page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}
async function navigate(page: Page, label: string) {
  const link = page
    .getByRole("navigation", { name: "Notes folders", exact: true })
    .getByRole("link", { name: label, exact: true })
    .filter({ visible: true });
  if (!(await link.count()))
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await link.click();
}
function card(page: Page, title: string) {
  return page.getByRole("article", { name: title, exact: true });
}
async function capture(page: Page, title: string, body: string) {
  await page.getByRole("textbox", { name: "Take a note", exact: true }).focus();
  await page.getByRole("textbox", { name: "Note title", exact: true }).fill(title);
  await page.getByRole("textbox", { name: "Note text", exact: true }).fill(body);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(card(page, title)).toHaveAttribute("aria-busy", "false");
}

test("Notes capture, checklist, labels, archive, trash, search and persistence are accessible", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const artifactDir = "../../artifacts/playwright/notes";
  await mkdir(artifactDir, { recursive: true });
  await page.goto("/notes");
  await expect(page.getByRole("heading", { name: "Notes you add appear here" })).toBeVisible();
  await capture(
    page,
    "Garden ideas",
    "Plant sunflowers beside the gate. A unique bodyword: heliotrope.",
  );
  await capture(page, "Trip plan", "Visit the coast and bring a book.");
  await page.getByRole("button", { name: "New list", exact: true }).click();
  await page.getByRole("textbox", { name: "Note title", exact: true }).fill("Weekend errands");
  await page.getByRole("textbox", { name: "List item 1", exact: true }).fill("Milk");
  await page.getByRole("textbox", { name: "List item 1", exact: true }).press("Enter");
  await page.getByRole("textbox", { name: "List item 2", exact: true }).fill("Bread");
  await page.getByRole("textbox", { name: "List item 2", exact: true }).press("Enter");
  await page.getByRole("textbox", { name: "List item 3", exact: true }).fill("Flowers");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(card(page, "Weekend errands")).toHaveAttribute("aria-busy", "false");
  await card(page, "Weekend errands").getByRole("checkbox", { name: "Bread", exact: true }).check();
  await expect(card(page, "Weekend errands")).toHaveAttribute("aria-busy", "false");
  await expect(
    card(page, "Weekend errands").getByRole("checkbox", { name: "Bread", exact: true }),
  ).toBeChecked();
  await card(page, "Garden ideas").hover();
  await card(page, "Garden ideas").getByRole("button", { name: "Pin note", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pinned", exact: true })).toBeVisible();
  await card(page, "Garden ideas")
    .getByRole("button", { name: "Note colour", exact: true })
    .click();
  await page.getByRole("radio", { name: "Yellow", exact: true }).check();
  await page.keyboard.press("Escape");
  await audit(page);
  await page.screenshot({
    path: `${artifactDir}/${testInfo.project.name}-grid.png`,
    fullPage: true,
  });
  await card(page, "Garden ideas")
    .getByRole("button", { name: "Open Garden ideas", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Edit note", exact: true });
  await expect(dialog.getByRole("textbox", { name: "Note body", exact: true })).toContainText(
    "heliotrope",
  );
  await dialog.getByRole("button", { name: "Edit note labels", exact: true }).click();
  await page.getByRole("textbox", { name: "New label", exact: true }).fill("Ideas & plans");
  await page.getByRole("button", { name: "Add label", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Note title", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Saved");
  await audit(page);
  await page.screenshot({
    path: `${artifactDir}/${testInfo.project.name}-dialog.png`,
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page).toHaveURL(/\/notes$/);
  await navigate(page, "Ideas & plans");
  await expect(page).toHaveURL(/\/notes\/label\//);
  await expect(card(page, "Garden ideas")).toBeVisible();
  await expect(card(page, "Trip plan")).toHaveCount(0);
  // Closing from a label returns to that label, including after changing its note.
  await card(page, "Garden ideas")
    .getByRole("button", { name: "Open Garden ideas", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page).toHaveURL(/\/notes\/label\//);
  await card(page, "Garden ideas").hover();
  await card(page, "Garden ideas")
    .getByRole("button", { name: "Archive note", exact: true })
    .click();
  await expect(card(page, "Garden ideas")).toHaveCount(0);
  await navigate(page, "Archive");
  await expect(card(page, "Garden ideas")).toBeVisible();
  await audit(page);
  await card(page, "Garden ideas").hover();
  await card(page, "Garden ideas")
    .getByRole("button", { name: "Unarchive note", exact: true })
    .click();
  await expect(card(page, "Garden ideas")).toHaveCount(0);
  await navigate(page, "Notes");
  await card(page, "Trip plan").hover();
  await card(page, "Trip plan")
    .getByRole("button", { name: "More note actions", exact: true })
    .click();
  await page.getByRole("button", { name: "Move to trash", exact: true }).click();
  await page.keyboard.press("Escape");
  await navigate(page, "Trash");
  await expect(card(page, "Trip plan")).toBeVisible();
  await audit(page);
  await page.screenshot({
    path: `${artifactDir}/${testInfo.project.name}-trash.png`,
    fullPage: true,
  });
  await card(page, "Trip plan").hover();
  await card(page, "Trip plan").getByRole("button", { name: "Restore note", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No notes in Trash" })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search notes", exact: true }).fill("heliotrope");
  await page.getByRole("searchbox", { name: "Search notes", exact: true }).press("Enter");
  await expect(card(page, "Garden ideas")).toBeVisible();
  await expect(card(page, "Trip plan")).toHaveCount(0);
  await page.reload();
  await expect(card(page, "Garden ideas")).toBeVisible();
  await navigate(page, "Notes");
  await expect(card(page, "Trip plan")).toBeVisible();
  await expect(
    card(page, "Weekend errands").getByRole("checkbox", { name: "Bread", exact: true }),
  ).toBeChecked();
  await expect(card(page, "Garden ideas")).toHaveAttribute("data-note-colour", "yellow");
  await expect(
    card(page, "Garden ideas").getByRole("link", { name: "Ideas & plans", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
