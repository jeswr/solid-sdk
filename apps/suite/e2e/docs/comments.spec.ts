// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/__docs-comments-reset", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Reset demo</title>" }),
  );
  await page.goto("/__docs-comments-reset");
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("solid-suite-demo");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Demo database deletion blocked"));
    });
  });
  await page.unroute("**/__docs-comments-reset");
});

test("anchors, replies, resolves, reopens and persists a comment after editing before its text", async ({
  page,
}) => {
  await page.goto("/docs/new");
  await page.getByRole("textbox", { name: "Document title", exact: true }).fill("Comment plan");
  const body = page.getByRole("textbox", { name: "Document body", exact: true });
  await body.fill("Before word after");
  await expect(page).toHaveURL(/\/docs\/d\//);
  await body.focus();
  await body.evaluate((element) => {
    const text = element.querySelector("p")?.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 7);
    range.setEnd(text, 11);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect(page.getByRole("button", { name: "Add comment", exact: true })).toHaveAttribute(
    "aria-disabled",
    "false",
  );
  await page.keyboard.press("Control+Alt+m");
  const panel = page.getByRole("complementary", { name: "Comments", exact: true });
  await panel.getByRole("textbox", { name: "Add comment", exact: true }).fill("Check this word");
  await panel.getByRole("button", { name: "Comment", exact: true }).click();
  const highlight = body.locator(".docs-comment-anchor");
  await expect(highlight).toHaveText("word");
  const thread = panel.getByRole("article");
  await expect(thread).toContainText("Check this word");
  await expect(thread.locator("header span[title]")).toHaveText("You");
  await thread.getByRole("button", { name: "Reply to thread", exact: true }).click();
  await thread.getByRole("textbox", { name: "Reply", exact: true }).fill("Agreed");
  await thread.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(thread).toContainText("Agreed");
  // The reply left "word" selected: typing before the caret reaches the start
  // would replace it, so retry until the caret is collapsed at the start.
  await expect(async () => {
    await body.focus();
    await page.keyboard.press("Control+Home");
    expect(
      await body.evaluate(() => {
        const selection = window.getSelection();
        return !!selection?.isCollapsed && selection.anchorOffset === 0;
      }),
    ).toBe(true);
  }).toPass();
  // A second "word" before the anchor: the highlight must stay on the original one.
  await page.keyboard.type("A word first. ");
  await expect(highlight).toHaveCount(1);
  await expect(highlight).toHaveText("word");
  expect(
    await highlight.evaluate((element) => {
      const range = document.createRange();
      range.setStart(element.closest("p") as Node, 0);
      range.setEndBefore(element);
      return range.toString();
    }),
  ).toBe("A word first. Before ");
  await highlight.click();
  await expect(thread).toBeFocused();
  await thread.getByRole("button", { name: "Resolve", exact: true }).click();
  await expect(thread).toHaveCount(0);
  await expect(highlight).toHaveCount(0);
  await panel.getByRole("checkbox", { name: "Show resolved", exact: true }).check();
  await expect(thread).toContainText("Resolved");
  await thread.getByRole("button", { name: "Comment options", exact: true }).first().click();
  await thread.getByRole("button", { name: "Reopen", exact: true }).click();
  await expect(thread.getByText("Resolved", { exact: true })).toHaveCount(0);
  await expect(highlight).toHaveText("word");
  await expect(page.getByRole("button", { name: "Comments (1 open)", exact: true })).toBeVisible();
  await page.reload();
  await expect(body).toContainText("A word first. Before word after");
  await expect(highlight).toHaveText("word");
  await page.getByRole("button", { name: "Comments (1 open)", exact: true }).click();
  await expect(panel.getByRole("article")).toContainText("Check this word");
  await expect(panel.getByRole("article")).toContainText("Agreed");
});
