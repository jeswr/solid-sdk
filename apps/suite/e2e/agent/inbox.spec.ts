// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test } from "@playwright/test";
import { daemonDouble } from "./daemon-double";
import { agentScreenshot, openAgent } from "./helpers";

test("9: calendar cards carry deterministic provenance and HTML stays inert", async ({
  page,
}, info) => {
  await openAgent(page, "inbox/gmail");
  const tabs = page.getByRole("navigation", { name: "Message channels" });
  await expect(tabs.getByRole("link")).toHaveCount(2);
  await expect(tabs.getByRole("link", { name: "Matrix", exact: true })).toHaveCount(0);
  await expect(page.getByText("Meeting", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Calendar invitation", exact: true }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Calendar event", exact: true })).toBeVisible();
  await expect(sheet).toContainText("Project catch-up");
  await expect(sheet).toContainText("Meeting room");
  await expect(sheet).toContainText("Read from the message by the agent");
  await expect(sheet).toContainText("Deterministic extraction");
  await expect(sheet).toContainText("<b>This is plain text.</b>");
  await expect(sheet.locator("b,img,iframe,script")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Send/ })).toHaveCount(0);
  await agentScreenshot(page, info, "inbox-calendar");
  await sheet.getByRole("link", { name: "Ask the agent to reply", exact: true }).click();
  await expect(page).toHaveURL(/\/agent\/chat\?about=message-1$/);
  await expect(page.getByRole("textbox", { name: "Message your agent" })).toHaveValue(/message-1/);
});
test("archive stays on this device and never signs Forget", async ({ page }, info) => {
  await openAgent(page, "inbox/gmail");
  const daemon = daemonDouble(page);
  const controlsBefore = await daemon.client.list(daemon.client.paths.control);
  await page.getByRole("button", { name: "Calendar invitation", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("button", { name: "Calendar invitation", exact: true })).toHaveCount(
    0,
  );
  await page.reload();
  await expect(page.getByRole("button", { name: "Project catch-up", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Calendar invitation", exact: true })).toHaveCount(
    0,
  );
  expect(await daemon.client.list(daemon.client.paths.control)).toEqual(controlsBefore);
  await agentScreenshot(page, info, "inbox-archived");
});
