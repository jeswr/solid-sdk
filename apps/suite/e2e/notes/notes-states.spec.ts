// AUTHORED-BY Codex GPT-6.1-Sol
import { encodeRef } from "../../src/lib/refs";
import {
  audit,
  capture,
  card,
  expect,
  navigate,
  openNote,
  test,
  trashNote,
} from "../fixtures/notes";

test("first-run, populated list and editor have no serious or critical axe violations", async ({
  page,
}) => {
  // playwright.config.ts runs this at 375, 768 and 1280 px in both themes.
  await page.goto("/notes");
  await expect(
    page.getByRole("heading", { name: "Notes you add appear here", exact: true }),
  ).toBeVisible();
  await audit(page, "first-run");
  await page.getByRole("button", { name: "Create a note", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Note text", exact: true })).toBeFocused();
  await page.getByRole("textbox", { name: "Note title", exact: true }).fill("First note");
  await page.getByRole("textbox", { name: "Note text", exact: true }).fill("A new idea");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(card(page, "First note")).toHaveAttribute("aria-busy", "false");
  await audit(page, "list");
  const dialog = await openNote(page, "First note");
  await audit(page, "editor");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
});

test("empty search and label results explain how to continue", async ({ page }) => {
  await page.goto("/notes");
  await capture(page, "Garden ideas", "Plant sunflowers");
  await page.getByRole("searchbox", { name: "Search notes", exact: true }).fill("no-such-note");
  await page.getByRole("searchbox", { name: "Search notes", exact: true }).press("Enter");
  await expect(page.getByRole("heading", { name: "No matching notes", exact: true })).toBeVisible();
  await audit(page, "empty-search");
  await page.getByRole("link", { name: "Back to Notes", exact: true }).click();
  await expect(card(page, "Garden ideas")).toBeVisible();
  await page.goto("/notes/label/Travel");
  await expect(
    page.getByRole("heading", { name: "No notes with this label", exact: true }),
  ).toBeVisible();
  await audit(page, "empty-label");
  await page.getByRole("button", { name: "Create a note", exact: true }).click();
  await page.getByRole("textbox", { name: "Note title", exact: true }).fill("Coast trip");
  await page.getByRole("textbox", { name: "Note text", exact: true }).fill("Bring a book");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    card(page, "Coast trip").getByRole("link", { name: "Travel", exact: true }),
  ).toBeVisible();
  await expect(card(page, "Garden ideas")).toHaveCount(0);
});

test("missing and malformed note references show a recoverable not-found state", async ({
  page,
}) => {
  for (const reference of [encodeRef("https://alice.demo.pod/notes/missing.ttl"), "invalid!"]) {
    await page.goto(`/notes/n/${reference}`);
    await expect(page.getByRole("heading", { name: "Note not found", exact: true })).toBeVisible();
    await expect(page.locator('[data-category="not-found"]')).toBeVisible();
    await expect(page).toHaveURL(`/notes/n/${reference}`);
    await audit(page, "not-found");
    await page.getByRole("link", { name: "Back to Notes", exact: true }).click();
    await expect(page).toHaveURL("/notes");
    await expect(page.getByRole("textbox", { name: "Take a note", exact: true })).toBeVisible();
  }
});

test("a failed list offers Retry and recovers the saved notes", async ({ page }) => {
  await page.goto("/notes");
  await capture(page, "Saved idea", "Keep this through a load error");
  await page.waitForFunction(() => !!window.__suiteDemoPod);
  await page.evaluate(() => {
    const pod = window.__suiteDemoPod;
    if (!pod) throw new Error("Demo pod fixture is unavailable");
    const fetch = pod.fetch;
    sessionStorage.setItem("notes-fail-list", "1");
    // Inject an HTTP failure at the demo transport; the real store and UI handle it.
    Object.defineProperty(pod, "fetch", {
      value: (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        if (
          new URL(url).pathname === "/notes/" &&
          sessionStorage.getItem("notes-fail-list") === "1"
        )
          return Promise.resolve(new Response(null, { status: 503 }));
        return fetch(input, init);
      },
    });
    const channel = new BroadcastChannel("solid-suite-demo-changes");
    channel.postMessage("https://alice.demo.pod/notes/");
    channel.close();
  });
  const error = page.locator('[data-category="unreachable"]');
  await expect(error).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Notes you add appear here", exact: true }),
  ).toHaveCount(0);
  await audit(page, "load-error");
  await page.evaluate(() => sessionStorage.removeItem("notes-fail-list"));
  await error.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(error).toBeHidden();
  await expect(card(page, "Saved idea")).toContainText("Keep this through a load error");
});

test("explains offline saving in the list and editor, and read-only access in Trash", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => sessionStorage.getItem("notes-offline") !== "1",
    });
  });
  await page.goto("/notes");
  await capture(page, "Offline idea", "Keep the saved text");
  await page.evaluate(() => {
    sessionStorage.setItem("notes-offline", "1");
    dispatchEvent(new Event("offline"));
  });
  const message = "You're offline. Reconnect to save changes to your pod.";
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  const dialog = await openNote(page, "Offline idea");
  await expect(dialog.getByText(message, { exact: true })).toBeVisible();
  await audit(page, "offline-editor");
  await page.evaluate(() => {
    sessionStorage.removeItem("notes-offline");
    dispatchEvent(new Event("online"));
  });
  await expect(dialog.getByText(message, { exact: true })).toBeHidden();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await trashNote(page, "Offline idea");
  await navigate(page, "Trash");
  const readOnly = await openNote(page, "Offline idea");
  await expect(
    readOnly.getByText("This note is read-only in Trash. Restore it to make changes.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(readOnly.getByRole("textbox", { name: "Note title", exact: true })).toHaveAttribute(
    "readonly",
    "",
  );
  await expect(readOnly.getByRole("textbox", { name: "Note body", exact: true })).toHaveAttribute(
    "contenteditable",
    "false",
  );
  await audit(page, "trash-editor");
  await readOnly.getByRole("button", { name: "Restore note", exact: true }).click();
  await expect(readOnly).toBeHidden();
  await navigate(page, "Notes");
  const editable = await openNote(page, "Offline idea");
  await expect(editable.getByRole("textbox", { name: "Note body", exact: true })).toHaveAttribute(
    "contenteditable",
    "true",
  );
});
