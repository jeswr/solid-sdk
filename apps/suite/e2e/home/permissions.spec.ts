// AUTHORED-BY Codex GPT-6
// Run all six configured viewport/theme projects with SUITE_E2E_PORT=3313.
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { encodeRef } from "../../src/lib/refs";

const ROOT = "https://alice.demo.pod/";
const BOB = "https://bob.demo.pod/profile/card#me";
const APP = "https://maracoach.example/";

test.use({ locale: "en" });
test.beforeEach(async ({ page }) => {
  await page.route("**/__permissions-reset", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Reset permissions</title>",
    }),
  );
  await page.goto("/__permissions-reset");
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("solid-suite-demo");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Demo storage still open"));
    });
  });
  await page.unroute("**/__permissions-reset");
  // Names in this fixture intentionally use host fallbacks. No foreign network is required.
  await page.route("https://bob.demo.pod/**", (route) => route.abort());
  await page.route("https://maracoach.example/**", (route) => route.abort());
});

function card(page: Page, id: string) {
  return page
    .locator(".hm-permission-card")
    .filter({ has: page.locator(`article[aria-label="Access for ${id}"]`) });
}
function bobCard(page: Page) {
  return card(page, "bob.demo.pod");
}
async function open(page: Page) {
  await page.goto("/permissions");
  await expect(
    page.getByRole("heading", { level: 1, name: "Permissions", exact: true }),
  ).toBeVisible();
  await expect(bobCard(page)).toBeVisible();
}
async function accessible(page: Page) {
  const report = await new AxeBuilder({ page }).analyze();
  expect(
    report.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
}
// Inspect the same durable demo pod used by the page, rather than issuing a real HTTP GET.
async function podDocument(page: Page, url: string) {
  return page.evaluate(
    async ({ root, url }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("solid-suite-demo", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const stored = await new Promise<{
          snapshot: { resources: [string, { body: Uint8Array }][] };
        }>((resolve, reject) => {
          const request = db.transaction("pods").objectStore("pods").get(root);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const resource = stored.snapshot.resources.find(([id]) => id === url)?.[1];
        return resource ? new TextDecoder().decode(resource.body) : null;
      } finally {
        db.close();
      }
    },
    { root: ROOT, url },
  );
}

test("People: keyboard toggle, inherited confirmation, saved policy and Undo; Make private", async ({
  page,
}) => {
  await open(page);
  const cards = page.locator(".hm-permission-card");
  await expect(
    cards.first().getByRole("link", { name: "Anyone with the link", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Permissions", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Requests", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Requests", exact: true })).toHaveCount(0);
  const bob = bobCard(page);
  const header = bob.locator(".su-permission-trigger");
  await header.focus();
  await page.keyboard.press("Enter");
  await expect(header).toHaveAttribute("aria-expanded", "true");
  await expect(
    bob.locator(".hm-permission-lines").getByText("Can see", { exact: true }),
  ).toBeVisible();
  await expect(bob.getByText("Inherited from Work", { exact: true })).toBeVisible();
  const toggle = bob.getByRole("switch", { name: "Files for bob.demo.pod", exact: true });
  await toggle.focus();
  await page.keyboard.press("Space");
  const confirm = page.getByRole("alertdialog", {
    name: "This changes access for everything in Work",
    exact: true,
  });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Remove access", exact: true }).focus();
  await page.keyboard.press("Enter");
  // The save keeps the switch focusable (aria-disabled), so focus returns to it.
  await expect(toggle).toBeFocused();
  await expect(toggle).not.toBeChecked();
  await expect(bob.getByRole("status")).toContainText(
    "bob.demo.pod will lose access to your Files",
  );
  await expect.poll(() => podDocument(page, `${ROOT}drive/Work/.acl`)).not.toContain(BOB);
  await expect
    .poll(() => podDocument(page, `${ROOT}drive/Work/.acl`))
    .toContain(`${ROOT}profile/card#me`);
  await accessible(page);
  await bob.getByRole("button", { name: "Undo", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toBeChecked();
  // Undo removes its own button; focus stays on the line's switch, not the page body.
  await expect(toggle).toBeFocused();
  await expect.poll(() => podDocument(page, `${ROOT}drive/Work/.acl`)).toContain(BOB);
  await header.press("Space");
  await expect(header).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Space");
  await expect(header).toHaveAttribute("aria-expanded", "true");
  const publicCard = card(page, "Anyone with the link");
  await publicCard.getByRole("button", { name: "Make private", exact: true }).focus();
  await page.keyboard.press("Enter");
  const removePublic = page.getByRole("alertdialog", {
    name: "Make private?",
    exact: true,
  });
  await expect(removePublic).toContainText("Remove all public and signed-in access");
  await removePublic.getByRole("button", { name: "Remove access", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(publicCard).toHaveCount(0);
  await expect(card(page, "Anyone signed in")).toHaveCount(0);
  await expect
    .poll(() => podDocument(page, `${ROOT}drive/Photos/sunset.png.acl`))
    .not.toContain("http://xmlns.com/foaf/0.1/Agent");
  await accessible(page);
});

test("Apps: Advanced modes, relative path, gated grant link, saved view and data-type search", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("tab", { name: "Apps", exact: true }).click();
  const app = card(page, "maracoach.example");
  await app.locator(".su-permission-trigger").click();
  await expect(app).toContainText("Personalise the service");
  await page.getByRole("radio", { name: "Advanced", exact: true }).click();
  await expect(app.getByText("Read", { exact: true })).toBeVisible();
  await expect(app.getByText("Change", { exact: true })).toBeVisible();
  await expect(app.locator("code")).toHaveText(["health/"]);
  const grant = app.getByRole("button", { name: "View grant", exact: true });
  await expect(grant).toBeDisabled();
  await app
    .getByRole("group", { name: "Enable technical details in Settings", exact: true })
    .focus();
  await expect(page.getByRole("tooltip")).toContainText("Enable technical details in Settings");
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Search permissions", exact: true }).fill("activity");
  await expect(app).toBeVisible();
  await page.getByRole("textbox", { name: "Search permissions", exact: true }).fill("no such app");
  await expect(page.getByText("No results for 'no such app'", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await accessible(page);
  await page.reload();
  await expect(page.getByRole("radio", { name: "Advanced", exact: true })).toBeChecked();
  await page.getByRole("tab", { name: "Apps", exact: true }).click();
  await app.locator(".su-permission-trigger").click();
  await expect(grant).toBeDisabled();
});

test("Revoke all and r shortcut list data types and remove all former lines", async ({ page }) => {
  await open(page);
  const bob = bobCard(page);
  await bob.locator(".su-permission-trigger").focus();
  await page.keyboard.press("r");
  const confirm = page.getByRole("alertdialog", {
    name: "Remove all access for bob.demo.pod?",
    exact: true,
  });
  await expect(confirm).toContainText(
    "bob.demo.pod will no longer be able to see or change Files. You can share again later.",
  );
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(bob.locator(".su-permission-trigger")).toBeFocused();
  await bob.getByRole("button", { name: "Revoke all", exact: true }).click();
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Remove access", exact: true }).click();
  await expect(bob).toHaveCount(0);
  await expect.poll(() => podDocument(page, `${ROOT}drive/Work/.acl`)).not.toContain(BOB);
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "bob.demo.pod no longer has access" }),
  ).toBeVisible();
  await accessible(page);
  await page.reload();
  await expect(card(page, "Anyone with the link")).toBeVisible();
  await expect(bob).toHaveCount(0);
});

test("row names deep-link to person and pseudo-agent detail; unknown accounts are empty", async ({
  page,
}) => {
  await open(page);
  await bobCard(page).getByRole("link", { name: "bob.demo.pod", exact: true }).click();
  await expect(page).toHaveURL(`/permissions/a/${encodeRef(BOB)}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "bob.demo.pod", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Account ID", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy Account ID", exact: true })).toBeVisible();
  await expect(page.getByRole("switch")).toBeVisible();
  await expect(page.getByText(/^First shared /)).toBeVisible();
  await expect(page.getByText(/^Last changed /)).toBeVisible();
  await accessible(page);
  await page.goto("/permissions/a/public");
  await expect(
    page.getByRole("heading", { level: 1, name: "Anyone with the link", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Make private", exact: true })).toBeVisible();
  await accessible(page);
  await page.goto(`/permissions/a/${encodeRef("https://unknown.example/card#me")}`);
  await expect(page.getByText("No access found for this account", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to permissions", exact: true })).toBeVisible();
});

test("an origin-only app is named by its host and its origin is never fetched", async ({
  page,
}) => {
  // acl:origin values are not Client ID Documents; only ids with a path are fetched.
  const requests: string[] = [];
  await page.unroute("https://maracoach.example/**");
  await page.route("https://maracoach.example/**", (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  await page.goto(`/permissions/a/${encodeRef(APP)}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "maracoach.example", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("This app hasn't provided any details.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Show logo", exact: true })).toHaveCount(0);
  expect(requests).toEqual([]);
  await accessible(page);
});

test("offline permissions stay visible and disable changes with a reconnect explanation", async ({
  page,
  context,
}) => {
  await open(page);
  const bob = bobCard(page);
  await bob.locator(".su-permission-trigger").click();
  await context.setOffline(true);
  await expect(
    page.getByText("Showing saved copies. Reconnect to change access.", { exact: true }),
  ).toBeVisible();
  await expect(bob.getByRole("switch")).toBeDisabled();
  await expect(bob.getByRole("button", { name: "Revoke all", exact: true })).toBeDisabled();
  await bob
    .locator(".hm-permission-line")
    .getByRole("group", { name: "Reconnect to change access", exact: true })
    .focus();
  await expect(page.getByRole("tooltip")).toContainText("Reconnect to change access");
  await accessible(page);
  await context.setOffline(false);
  await expect(bob.getByRole("switch")).toBeEnabled();
});
