// AUTHORED-BY Codex GPT-6
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import type { DemoPodSnapshot } from "../../src/lib/demo-pod/pod";

const root = "https://alice.demo.pod/";

async function ready(page: Page, route: string) {
  await page.goto(route);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("status", { name: "Loading your data", exact: true })).toBeHidden();
  await expect(page.getByRole("status", { name: "Loading item", exact: true })).toBeHidden();
}
async function accessible(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
}
/** Read the durable demo pod, including the actual conditional-write validators. */
async function resource(page: Page, url: string) {
  return page.evaluate(async (url) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("solid-suite-demo", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const stored = await new Promise<{ snapshot: DemoPodSnapshot }>((resolve, reject) => {
        const request = db.transaction("pods").objectStore("pods").get("https://alice.demo.pod/");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const found = stored.snapshot.resources.find(([key]) => key === url)?.[1];
      return found
        ? {
            body: new TextDecoder().decode(found.body),
            etag: found.etag,
            contentType: found.contentType,
          }
        : null;
    } finally {
      db.close();
    }
  }, url);
}

test("scenario 3: contact detail, saved name, and a concurrent demo pod write", async ({
  page,
  context,
}) => {
  await ready(page, "/home/socials");
  await page.getByRole("link", { name: "Pax Orchard", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Pax Orchard" })).toBeVisible();
  await expect(page.getByText("legacy0@example.org", { exact: true })).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText(/http|WebID|ACL|RDF|container|Type Index/);
  await accessible(page);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Name (required)", { exact: true }).fill("Pax Meadow");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pax Meadow");
  await page.getByRole("link", { name: "Socials", exact: true }).click();
  await expect(page.getByRole("link", { name: "Pax Meadow", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Pax Meadow", exact: true }).click();
  await expect(page).toHaveURL(/\/home\/socials\/i\//);
  await expect(page.getByRole("heading", { level: 1, name: "Pax Meadow" })).toBeVisible();
  const route = page.url();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Name (required)", { exact: true }).fill("My Pax");
  // Another page writes through the same demo pod's conditional HTTP surface.
  const other = await context.newPage();
  await ready(other, route);
  await other.getByRole("button", { name: "Edit", exact: true }).click();
  await other.getByLabel("Email", { exact: true }).fill("new@example.org");
  await other.getByRole("button", { name: "Save", exact: true }).click();
  await expect(other.getByText("new@example.org", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const conflict = page.getByRole("dialog", { name: "This item changed since you opened it" });
  await expect(conflict).toBeVisible();
  await accessible(page);
  await conflict.getByRole("button", { name: "Keep my changes", exact: true }).click();
  await expect(conflict).toBeHidden();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("My Pax");
  // Keeping only changed fields also keeps the other editor's changed email.
  await expect(page.getByText("new@example.org", { exact: true })).toBeVisible();
  await other.close();
  await accessible(page);
});

test("scenario 4: delete a bookmark, keyboard Undo, then commit after eight seconds", async ({
  page,
}) => {
  await ready(page, "/home/documents");
  const bookmarkUrl = `${root}bookmarks/design.ttl`;
  const original = await resource(page, bookmarkUrl);
  expect(original).not.toBeNull();
  await page.getByRole("link", { name: "Design inspiration", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Design inspiration" })).toBeVisible();
  await page.getByRole("button", { name: "More item actions" }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL("/home/documents");
  await expect(page.getByText("Deleted Design inspiration", { exact: true })).toBeVisible();
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await undo.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("link", { name: "Design inspiration", exact: true })).toBeVisible();
  expect(await resource(page, bookmarkUrl)).toMatchObject({
    body: original?.body,
    contentType: original?.contentType,
  });
  expect((await resource(page, bookmarkUrl))?.etag).not.toBe(original?.etag);
  await accessible(page);
  await page.clock.install();
  // Exercise the same shared delete action from the card menu on the second attempt.
  await page
    .getByRole("button", { name: "More actions for Design inspiration", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("link", { name: "Design inspiration", exact: true })).toBeHidden();
  await expect(page.getByText("Deleted Design inspiration", { exact: true })).toBeVisible();
  // Advancing the browser clock runs the delayed DELETE without a fixed wall-clock sleep.
  await page.clock.runFor(9_000);
  await expect.poll(() => resource(page, bookmarkUrl)).toBeNull();
  await expect(page.getByRole("link", { name: "Design inspiration", exact: true })).toBeHidden();
  await accessible(page);
});

test("HM-05: add an Address, discover its card and register its data type", async ({ page }) => {
  await ready(page, "/home");
  const add = page.getByRole("button", { name: "Add manually", exact: true }).first();
  await add.focus();
  await page.keyboard.press("a");
  const sheet = page.getByRole("dialog", { name: "Add manually", exact: true });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel("Data type", { exact: true })).toHaveValue("address");
  await sheet.getByLabel("Name (required)", { exact: true }).fill("Home address");
  await sheet.getByLabel("Street address", { exact: true }).fill("12 River Lane");
  await sheet.getByLabel("Locality", { exact: true }).fill("London");
  await sheet.getByLabel("Postal code", { exact: true }).fill("N1 1AA");
  await sheet.getByLabel("Country", { exact: true }).fill("United Kingdom");
  await sheet.getByRole("button", { name: "Close", exact: true }).focus();
  await page.keyboard.press("Tab");
  expect(await sheet.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await accessible(page);
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(add).toBeFocused();
  await expect(page.getByRole("link", { name: "Home address", exact: true })).toBeVisible();
  const index = await resource(page, `${root}settings/privateTypeIndex.ttl`);
  expect(index?.body).toContain("http://www.w3.org/2006/vcard/ns#Address");
  expect(index?.body).toContain(`${root}personal/`);
  await expect(page.getByRole("main")).not.toContainText(/http|WebID|ACL|RDF|container|Type Index/);
  await accessible(page);
});

test("focused card and detail shortcuts open item-filtered access management", async ({ page }) => {
  await ready(page, "/home/socials");
  const card = page.getByRole("link", { name: "Tess Harbor", exact: true });
  const route = await card.getAttribute("href");
  await card.focus();
  await page.keyboard.press(".");
  await expect(page).toHaveURL(/\/permissions\?item=/);
  await ready(page, route as string);
  await page.keyboard.press(".");
  await expect(page).toHaveURL(/\/permissions\?item=/);
});
