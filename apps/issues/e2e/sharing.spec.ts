/**
 * Cross-pod e2e: Alice shares her tracker with Bob; Bob — in a separate browser
 * context, logged in as himself — opens Alice's tracker by her WebID (resolved via
 * her public type index) and sees the issue she filed. Exercises the milestone-2
 * sharing (WAC) + type-index discovery paths against real local CSS.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { createCssAccount } from "./css-account";

const CSS_BASE = process.env.IT_CSS_BASE ?? "http://localhost:3000";

function handleLoginPopups(context: BrowserContext, email: string, password: string): void {
  const seen = (locator: ReturnType<Page["locator"]>, timeout: number) =>
    locator.waitFor({ state: "visible", timeout }).then(() => true, () => false);
  context.on("page", async (popup: Page) => {
    try {
      const field = popup.locator("#email");
      if (await seen(field, 10_000)) {
        await field.fill(email);
        await popup.locator("#password").fill(password);
        await popup.getByRole("button", { name: /^log in$/i }).click();
      }
      const consent = popup.getByRole("button", { name: /authorize|consent|allow|continue/i });
      if (await seen(consent, 10_000)) await consent.click();
    } catch {
      /* transient prompt=none popup */
    }
  });
}

async function signIn(page: Page, webId: string) {
  await page.goto("/");
  await page.getByLabel(/your webid/i).fill(webId);
  await page.getByRole("button", { name: /sign in/i }).click();
  // The issues view header always shows "Open tracker" once signed in.
  await expect(page.getByRole("button", { name: /open tracker/i })).toBeVisible({ timeout: 30_000 });
}

test("Alice shares with Bob; Bob opens Alice's tracker and sees the issue", async ({ browser }) => {
  test.setTimeout(180_000);
  const stamp = `${Date.now()}`;
  const alice = await createCssAccount({ base: CSS_BASE, pod: `alice${stamp}` });
  const bob = await createCssAccount({ base: CSS_BASE, pod: `bob${stamp}` });
  const title = `Shared task ${Math.random().toString(36).slice(2, 8)}`;

  // --- Alice: log in, file an issue, share the tracker with Bob (edit) ---
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

  // --- Bob: separate context, log in as himself, open Alice's tracker ---
  const bobCtx = await browser.newContext();
  handleLoginPopups(bobCtx, bob.email, bob.password);
  const bPage = await bobCtx.newPage();
  await signIn(bPage, bob.webId);

  await bPage.getByRole("button", { name: /open tracker/i }).click();
  const openDialog = bPage.getByRole("dialog");
  await openDialog.getByLabel(/their webid/i).fill(alice.webId);
  await openDialog.getByRole("button", { name: /open tracker/i }).click();

  // Bob sees Alice's issue and a banner that he's viewing her tracker.
  await expect(bPage.getByRole("heading", { name: title })).toBeVisible({ timeout: 30_000 });
  await expect(bPage.getByText(/viewing/i)).toBeVisible();

  await aliceCtx.close();
  await bobCtx.close();
});
