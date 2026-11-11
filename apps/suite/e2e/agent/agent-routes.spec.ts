// AUTHORED-BY Codex GPT-6.1-Sol
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const routes = [
  ["", "Chat", "Plan my week"],
  ["chat", "Chat", "Plan my week"],
  ["chat/c/welcome", "Chat", "I've prepared a reply for your approval."],
  ["approvals", "Approvals", "Project catch-up"],
  ["approvals/send-reply", "Approval details", "Tomorrow at 14:00 works for me."],
  ["approvals/remember-preference", "Approval details", "Remember: I prefer afternoon meetings."],
  ["approvals/prohibited-send", "Approval details", "Never"],
  ["permissions", "Permissions", "Current permission"],
  ["permissions/history", "Permission history", "Previous permission record"],
  ["accounts", "Accounts", "Personal Gmail"],
  ["accounts/gmail", "Account details", "Personal Gmail"],
  ["inbox", "Inbox", "Gmail"],
  ["inbox/gmail", "Inbox", "Calendar invitation"],
  ["inbox/graph-mail", "Inbox", "Welcome to the team"],
  ["activity", "Activity", "Sent email to"],
  ["activity/11", "Activity record 11", "Sent email to"],
  ["settings", "Settings", "Agent running"],
] as const;

for (const [route, heading, item] of routes) {
  test(`${route || "root"} reads seeded records and is accessible`, async ({ page }, info) => {
    await page.goto(`/agent/${route}`);
    await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
    await expect(page.getByText(item).filter({ visible: true }).first()).toBeVisible();
    await expect(page).toHaveTitle(/Agent/);
    if (route === "approvals/send-reply") {
      await expect(page.locator("pre")).toHaveText(
        "Subject: Re: Project catch-up\nTo: My own account\n\nThanks for the invitation. Tomorrow at 14:00 works for me.\n\n— Alice",
      );
      await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeEnabled();
      await expect(page.getByRole("button", { name: "Deny", exact: true })).toBeEnabled();
      await expect(
        page.getByRole("button", { name: "Approve and allow similar for 7 days", exact: true }),
      ).toBeEnabled();
    }
    if (route === "chat/c/welcome") {
      await expect(page.getByRole("textbox", { name: "Message your agent" })).toBeEnabled();
      await expect(page.getByRole("link", { name: /Review proposal/ })).toBeVisible();
    }
    if (route === "inbox/gmail") {
      await page.getByRole("button", { name: "Calendar invitation", exact: true }).click();
      const detail = page.getByRole("dialog");
      await expect(detail).toContainText("<b>This is plain text.</b>");
      await expect(detail.locator("b")).toHaveCount(0);
      await expect(
        detail.getByRole("heading", { name: "Calendar event", exact: true }),
      ).toBeVisible();
      await expect(detail).toContainText("Read from the message by the agent");
    }
    const result = await new AxeBuilder({ page }).analyze();
    expect(
      result.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
    ).toEqual([]);
    await page.evaluate(() => document.fonts.ready);
    const directory = fileURLToPath(
      new URL("../../../../artifacts/playwright/agent/", import.meta.url),
    );
    await mkdir(directory, { recursive: true });
    await page.screenshot({
      path: `${directory}/${route.replaceAll("/", "-") || "root"}-${info.project.name}.png`,
      fullPage: true,
    });
  });
}
