// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test } from "@playwright/test";
import { signInDemo } from "./fixtures";

test("a text file can be edited, saved conditionally and reopened after reload", async ({
  page,
}) => {
  await signInDemo(page);
  const name = `editable-${crypto.randomUUID()}.txt`;
  const edited = "Saved from Drive's text editor.\nA second line.";
  await page.getByTestId("drive-upload-input").setInputFiles({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from("Original text"),
  });
  const row = page.locator("tr[data-url]").filter({ has: page.getByText(name, { exact: true }) });
  await expect(row).toBeVisible();
  await row.focus();
  await page.keyboard.press("Enter");
  const preview = page.getByRole("dialog", { name, exact: true });
  await preview.getByRole("button", { name: "Edit", exact: true }).click();
  const textarea = preview.getByRole("textbox", { name: `Edit ${name}`, exact: true });
  await expect(textarea).toBeFocused();
  await textarea.fill(edited);
  await preview.getByRole("button", { name: "Save", exact: true }).click();
  await expect(preview.locator(".drv-preview-text")).toHaveText(edited);
  await expect(preview.getByRole("button", { name: "Edit", exact: true })).toBeFocused();
  await page.reload();
  await expect(row).toBeVisible();
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(preview.locator(".drv-preview-text")).toHaveText(edited);
});
