// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/__docs-suggesting-reset", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Reset demo</title>" }),
  );
  await page.goto("/__docs-suggesting-reset");
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
  await page.unroute("**/__docs-suggesting-reset");
});

test("tracks typing and deletion, reviews changes, persists the result and returns to plain editing", async ({
  page,
}) => {
  await page.goto("/docs/new");
  await page.getByRole("textbox", { name: "Document title", exact: true }).fill("Suggesting plan");
  const body = page.getByRole("textbox", { name: "Document body", exact: true });
  await body.fill("Before word after");
  await expect(page).toHaveURL(/\/docs\/d\//);
  const review = page.getByRole("dialog", { name: "Review suggestion", exact: true });
  const mode = page.getByRole("combobox", { name: "Editing mode", exact: true });
  await mode.selectOption("suggesting");
  await body.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" added");
  const insertion = body.locator("ins[data-suggestion-id]");
  await expect(insertion).toHaveText(" added");
  const id = await insertion.getAttribute("data-suggestion-id");
  expect(id).toBeTruthy();
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
  await expect(review).toHaveCount(0);
  await page.keyboard.press("Backspace");
  const deletion = body.locator("del[data-suggestion-id]");
  await expect(deletion).toHaveText("word");
  await expect(body).toHaveText("Before word after added");
  // Suggestions themselves survive a reload through the shared document schema.
  await page.reload();
  await expect(insertion).toHaveText(" added");
  await expect(insertion).toHaveAttribute("data-suggestion-id", id as string);
  await expect(deletion).toHaveText("word");
  await insertion.click();
  await expect(review).toContainText("Suggested addition");
  await review.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(insertion).toHaveCount(0);
  await deletion.click();
  await expect(review).toContainText("Suggested deletion");
  await review.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(deletion).toHaveCount(0);
  await page.reload();
  await expect(body).toHaveText("Before word after added");
  await expect(body.locator("ins, del")).toHaveCount(0);
  // Mode is local to an open document and defaults to Editing on reopening.
  await expect(mode).toHaveValue("editing");
  await mode.selectOption("suggesting");
  await mode.selectOption("editing");
  await body.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" plain");
  await expect(body).toHaveText("Before word after added plain");
  await expect(body.locator("ins, del")).toHaveCount(0);
});

test("select-all replacement preserves the original as a deletion suggestion", async ({ page }) => {
  await page.goto("/docs/new");
  const body = page.getByRole("textbox", { name: "Document body", exact: true });
  await body.fill("Original first paragraph");
  await body.press("End");
  await body.press("Enter");
  await page.keyboard.type("Original second paragraph");
  await expect(page).toHaveURL(/\/docs\/d\//);
  await page
    .getByRole("combobox", { name: "Editing mode", exact: true })
    .selectOption("suggesting");
  await body.focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Replacement");
  await expect(body.locator("del[data-suggestion-id]")).toHaveText([
    "Original first paragraph",
    "Original second paragraph",
  ]);
  await expect(body.locator("ins[data-suggestion-id]")).toHaveText("Replacement");
  await expect(body).toContainText("Original first paragraph");
  await expect(body).toContainText("Original second paragraph");
  await page.reload();
  await expect(body.locator("ins[data-suggestion-id]")).toHaveText("Replacement");
  await expect(body.locator("del[data-suggestion-id]")).toHaveText([
    "Original first paragraph",
    "Original second paragraph",
  ]);
});

test("reviews a single suggestion by keyboard and returns focus with Escape", async ({ page }) => {
  await page.goto("/docs/new");
  const body = page.getByRole("textbox", { name: "Document body", exact: true });
  await body.fill("Original");
  await expect(page).toHaveURL(/\/docs\/d\//);
  await page
    .getByRole("combobox", { name: "Editing mode", exact: true })
    .selectOption("suggesting");
  await body.focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" addition");
  const review = page.getByRole("dialog", { name: "Review suggestion", exact: true });
  await page.keyboard.press("ControlOrMeta+Alt+Shift+A");
  await expect(review.getByRole("button", { name: "Accept", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(body).toBeFocused();
  await page.keyboard.press("ControlOrMeta+Alt+Shift+A");
  await expect(review.getByRole("button", { name: "Accept", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(body.locator("ins, del")).toHaveCount(0);
  await expect(body).toHaveText("Original addition");
  await expect(body).toBeFocused();
});
