// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test } from "@playwright/test";

test("demo Docs inserts a contact and a file chip, persists and opens the file", async ({
  page,
}) => {
  await page.goto("/docs/new");
  const title = page.getByRole("textbox", { name: "Document title", exact: true });
  await title.fill("Smart chip demo");
  await title.press("Enter");
  const body = page.getByRole("textbox", { name: "Document body", exact: true });
  await body.pressSequentially("@");
  const picker = page.getByRole("combobox", { name: "Mention a person or resource" });
  await expect(picker).toBeFocused();
  await picker.fill("Bob");
  await page.getByRole("option", { name: /Bob Meadow/ }).click();
  await expect(body.locator('a[data-chip-kind="person"]')).toHaveText("Bob Meadow");
  await body.press("End");
  await body.pressSequentially(" @");
  await picker.fill("Report");
  await expect(page.getByRole("option", { name: /Report\.pdf/ })).toBeVisible();
  await picker.press("Enter");
  const file = body.locator('a[data-chip-kind="file"]');
  await expect(file).toHaveText("Report.pdf");
  await expect(page).toHaveURL(/\/docs\/d\//);
  await body.press("ControlOrMeta+s");
  await expect(
    page.getByRole("status").filter({ hasText: "Saved to your pod · just now" }),
  ).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(body.locator('a[data-chip-kind="person"]')).toHaveText("Bob Meadow");
  await expect(file).toHaveText("Report.pdf");
  await file.focus();
  await expect(page.getByRole("link", { name: "Open Report.pdf", exact: true })).toBeVisible();
  await file.click();
  await expect(page).toHaveURL(/\/drive\/p\//);
});

test("demo Chat composer inserts and sends a resource chip", async ({ page }) => {
  await page.goto("/chat/new");
  await page.getByRole("textbox", { name: "Room name", exact: true }).fill("Chip chat");
  await page.getByRole("button", { name: "Create room", exact: true }).click();
  const message = page.getByRole("textbox", { name: "Message", exact: true });
  await message.fill("Look at @");
  const picker = page.getByRole("combobox", { name: "Mention a person or resource" });
  await picker.fill("Report");
  await page.getByRole("option", { name: /Report\.pdf/ }).click();
  await expect(message).toHaveValue(/chip:file/);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator('.chat-message-text a[data-chip-kind="file"]').last()).toHaveText(
    "Report.pdf",
  );
});
