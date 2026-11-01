// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { encodeRef } from "../../src/lib/refs";

test.use({ locale: "en-GB" });
// As in Drive, reset IndexedDB before any application script opens it.
test.beforeEach(async ({ page }) => {
  await page.route("**/__tasks-test-reset", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Reset demo pod</title>",
    }),
  );
  await page.goto("/__tasks-test-reset");
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("solid-suite-demo");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Demo pod database deletion blocked"));
    });
  });
  await page.unroute("**/__tasks-test-reset");
});
async function sidebar(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) < 1024) {
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    return page
      .getByRole("dialog", { name: "Navigation", exact: true })
      .getByRole("navigation", { name: "Tasks", exact: true });
  }
  return page.getByRole("navigation", { name: "Tasks", exact: true });
}
async function accessible(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
  expect(await page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}
test("Tasks redirects to Inbox, adds a task, creates a project and section, and completes a task", async ({
  page,
}) => {
  await page.goto("/tasks");
  await expect(page).toHaveURL("/tasks/inbox");
  await expect(page.getByRole("heading", { level: 1, name: "Inbox", exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your Inbox is empty", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Inbox · Tasks · Solid Suite");
  await accessible(page);
  await page.keyboard.press("q");
  await page.getByRole("textbox", { name: "Task title", exact: true }).fill("Pay rent");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Task title", exact: true })).toHaveValue("");
  await expect(page.getByRole("textbox", { name: "Task title", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: "Pay rent", exact: true })).toBeVisible();
  const nav = await sidebar(page);
  await expect(nav.getByRole("link", { name: /Inbox/ })).toContainText("1");
  await nav.getByRole("button", { name: "New project", exact: true }).click();
  await nav.getByRole("textbox", { name: "New project name", exact: true }).fill("Home");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(
    `/tasks/p/${encodeRef("https://alice.demo.pod/tasks/projects/home.ttl")}`,
  );
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Home");
  await expect(page).toHaveTitle("Home · Tasks · Solid Suite");
  await page.getByRole("button", { name: "Add section", exact: true }).click();
  await page.getByRole("textbox", { name: "Section name", exact: true }).fill("Doing");
  await page.keyboard.press("Enter");
  const section = page.getByRole("region", { name: "Doing", exact: true });
  await expect(section).toBeVisible();
  await section.getByRole("button", { name: "Add task", exact: true }).click();
  const sectionInput = page.getByRole("textbox", { name: "Task title in section", exact: true });
  await sectionInput.fill("Clean kitchen");
  await expect(page.getByRole("button", { name: "Remove Doing", exact: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(sectionInput).toHaveValue("");
  await expect(page.getByRole("button", { name: "Remove Doing", exact: true })).toBeVisible();
  await sectionInput.press("Escape");
  await expect(section.getByRole("link", { name: "Clean kitchen", exact: true })).toBeVisible();
  const complete = section.getByRole("checkbox", { name: "Complete 'Clean kitchen'", exact: true });
  await expect(complete).toBeEnabled();
  await complete.click();
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Completed 'Clean kitchen'" }),
  ).toBeVisible();
  await expect(section.getByRole("link", { name: "Clean kitchen", exact: true })).toBeHidden();
  await accessible(page);
  await page.reload();
  await expect(page.getByRole("region", { name: "Doing", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Clean kitchen", exact: true })).toBeHidden();
});

test("view links resolve, invalid refs show a not-found state, and rows support roving keyboard focus", async ({
  page,
}) => {
  await page.goto("/tasks/inbox");
  await expect(
    page.getByRole("heading", { name: "Your Inbox is empty", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("q");
  const input = page.getByRole("textbox", { name: "Task title", exact: true });
  await input.fill("First");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await input.fill("Second");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await input.press("Escape");
  const rows = page.locator("li[data-tsk-row]");
  await expect(rows).toHaveCount(2);
  await rows.first().focus();
  await page.keyboard.press("j");
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press("k");
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\?task=/);
  for (const [view, empty] of [
    ["today", "Nothing due today"],
    ["completed", "Nothing completed yet"],
    ["l/bills", "No tasks with @bills"],
  ] as const) {
    await page.goto(`/tasks/${view}`);
    await expect(page.getByRole("heading", { name: empty, exact: true })).toBeVisible();
  }
  await page.goto("/tasks/upcoming");
  await expect(
    page.getByRole("heading", { level: 1, name: "Upcoming", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".tsk-day-cell")).toHaveCount(7);
  await page.goto("/tasks/p/invalid!");
  await expect(page.locator('[data-category="not-found"]')).toBeVisible();
});
