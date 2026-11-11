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
  const reads = page.getByRole("list", { name: "Personal data reads, newest first" });
  await expect(reads.getByRole("listitem")).toHaveCount(2);
  await expect(reads.getByRole("listitem").first()).toContainText(
    "An assistant registered with mcp.example",
  );
  await expect(reads).toContainText("Provide the service");
  await expect(reads).toContainText("Health");
  await expect(reads).not.toContainText("https://");
  await expect(page.getByText(/rotating MCP_ACCESS_TOKEN/)).toBeVisible();
  await accessible(page);
  await page.getByRole("tab", { name: "ChatGPT", exact: true }).click();
  await expect(page.getByRole("tabpanel")).toContainText("choose OAuth for authentication");
  await expect(page.getByRole("tabpanel")).toContainText("Developer mode needs a paid plan");
  await accessible(page);
  await context.setOffline(true);
  await expect(
    page.getByText("Reconnect to load personal data reads.", { exact: true }),
  ).toBeVisible();
  await expect(reads).toHaveCount(0);
  await accessible(page);
  await context.setOffline(false);
  await expect(reads.getByRole("listitem")).toHaveCount(2);
});
