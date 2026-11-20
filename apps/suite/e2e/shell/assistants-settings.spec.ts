// AUTHORED-BY Codex GPT-6.1-Sol
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { seedDemoSession } from "../demo-session";

async function accessible(page: Page) {
  const report = await new AxeBuilder({ page }).analyze();
  expect(
    report.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
}
test.beforeEach(async ({ page }) => {
  await seedDemoSession(page);
  await page.clock.setFixedTime(new Date("2026-11-11T10:00:00Z"));
});
test("sets up Claude and ChatGPT and reads only audit metadata from the demo pod", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/settings/assistants");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Assistants");
  await expect(page.getByRole("textbox", { name: "Assistant server address" })).toHaveValue(
    "https://mcp.example/mcp",
  );
  await page.getByRole("button", { name: "Copy assistant server address" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("https://mcp.example/mcp");
  await expect(page.getByText("Turn it on from the tools menu in a chat.")).toBeVisible();
  const reads = page.getByRole("list", { name: "Sensitive data reads, newest first" });
  await expect(reads.getByRole("listitem")).toHaveCount(2);
  await expect(reads.getByRole("listitem").first()).toContainText("Demo assistant");
  await expect(reads).toContainText("Provide the service");
  await expect(reads).toContainText("Health");
  await expect(reads).not.toContainText("https://");
  await expect(page.getByText(/choose Disconnect under Connected assistants/)).toBeVisible();
  await expect(page.getByText(/MCP_ACCESS_TOKEN/)).toHaveCount(0);
  await accessible(page);
  await page.getByRole("tab", { name: "ChatGPT", exact: true }).click();
  await expect(page.getByRole("tabpanel")).toContainText("choose OAuth for authentication");
  await expect(page.getByRole("tabpanel")).toContainText("Developer mode needs a paid plan");
  await accessible(page);
  await context.setOffline(true);
  await expect(
    page.getByText("Reconnect to load sensitive data reads.", { exact: true }),
  ).toBeVisible();
  await expect(reads).toHaveCount(0);
  await accessible(page);
  await context.setOffline(false);
  await expect(reads.getByRole("listitem")).toHaveCount(2);
});

test("lists, disconnects and reloads an assistant connection in the demo pod", async ({ page }) => {
  await page.goto("/settings/assistants");
  const active = page.getByRole("list", { name: "Active assistants", exact: true });
  await expect(active.getByRole("listitem")).toHaveCount(2);
  await page.getByRole("button", { name: "Disconnect Demo assistant", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("heading")).toHaveText("Disconnect Demo assistant?");
  await accessible(page);
  await dialog.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(active.getByRole("listitem")).toHaveCount(1);
  const previous = page.getByRole("list", { name: "Previously connected assistants" });
  await expect(previous).toContainText("Demo assistant");
  await expect(previous).toContainText("Disconnected on 2026-11-11");
  await accessible(page);
  await page.reload();
  await expect(active.getByRole("listitem")).toHaveCount(1);
  await expect(previous).toContainText("Demo assistant");
});
