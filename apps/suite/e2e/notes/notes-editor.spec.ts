// AUTHORED-BY Codex GPT-6.1-Sol
import { fileURLToPath } from "node:url";
import {
  audit,
  capture,
  card,
  expect,
  folders,
  navigate,
  openNote,
  test,
  trashNote,
} from "../fixtures/notes";

test("edits a captured note and remembers list and grid views across reload", async ({ page }) => {
  await page.goto("/notes");
  await capture(page, "Draft idea", "The original idea");
  const dialog = await openNote(page, "Draft idea");
  await dialog.getByRole("textbox", { name: "Note title", exact: true }).fill("Finished idea");
  await dialog
    .getByRole("textbox", { name: "Note body", exact: true })
    .fill("A revised idea with every detail.");
  await expect(dialog.getByRole("status")).toHaveText("Saved");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(card(page, "Finished idea")).toContainText("A revised idea with every detail.");
  await page.getByRole("button", { name: "List view", exact: true }).click();
  await expect(page.locator(".notes-workspace")).toHaveAttribute("data-view", "list");
  await page.reload();
  await expect(card(page, "Finished idea")).toContainText("A revised idea with every detail.");
  await expect(page.locator(".notes-workspace")).toHaveAttribute("data-view", "list");
  await page.getByRole("button", { name: "Grid view", exact: true }).click();
  await expect(page.locator(".notes-workspace")).toHaveAttribute("data-view", "grid");
  await page.reload();
  await expect(page.locator(".notes-workspace")).toHaveAttribute("data-view", "grid");
});

test("sets a reminder, finds it in Reminders, then removes it in the editor", async ({ page }) => {
  await page.goto("/notes");
  await capture(page, "Water the plants", "Check the pots");
  await card(page, "Water the plants").hover();
  await card(page, "Water the plants")
    .getByRole("button", { name: "Remind me", exact: true })
    .click();
  await page.getByRole("button", { name: "Tomorrow", exact: true }).click();
  await expect(card(page, "Water the plants")).toHaveAttribute("aria-busy", "false");
  await expect(card(page, "Water the plants").locator("time")).toBeVisible();
  await navigate(page, "Reminders");
  await expect(card(page, "Water the plants")).toBeVisible();
  await page.reload();
  const dialog = await openNote(page, "Water the plants");
  await dialog.getByRole("button", { name: "Remind me", exact: true }).click();
  await page.getByRole("button", { name: "Remove reminder", exact: true }).click();
  await expect(dialog.locator("time")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Notes with reminders appear here", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(card(page, "Water the plants")).toHaveCount(0);
  await navigate(page, "Notes");
  await expect(card(page, "Water the plants").locator("time")).toHaveCount(0);
});

test("attaches an image with a description and reloads it from the pod", async ({ page }) => {
  await page.goto("/notes");
  await capture(page, "Garden photo", "A place for the new border");
  const dialog = await openNote(page, "Garden photo");
  await dialog.getByRole("textbox", { name: "Note body", exact: true }).press("ControlOrMeta+End");
  await dialog
    .getByLabel("Choose note image", { exact: true })
    .setInputFiles(fileURLToPath(new URL("../fixtures/notes-image.svg", import.meta.url)));
  await page
    .getByRole("textbox", { name: "Describe this image for people who can't see it", exact: true })
    .fill("A flower in the garden");
  await page.getByRole("button", { name: "Insert image", exact: true }).click();
  await expect(
    dialog.getByRole("img", { name: "A flower in the garden", exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole("status")).toHaveText("Saved");
  await audit(page, "editor-with-image");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const cover = card(page, "Garden photo").getByRole("img", {
    name: "A flower in the garden",
    exact: true,
  });
  await expect(cover).toHaveAttribute("src", /^blob:/);
  await expect
    .poll(() => cover.evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await page.reload();
  await expect(cover).toHaveAttribute("src", /^blob:/);
  await expect
    .poll(() => cover.evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await openNote(page, "Garden photo");
  await expect(
    dialog.getByRole("img", { name: "A flower in the garden", exact: true }),
  ).toBeVisible();
});

test("confirms permanent deletion and keeps a cancelled deletion recoverable", async ({ page }) => {
  await page.goto("/notes");
  await capture(page, "Temporary note", "Remove this later");
  await trashNote(page, "Temporary note");
  await navigate(page, "Trash");
  await card(page, "Temporary note").hover();
  await card(page, "Temporary note")
    .getByRole("button", { name: "Delete forever", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", { name: "Delete forever", exact: true });
  await expect(confirmation.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(card(page, "Temporary note")).toBeVisible();
  await card(page, "Temporary note")
    .getByRole("button", { name: "Delete forever", exact: true })
    .click();
  await confirmation.getByRole("button", { name: "Delete forever", exact: true }).click();
  await expect(confirmation).toBeHidden();
  await expect(page.getByRole("heading", { name: "No notes in Trash", exact: true })).toBeVisible();
  await page.reload();
  await expect(card(page, "Temporary note")).toHaveCount(0);
  await navigate(page, "Notes");
  await expect(card(page, "Temporary note")).toHaveCount(0);
});

test("opens Keep import, reviews a fixture and imports its text and checklist", async ({
  page,
}) => {
  await page.goto("/notes");
  await (await folders(page))
    .getByRole("button", { name: "Import from Keep", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Import from Google Keep", exact: true });
  await expect(
    dialog.getByRole("button", { name: "Choose Keep folder", exact: true }),
  ).toBeEnabled();
  await expect(
    dialog.getByRole("button", { name: "Choose note files", exact: true }),
  ).toBeEnabled();
  await dialog
    .getByLabel("Keep note files", { exact: true })
    .setInputFiles(fileURLToPath(new URL("../fixtures/notes-keep.json", import.meta.url)));
  await expect(dialog.getByRole("status")).toHaveText("1 note ready to import.");
  await dialog.getByRole("button", { name: "Import 1 note", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Imported 1 note.");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  // The mobile navigation sheet remains open behind the import dialog.
  await page.keyboard.press("Escape");
  await expect(card(page, "Keep packing list")).toBeVisible();
  await expect(
    card(page, "Keep packing list").getByRole("checkbox", { name: "Book", exact: true }),
  ).toBeChecked();
  await page.reload();
  await expect(card(page, "Keep packing list")).toBeVisible();
  const imported = await openNote(page, "Keep packing list");
  await expect(imported.getByRole("textbox", { name: "Note body", exact: true })).toContainText(
    "Pack for the coast",
  );
});
