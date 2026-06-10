/**
 * Milestone-3 e2e: priority + labels on an issue, and the comments thread — all
 * persisted to per-issue documents in a real local CSS pod.
 */
import { test, expect } from "@playwright/test";
import { createCssAccount, type CssAccount } from "./css-account";
import { CSS_BASE, dismissToasts, handleLoginPopups, signIn } from "./helpers";

test.describe("Advanced issue features", () => {
  let account: CssAccount;

  test.beforeEach(async ({ context, page }, testInfo) => {
    account = await createCssAccount({ base: CSS_BASE, pod: `m3-${testInfo.workerIndex}-${Date.now()}` });
    handleLoginPopups(context, account.email, account.password);
    await signIn(page, account.webId);
  });

  test("creates an issue with a priority and a label", async ({ page }) => {
    const title = `Priority issue ${Math.random().toString(36).slice(2, 8)}`;
    await page.getByRole("button", { name: /new issue/i }).first().click();

    await page.getByLabel(/^title$/i).fill(title);
    await page.locator("#priority").click();
    await page.getByRole("option", { name: "High" }).click();
    await page.getByLabel(/labels/i).fill("bug");
    await page.getByRole("button", { name: /create issue/i }).click();

    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("high", { exact: true })).toBeVisible();
    await expect(page.getByText("bug", { exact: true })).toBeVisible();
  });

  test("searches issues and switches to the board view", async ({ page }) => {
    for (const title of ["Alpha login bug", "Beta dark mode"]) {
      await page.getByRole("button", { name: /new issue/i }).first().click();
      await page.getByLabel(/^title$/i).fill(title);
      await page.getByRole("button", { name: /create issue/i }).click();
      await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });
    }

    // Search narrows the list.
    await page.getByLabel(/search issues/i).fill("Alpha");
    await expect(page.getByRole("heading", { name: "Alpha login bug" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Beta dark mode" })).toBeHidden();

    // Clear, switch to the board view — status columns render (To Do / In Progress / Done).
    await page.getByLabel(/search issues/i).fill("");
    await page.getByRole("tab", { name: "Board view", exact: true }).click();
    await expect(page.getByRole("region", { name: /to do/i })).toBeVisible();
    await expect(page.getByRole("region", { name: /in progress/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Alpha login bug" })).toBeVisible();

    // Switch grouping to priority.
    await page.getByLabel(/group by/i).click();
    await page.getByRole("option", { name: /priority/i }).click();
    await expect(page.getByRole("region", { name: /no priority/i })).toBeVisible();
  });

  test("keyboard shortcut opens new issue; command palette switches view", async ({ page }) => {
    await page.keyboard.press("c");
    await expect(page.getByRole("dialog").getByLabel(/^title$/i)).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /command palette/i }).click();
    await expect(page.getByPlaceholder(/type a command/i)).toBeVisible();
    await page.getByRole("option", { name: /board view/i }).click();
    await expect(page.getByRole("tab", { name: "Board view", exact: true })).toHaveAttribute("aria-selected", "true");
  });

  test("saves a view and re-applies it", async ({ page }) => {
    await page.getByLabel(/search issues/i).fill("zzq-unique");
    await page.getByRole("button", { name: /views/i }).click();
    await page.getByRole("menuitem", { name: /save current view/i }).click();
    await page.getByLabel(/view name/i).fill("My saved search");
    await page.getByRole("button", { name: /save view/i }).click();

    await page.getByLabel(/search issues/i).fill("");
    await page.getByRole("button", { name: /views/i }).click();
    await page.getByRole("menuitem", { name: /my saved search/i }).click();
    await expect(page.getByLabel(/search issues/i)).toHaveValue("zzq-unique");
  });

  test("changes an issue's status via the edit form", async ({ page }) => {
    const title = `Status flow ${Math.random().toString(36).slice(2, 6)}`;
    await page.getByRole("button", { name: /new issue/i }).first().click();
    await page.getByLabel(/^title$/i).fill(title);
    await page.getByRole("button", { name: /create issue/i }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });

    // Edit → set status In Progress.
    await page.getByRole("button", { name: new RegExp(`actions for ${title}`, "i") }).click();
    await page.getByRole("menuitem", { name: /edit/i }).click();
    await page.locator("#status").click();
    await page.getByRole("option", { name: /in progress/i }).click();
    await page.getByRole("button", { name: /save changes/i }).click();

    await expect(page.getByText(/in progress/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test("bulk-closes selected issues", async ({ page }) => {
    const titles = [`Bulk one ${Math.random().toString(36).slice(2, 6)}`, `Bulk two ${Math.random().toString(36).slice(2, 6)}`];
    for (const title of titles) {
      await page.getByRole("button", { name: /new issue/i }).first().click();
      await page.getByLabel(/^title$/i).fill(title);
      await page.getByRole("button", { name: /create issue/i }).click();
      await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });
    }

    await page.getByLabel(/select all issues/i).click();
    await expect(page.getByText(/2 selected/i)).toBeVisible();
    await page.getByRole("button", { name: /^close$/i }).click();
    await expect(page.getByText(/2 selected/i)).toBeHidden({ timeout: 20_000 }); // bulk op done, selection cleared

    // Both are now closed — confirm under the Closed filter.
    await page.getByRole("tab", { name: /closed/i }).click();
    for (const title of titles) await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });
  });

  test("epics: create an epic, add a child from the epic view, see progress roll up", async ({ page }) => {
    // Create an epic via the form's Type select.
    await page.getByRole("button", { name: /new issue/i }).first().click();
    await page.getByLabel(/^title$/i).fill("Login overhaul");
    await page.locator("#issueType").click();
    await page.getByRole("option", { name: /^epic$/i }).click();
    await page.getByRole("button", { name: /create issue/i }).click();
    await expect(page.getByRole("heading", { name: "Login overhaul" })).toBeVisible({ timeout: 15_000 });

    // Switch to the Epics view and add a child issue to the epic.
    await page.getByRole("tab", { name: /epics view/i }).click();
    await expect(page.getByText(/0\/0 done/)).toBeVisible();
    await page.getByRole("button", { name: /add issue/i }).click();
    await page.getByLabel(/^title$/i).fill("Fix popup flow");
    await page.getByRole("button", { name: /create issue/i }).click();

    // Child appears under the epic; progress shows 0/1.
    await expect(page.getByText(/0\/1 done/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Fix popup flow" })).toBeVisible();

    // Complete the child via its detail → Edit → status Done; progress hits 100%.
    await page.getByRole("button", { name: "Fix popup flow" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /edit/i }).click();
    await page.locator("#status").click();
    await page.getByRole("option", { name: /done/i }).click();
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByText(/1\/1 done · 100%/)).toBeVisible({ timeout: 15_000 });
  });

  test("backlog: create sprint, move an issue in, start and complete it", async ({ page }) => {
    // An estimated story for the backlog.
    await page.getByRole("button", { name: /new issue/i }).first().click();
    await page.getByLabel(/^title$/i).fill("Estimated story");
    await page.getByLabel(/story points/i).fill("3");
    await page.getByRole("button", { name: /create issue/i }).click();
    await expect(page.getByRole("heading", { name: "Estimated story" })).toBeVisible({ timeout: 15_000 });

    await page.getByRole("tab", { name: "Backlog view" }).click();
    await expect(page.getByText(/1 issues · 3 pts/)).toBeVisible({ timeout: 15_000 });

    // Create a sprint and move the story into it via the row menu.
    await page.getByLabel(/new sprint name/i).fill("Sprint 1");
    await page.getByRole("button", { name: /create sprint/i }).click();
    await expect(page.getByRole("heading", { name: "Sprint 1" })).toBeVisible({ timeout: 15_000 });

    await dismissToasts(page); // the "Sprint created" toast overlays the row menus
    await page.getByRole("button", { name: /move estimated story/i }).click();
    await page.getByRole("menuitem", { name: "Sprint 1" }).click();
    await expect(page.getByText(/0\/1 done · 3 pts/)).toBeVisible({ timeout: 15_000 });

    // Start, then complete the sprint.
    await page.getByRole("button", { name: /start sprint/i }).click();
    await expect(page.getByText("Active", { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /^complete$/i }).click();
    await expect(page.getByText(/completed sprints \(1\)/i)).toBeVisible({ timeout: 15_000 });
  });

  test("dashboard shows stat cards and charts", async ({ page }) => {
    await page.getByRole("button", { name: /new issue/i }).first().click();
    await page.getByLabel(/^title$/i).fill("Chart fodder");
    await page.locator("#priority").click();
    await page.getByRole("option", { name: "High" }).click();
    await page.getByRole("button", { name: /create issue/i }).click();
    await expect(page.getByRole("heading", { name: "Chart fodder" })).toBeVisible({ timeout: 15_000 });

    await page.getByRole("tab", { name: /dashboard view/i }).click();
    const dash = page.getByTestId("dashboard");
    await expect(dash.getByText("To Do", { exact: true })).toBeVisible();
    await expect(dash.getByText("Overdue", { exact: true })).toBeVisible();
    await expect(dash.getByText(/status distribution/i)).toBeVisible();
    await expect(dash.getByText(/open workload/i)).toBeVisible();
  });

  test("team members render as contact cards with profile names", async ({ page }) => {
    await page.getByRole("button", { name: /^team$/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/member webid/i).fill(account.webId);
    await dialog.getByRole("button", { name: /^add$/i }).click();
    // The member card shows the profile's display name (seeded by css-account), not just the IRI.
    await expect(dialog.getByText(/^Test /)).toBeVisible({ timeout: 15_000 });
  });

  test("links a parent and a blocker between issues", async ({ page }) => {
    for (const title of ["Parent task", "Blocker task", "Child task"]) {
      await page.getByRole("button", { name: /new issue/i }).first().click();
      await page.getByLabel(/^title$/i).fill(title);
      await page.getByRole("button", { name: /create issue/i }).click();
      await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });
    }

    // Open the child's detail via its card title.
    await page.getByRole("button", { name: "Child task", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Set parent.
    await dialog.getByLabel(/parent issue/i).click();
    await page.getByRole("option", { name: "Parent task" }).click();
    // Add a blocker (the parent itself is correctly excluded from candidates).
    await dialog.getByLabel(/add blocker/i).click();
    await page.getByRole("option", { name: "Blocker task" }).click();

    // Blocked-by list now shows the blocker (and the parent select reflects it).
    await expect(dialog.getByRole("button", { name: /remove blocker/i })).toBeVisible({ timeout: 15_000 });
  });

  test("attaches a file to an issue", async ({ page }) => {
    await page.getByRole("button", { name: /new issue/i }).first().click();
    await page.getByLabel(/^title$/i).fill("Has attachment");
    await page.getByRole("button", { name: /create issue/i }).click();
    await expect(page.getByRole("heading", { name: "Has attachment" })).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Has attachment", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[type="file"]').setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello pod"),
    });
    await expect(dialog.getByText("notes.txt")).toBeVisible({ timeout: 20_000 });
  });

  test("adds a comment to an issue and it persists", async ({ page }) => {
    const title = `Discuss ${Math.random().toString(36).slice(2, 8)}`;
    await page.getByRole("button", { name: /new issue/i }).first().click();
    await page.getByLabel(/^title$/i).fill(title);
    await page.getByRole("button", { name: /create issue/i }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: new RegExp(`actions for ${title}`, "i") }).click();
    await page.getByRole("menuitem", { name: /comments/i }).click();

    const comment = `Looking into it ${Math.random().toString(36).slice(2, 6)}`;
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/add a comment/i).fill(comment);
    await dialog.getByRole("button", { name: /^comment$/i }).click();

    // The thread re-renders from a fresh pod read after posting (the hook re-fetches
    // CSS), so seeing the comment here proves it persisted to the issue document.
    await expect(dialog.getByText(comment)).toBeVisible({ timeout: 15_000 });
  });
});
