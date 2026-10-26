// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { CSS_BASE, handleLoginPopups, signIn } from "./helpers";
import { seededAccounts } from "./seeded-accounts";

const WEBSOCKET_CHANNEL_TYPE = "http://www.w3.org/ns/solid/notifications#WebSocketChannel2023";

test("moves an issue on the open board through WebSocketChannel2023 without reload", async ({ browser, context, page }) => {
  test.setTimeout(180_000);
  const { alice } = seededAccounts();
  const editorContext = await browser.newContext();
  try {
    handleLoginPopups(editorContext, alice.email, alice.password);
    const editor = await editorContext.newPage();
    await signIn(editor, alice.webId);

    const title = `Live board ${randomUUID()}`;
    await editor.getByRole("button", { name: /new issue/i }).first().click();
    await editor.getByLabel(/^title$/i).fill(title);
    const created = editor.waitForResponse((response) =>
      response.status() !== 401 &&
      response.request().method() === "PUT" &&
      response.url().startsWith(alice.podRoot) &&
      /\/issues\/[^/]+\.ttl$/.test(response.url()),
    );
    await editor.getByRole("button", { name: /create issue/i }).click();
    const saved = await created;
    expect(saved.ok()).toBe(true);
    const issueUrl = saved.url();
    const containerUrl = new URL(".", issueUrl).href;
    await expect(editor.getByRole("heading", { name: title })).toBeVisible();

    // Observe the app's real subscription and socket; no route or WebSocket mocks.
    const subscribed = page.waitForResponse((response) => {
      const request = response.request();
      if (response.status() === 401 || request.method() !== "POST" || !request.headers()["content-type"]?.includes("application/ld+json")) return false;
      const body = request.postDataJSON();
      return body?.type === WEBSOCKET_CHANNEL_TYPE && body?.topic === containerUrl;
    });
    const connected = page.waitForEvent("websocket");
    handleLoginPopups(context, alice.email, alice.password);
    await signIn(page, alice.webId);
    const subscription = await subscribed;
    expect(subscription.ok()).toBe(true);
    expect(new URL(subscription.url()).origin).toBe(CSS_BASE);
    const channel = await subscription.json() as { receiveFrom: string };
    const socket = await connected;
    // receiveFrom can contain a capability token: compare without printing it.
    expect(socket.url() === channel.receiveFrom).toBe(true);
    await page.getByRole("tab", { name: "Board view", exact: true }).click();
    const todo = page.getByRole("region", { name: /^to do \(/i });
    const inProgress = page.getByRole("region", { name: /^in progress \(/i });
    await expect(todo.getByRole("heading", { name: title })).toBeVisible();
    await expect(inProgress.getByRole("heading", { name: title })).toHaveCount(0);

    let navigations = 0;
    page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations++; });
    await editor.getByRole("button", { name: `Actions for ${title}`, exact: true }).click();
    await editor.getByRole("menuitem", { name: /edit/i }).click();
    await editor.locator("#status").click();
    await editor.getByRole("option", { name: "In Progress", exact: true }).click();
    const notified = socket.waitForEvent("framereceived", {
      timeout: 10_000,
      predicate: ({ payload }) => {
        try {
          const event = JSON.parse(payload.toString()) as { object?: string | { id?: string } };
          const resource = typeof event.object === "string" ? event.object : event.object?.id;
          return resource === issueUrl || resource === containerUrl;
        } catch { return false; }
      },
    });
    const updated = editor.waitForResponse((response) =>
      response.status() !== 401 && response.url() === issueUrl && response.request().method() === "PUT",
    );
    await editor.getByRole("button", { name: /save changes/i }).click();
    expect((await updated).ok()).toBe(true);
    await notified;
    // The polling fallback runs every 25s; require the socket-driven update in 10s.
    await expect(inProgress.getByRole("heading", { name: title })).toBeVisible({ timeout: 10_000 });
    await expect(todo.getByRole("heading", { name: title })).toHaveCount(0);
    expect(navigations).toBe(0);
  } finally {
    await editorContext.close();
  }
});
