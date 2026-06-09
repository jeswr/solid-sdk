/**
 * Cross-pod e2e: Alice shares her tracker with Bob; Bob — in a separate browser
 * context, logged in as himself — opens Alice's tracker by her WebID and sees the
 * issue she filed. Exercises milestone-2 container sharing (WAC, acl:default
 * cascade) + type-index discovery against real local CSS.
 */
import { test, expect } from "@playwright/test";
import { createCssAccount } from "./css-account";
import { CSS_BASE, handleLoginPopups, signIn } from "./helpers";

test("live-sync: a new issue appears in another open session", async ({ browser }) => {
  test.setTimeout(120_000);
  const alice = await createCssAccount({ base: CSS_BASE, pod: `ls${Date.now()}` });

  const ctxA = await browser.newContext();
  handleLoginPopups(ctxA, alice.email, alice.password);
  const a = await ctxA.newPage();
  await signIn(a, alice.webId);

  const ctxB = await browser.newContext();
  handleLoginPopups(ctxB, alice.email, alice.password);
  const b = await ctxB.newPage();
  await signIn(b, alice.webId);

  const title = `Live ${Math.random().toString(36).slice(2, 6)}`;
  await a.getByRole("button", { name: /new issue/i }).first().click();
  await a.getByLabel(/^title$/i).fill(title);
  await a.getByRole("button", { name: /create issue/i }).click();
  await expect(a.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });

  // B did nothing — live-sync (WebSocket, or the polling fallback) should surface it.
  await expect(b.getByRole("heading", { name: title })).toBeVisible({ timeout: 30_000 });

  await ctxA.close();
  await ctxB.close();
});

test("Alice shares with Bob; Bob opens Alice's tracker and sees the issue", async ({ browser }) => {
  test.setTimeout(180_000);
  const stamp = `${Date.now()}`;
  const alice = await createCssAccount({ base: CSS_BASE, pod: `alice${stamp}` });
  const bob = await createCssAccount({ base: CSS_BASE, pod: `bob${stamp}` });
  const title = `Shared task ${Math.random().toString(36).slice(2, 8)}`;

  // Alice: file an issue, share the tracker with Bob.
  const aliceCtx = await browser.newContext();
  handleLoginPopups(aliceCtx, alice.email, alice.password);
  const aPage = await aliceCtx.newPage();
  await signIn(aPage, alice.webId);

  await aPage.getByRole("button", { name: /new issue/i }).first().click();
  await aPage.getByLabel(/^title$/i).fill(title);
  await aPage.getByRole("button", { name: /create issue/i }).click();
  await expect(aPage.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });

  await aPage.getByRole("button", { name: /^share$/i }).click();
  const shareDialog = aPage.getByRole("dialog");
  await shareDialog.getByLabel(/webid to share with/i).fill(bob.webId);
  await shareDialog.getByRole("button", { name: /^share$/i }).click();
  await expect(shareDialog.getByText(bob.webId)).toBeVisible({ timeout: 15_000 });
  await aPage.keyboard.press("Escape");

  // Bob: separate context, open Alice's tracker.
  const bobCtx = await browser.newContext();
  handleLoginPopups(bobCtx, bob.email, bob.password);
  const bPage = await bobCtx.newPage();
  await signIn(bPage, bob.webId);

  await bPage.getByRole("button", { name: /open tracker/i }).click();
  const openDialog = bPage.getByRole("dialog");
  await openDialog.getByLabel(/their webid/i).fill(alice.webId);
  await openDialog.getByRole("button", { name: /open tracker/i }).click();

  await expect(bPage.getByRole("heading", { name: title })).toBeVisible({ timeout: 30_000 });
  await expect(bPage.getByText(/viewing/i)).toBeVisible();

  await aliceCtx.close();
  await bobCtx.close();
});
