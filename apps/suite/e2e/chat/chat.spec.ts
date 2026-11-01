// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo, test } from "@playwright/test";

const BOB = "https://bob.example.org/profile/card#me";
test.use({ locale: "en" });
test.beforeEach(async ({ page }) => {
  await page.route("**/__chat-test-reset", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Reset Chat demo</title>",
    }),
  );
  await page.goto("/__chat-test-reset");
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
  await page.unroute("**/__chat-test-reset");
  // Observe clipboard writes without requiring a platform clipboard in CI.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          sessionStorage.setItem("chat-test-clipboard", text);
        },
      },
    });
  });
});
async function accessible(page: Page) {
  await expect(page).toHaveTitle("Chat · Solid Suite");
  // Radix animates the closing portal; wait for its content to leave the DOM
  // before scanning the full page (keep every axe rule enabled).
  await expect(page.locator("[data-radix-popper-content-wrapper]")).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function capture(page: Page, info: TestInfo, view: string) {
  await page.evaluate(() => document.fonts.ready);
  const directory = fileURLToPath(
    new URL("../../../../artifacts/playwright/chat/", import.meta.url),
  );
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${info.project.name}-${view}.png`, fullPage: true });
}
async function newConversation(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) < 1024)
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  const navigation =
    (page.viewportSize()?.width ?? 1280) < 1024
      ? page.getByRole("dialog", { name: "Navigation", exact: true })
      : page.getByRole("navigation", { name: "Conversations", exact: true });
  await navigation.getByRole("link", { name: "New room", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "New conversation", exact: true })).toBeVisible();
}
async function createRoom(page: Page, name = "Book club") {
  await page.goto("/chat/new");
  await page.getByRole("textbox", { name: "Room name", exact: true }).fill(name);
  await page.getByRole("button", { name: "Create room", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "New conversation", exact: true })).toBeHidden();
  await expect(page.getByRole("heading", { name, level: 1, exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeEnabled();
}
async function send(page: Page, text: string) {
  const composer = page.getByRole("textbox", { name: "Message", exact: true });
  await composer.fill(text);
  await composer.press("Enter");
  const article = page.getByRole("article").filter({ hasText: text });
  await expect(article).toBeVisible();
  await expect(article.getByText("Sending…", { exact: true })).toBeHidden();
  return article;
}
test("empty state and the new room dialog are accessible", async ({ page }, info) => {
  await page.goto("/chat");
  await expect(
    page.getByRole("main").getByText("No conversations yet", { exact: true }),
  ).toBeVisible();
  await accessible(page);
  await capture(page, info, "empty");
  await page.getByRole("main").getByRole("link", { name: "Start a room", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "New conversation", exact: true })).toBeVisible();
  await accessible(page);
  await capture(page, info, "new");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL("/chat");
});
test("create, append, edit, tombstone, turn into task, live sync and keyboard navigation", async ({
  page,
  context,
}, info) => {
  await createRoom(page);
  const roomUrl = page.url();
  const first = await send(page, "First message");
  const second = await send(page, "Second message");
  await expect(page.getByRole("article")).toHaveCount(2);
  await first.hover();
  await first.getByRole("button", { name: "Message actions" }).click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Edit message", exact: true });
  await editor.fill("First edited");
  await editor.press("Enter");
  await expect(page.getByRole("article").filter({ hasText: "First edited" })).toContainText(
    "edited",
  );
  await second.hover();
  await second.getByRole("button", { name: "Message actions" }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete message", exact: true })
    .click();
  await expect(page.getByRole("article").filter({ hasText: "Message deleted" })).toBeVisible();
  const edited = page.getByRole("article").filter({ hasText: "First edited" });
  await edited.hover();
  await edited.getByRole("button", { name: "Message actions" }).click();
  await page.getByRole("menuitem", { name: "Turn into task", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Task title", exact: true })).toHaveValue(
    "First edited",
  );
  await page.getByLabel("Due date (optional)", { exact: true }).fill("2026-12-01");
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(edited).toContainText("Task: First edited");
  const other = await context.newPage();
  await other.goto(roomUrl);
  await send(other, "Hello from a second page");
  await page.bringToFront();
  await expect(
    page.getByRole("article").filter({ hasText: "Hello from a second page" }),
  ).toBeVisible();
  await other.close();
  const log = page.getByRole("log", { name: "Messages", exact: true });
  await log.focus();
  await page.keyboard.press("Home");
  await expect(page.getByRole("article").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("article").nth(1)).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("article").last()).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Edit", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await accessible(page);
  await capture(page, info, "room");
  await log.focus();
  await page.keyboard.press("]");
  await expect(
    page.getByRole("heading", { name: "Conversation details", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Members", exact: true })).toBeVisible();
  await capture(page, info, "details");
  await page.getByRole("button", { name: "Close details", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("article").filter({ hasText: "First edited" })).toBeVisible();
});
test("creates and reopens a DM and copies an invitation", async ({ page }) => {
  await createRoom(page);
  await newConversation(page);
  await page.getByRole("tab", { name: "Direct message", exact: true }).click();
  await page.getByRole("combobox", { name: "Add people", exact: true }).fill(BOB);
  await page.getByRole("button", { name: "Add person", exact: true }).click();
  await page.getByRole("button", { name: "Start direct message", exact: true }).click();
  await page.getByRole("button", { name: "Copy invite link", exact: true }).click();
  const link = await page.evaluate(() => sessionStorage.getItem("chat-test-clipboard"));
  expect(link).toMatch(/\/chat\/r\//);
  await page.getByRole("button", { name: "Open conversation", exact: true }).click();
  await expect(page).toHaveURL(link as string);
  const dmUrl = page.url();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "bob.example.org/profile/card#me",
  );
  await newConversation(page);
  await page.getByRole("tab", { name: "Direct message", exact: true }).click();
  await page.getByRole("combobox", { name: "Add people", exact: true }).fill(BOB);
  await page.getByRole("button", { name: "Add person", exact: true }).click();
  await page.getByRole("button", { name: "Start direct message", exact: true }).click();
  await expect(page).toHaveURL(dmUrl);
  await page.getByRole("button", { name: "Copy invite link", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem("chat-test-clipboard")))
    .toBe(dmUrl);
});
test("keeps offline sends queued and supports multiline text and the edit shortcut", async ({
  page,
  context,
}) => {
  await createRoom(page, "Offline room");
  await context.setOffline(true);
  const composer = page.getByRole("textbox", { name: "Message", exact: true });
  await composer.fill("Queued message");
  await composer.press("Enter");
  const queued = page.getByRole("article").filter({ hasText: "Queued message" });
  await expect(queued).toContainText("Sending…");
  await context.setOffline(false);
  await expect(queued.getByText("Sending…", { exact: true })).toBeHidden();
  await composer.press("ArrowUp");
  const edit = page.getByRole("textbox", { name: "Edit message", exact: true });
  await expect(edit).toHaveValue("Queued message");
  await edit.press("Escape");
  await composer.fill("Line one");
  await composer.press("Shift+Enter");
  await composer.press("L");
  await expect(composer).toHaveValue("Line one\nL");
});
