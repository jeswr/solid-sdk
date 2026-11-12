// AUTHORED-BY Codex GPT-6.1-Sol
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import type { DemoPodSnapshot } from "../../src/lib/demo-pod/pod";

const rows = (page: Page) => page.locator("[data-collection-item]");
const row = (page: Page, name: string) => page.getByRole("row", { name, exact: true });
async function open(page: Page, fixture = "") {
  await page.goto(`/contacts${fixture ? `?seed=${fixture}` : ""}`);
  await expect(page.getByRole("heading", { name: "All contacts", exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "Loading contacts" })).toBeHidden();
}
async function navigation(page: Page, name: RegExp) {
  if ((page.viewportSize()?.width ?? 1280) < 1024) {
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Navigation", exact: true })
      .getByRole("link", { name })
      .click();
    await expect(page.getByRole("dialog", { name: "Navigation", exact: true })).toBeHidden();
  } else
    await page
      .getByRole("complementary", { name: "Contacts navigation", exact: true })
      .getByRole("link", { name })
      .click();
}
async function accessible(page: Page) {
  await expect(page).toHaveTitle("Contacts · Solid Suite");
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
}
async function search(page: Page, query: string) {
  const input = page.getByRole("searchbox", { name: "Search Contacts", exact: true });
  await input.fill(query);
  await input.press("Enter");
}

// Arrange interrupted setup in the durable demo pod, then reload through the real discovery path.
async function removePrivateIndex(page: Page) {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("solid-suite-demo", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("pods", "readwrite");
        const store = tx.objectStore("pods");
        const request = store.get("https://alice.demo.pod/");
        request.onsuccess = () => {
          const saved = request.result as { revision: string; snapshot: DemoPodSnapshot };
          saved.snapshot = {
            ...saved.snapshot,
            resources: saved.snapshot.resources.filter(
              ([url]) => !url.endsWith("/settings/privateTypeIndex.ttl"),
            ),
          };
          saved.revision = crypto.randomUUID();
          store.put(saved, "https://alice.demo.pod/");
        };
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  });
  await page.reload();
}

test("200 contacts are virtualised, scroll to the last contact, and open/close by keyboard", async ({
  page,
}) => {
  await open(page, "contacts-200");
  await expect(page.locator(".con-list-heading").getByRole("status")).toHaveText("200 contacts");
  expect(await rows(page).count()).toBeLessThan(200);
  const viewport = page.locator(".suite-table-viewport");
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(row(page, "Zora Example 160")).toBeVisible();
  await viewport.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(row(page, "Ada Fern")).toBeVisible();
  await page.locator("#main-content").focus();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    if (await row(page, "Ada Fern").evaluate((element) => element === document.activeElement))
      break;
  }
  await expect(row(page, "Ada Fern")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(row(page, "Amir Vale")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Amir Vale", exact: true })).toBeVisible();
  await accessible(page);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/contacts(?:\?|$)/);
  await expect(row(page, "Amir Vale")).toBeFocused();
  await accessible(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("labels filter the current list and search highlights matching text", async ({ page }) => {
  await open(page);
  await navigation(page, /^Family/);
  await expect(page.getByRole("heading", { name: "Family", exact: true })).toBeVisible();
  await expect(page.locator(".con-list-heading").getByRole("status")).toHaveText("14 contacts");
  await search(page, "Mira");
  await expect(page.locator(".con-list-heading").getByRole("status")).toHaveText(
    "1 contacts matching “Mira”",
  );
  await expect(row(page, "Mira Quill").locator("mark").first()).toHaveText("Mira");
  await row(page, "Mira Quill").press("Enter");
  await expect(page.getByRole("heading", { name: "Mira Quill", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Family", exact: true })).toBeVisible();
  await search(page, "doesnotexist987");
  await expect(page.getByRole("heading", { name: "No matches", exact: true })).toBeVisible();
  await accessible(page);
});

test("an unknown label shows a not-found state with a link back to All contacts", async ({
  page,
}) => {
  await open(page);
  await page.goto("/contacts/label/unknown");
  await expect(page.getByRole("heading", { name: "Label not found", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No matches", exact: true })).toBeHidden();
  await accessible(page);
  await page.locator(".con-list").getByRole("link", { name: "All contacts", exact: true }).click();
  await expect(page.getByRole("heading", { name: "All contacts", exact: true })).toBeVisible();
  await expect(page.locator(".con-list-heading").getByRole("status")).toHaveText("40 contacts");
});

test("Labels consumes Escape for suggestions, then details closes and restores the row", async ({
  page,
}) => {
  await open(page);
  await row(page, "Amir Vale").press("Enter");
  const detail = page.getByRole("region", { name: "Contact details", exact: true });
  const labels = detail.getByRole("combobox", { name: "Labels", exact: true });
  await labels.focus();
  await expect(labels).toHaveAttribute("aria-expanded", "true");
  await labels.press("Escape");
  await expect(labels).toHaveAttribute("aria-expanded", "false");
  await expect(detail).toBeVisible();
  await expect(labels).toBeFocused();
  await labels.press("Escape");
  await expect(detail).toBeHidden();
  await expect(row(page, "Amir Vale")).toBeFocused();
});

test("rows use plain names, formatted phones, and unclipped stars with one mobile letter", async ({
  page,
}) => {
  await open(page);
  const amir = row(page, "Amir Vale");
  await expect(amir.locator(".con-name")).toHaveJSProperty("tagName", "SPAN");
  await expect(amir.locator(".con-name")).toHaveCSS("font-weight", "500");
  await expect(amir.locator("td").nth(3)).toHaveText("+1 202 555 0101");
  if ((page.viewportSize()?.width ?? 1280) === 375) {
    await expect(page.locator(".con-sticky-letter")).toHaveText("A");
    await expect(row(page, "Ada Fern").locator(".con-section-letter")).toBeHidden();
    for (const name of ["Ada Fern", "Amir Vale"]) {
      const contact = row(page, name);
      const star = contact.getByRole("button", { name: `Star ${name}`, exact: true });
      await expect(star).toBeInViewport({ ratio: 1 });
      const [starBox, rowBox] = await Promise.all([star.boundingBox(), contact.boundingBox()]);
      if (!starBox || !rowBox) throw new Error("Missing contact row or star");
      expect(starBox.x + starBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
    }
    expect(
      await page
        .locator(".suite-table-viewport")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
  }
  await amir.locator(".con-name").click();
  await expect(page.getByRole("heading", { name: "Amir Vale", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to contacts", exact: true }).click();
  await expect(amir).toBeFocused();
});

test("the sidebar New contact uses a visible suite button in both themes", async ({ page }) => {
  await open(page);
  const narrow = (page.viewportSize()?.width ?? 1280) < 1024;
  if (narrow) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  const sidebar = narrow
    ? page.getByRole("dialog", { name: "Navigation", exact: true })
    : page.getByRole("complementary", { name: "Contacts navigation", exact: true });
  const create = sidebar.getByRole("link", { name: "New contact", exact: true });
  await expect(create).toBeVisible();
  await expect(create).toHaveAttribute("data-variant", "outline");
  // Axe checks text contrast while the responsive navigation surface is actually visible.
  await accessible(page);
  await create.click();
  await expect(page.getByRole("textbox", { name: "Full name", exact: true })).toBeVisible();
});

test("starring persists across navigation and reload for this WebID", async ({ page }) => {
  await open(page);
  await row(page, "Ada Fern").getByRole("button", { name: "Star Ada Fern", exact: true }).click();
  await navigation(page, /^Starred/);
  await expect(row(page, "Ada Fern")).toBeVisible();
  await expect(page.locator(".con-list-heading").getByRole("status")).toHaveText("1 contacts");
  await page.reload();
  await expect(
    row(page, "Ada Fern").getByRole("button", { name: "Star Ada Fern", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await row(page, "Ada Fern").getByRole("button", { name: "Star Ada Fern", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No matches", exact: true })).toBeVisible();
  await accessible(page);
});

test("delete then Undo restores a contact and its label memberships", async ({ page }) => {
  await open(page);
  await row(page, "Ada Fern").press("Enter");
  const detail = page.getByRole("region", { name: "Contact details", exact: true });
  await expect(detail.getByRole("heading", { name: "Ada Fern" })).toBeVisible();
  await expect(detail.getByRole("link", { name: /^Email Ada Fern/ })).toHaveAttribute(
    "href",
    "mailto:ada.fern@example.org",
  );
  await detail.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete contact", exact: true })
    .click();
  await expect(page.locator(".con-list-heading").getByRole("status")).toHaveText("39 contacts");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(row(page, "Ada Fern")).toBeVisible();
  await expect(row(page, "Ada Fern")).toContainText("Family");
  await navigation(page, /^Family/);
  await expect(row(page, "Ada Fern")).toBeVisible();
});

test("PM contacts move into the address book and the dismissible banner disappears", async ({
  page,
}) => {
  await open(page);
  const banner = page.getByRole("region", { name: "Pod Manager contacts", exact: true });
  await expect(banner).toContainText("2 contacts from Pod Manager");
  await banner.getByRole("button", { name: "Move them", exact: true }).click();
  await expect(banner).toBeHidden({ timeout: 30000 });
  await expect(page.locator(".con-list-heading").getByRole("status")).toHaveText("42 contacts");
  await search(page, "Pax Orchard");
  await expect(row(page, "Pax Orchard")).toBeVisible();
  await page.reload();
  await expect(banner).toBeHidden();
});

test("missing and empty address books offer clear actions and working creation/import routes", async ({
  page,
}) => {
  await open(page, "contacts-no-book");
  await expect(
    page.getByRole("heading", { name: "Create your address book", exact: true }),
  ).toBeVisible();
  await accessible(page);
  await page.getByRole("button", { name: "Create address book", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No contacts yet", exact: true })).toBeVisible();
  await accessible(page);
  await page.locator("main").getByRole("link", { name: "New contact", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Full name", exact: true })).toBeVisible();
  await page.goto("/contacts/import");
  await expect(page.getByRole("heading", { name: "Choose a source", exact: true })).toBeVisible();
});

test("an existing book exposes registration retry when the private Type Index is missing", async ({
  page,
}) => {
  await open(page);
  await removePrivateIndex(page);
  const registration = page.getByRole("region", { name: "Address book registration", exact: true });
  await expect(registration).toBeVisible();
  await expect(row(page, "Ada Fern")).toBeVisible();
  await registration.getByRole("button", { name: "Retry registration", exact: true }).click();
  await expect(registration).toBeHidden();
  await page.reload();
  await expect(row(page, "Ada Fern")).toBeVisible();
  await expect(page.locator(".con-list-heading").getByRole("status")).toHaveText("40 contacts");
  await expect(registration).toBeHidden();
});

test("first-use creation bootstraps a missing private Type Index", async ({ page }) => {
  await open(page, "contacts-no-book");
  await expect(
    page.getByRole("button", { name: "Create address book", exact: true }),
  ).toBeVisible();
  await removePrivateIndex(page);
  await page.getByRole("button", { name: "Create address book", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No contacts yet", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry registration", exact: true })).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", { name: "No contacts yet", exact: true })).toBeVisible();
  await accessible(page);
});

test("external WebIDs stay links and label edits persist", async ({ page }) => {
  await open(page);
  const external: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("bob.demo.pod")) external.push(request.url());
  });
  await row(page, "Bob Meadow").press("Enter");
  const detail = page.getByRole("region", { name: "Contact details", exact: true });
  await expect(
    detail.getByRole("link", { name: "Open Solid profile", exact: true }),
  ).toHaveAttribute("href", "https://bob.demo.pod/profile/card#me");
  expect(external).toEqual([]);
  await detail.getByRole("combobox", { name: "Labels", exact: true }).click();
  await detail.getByRole("option", { name: "Work", exact: true }).click();
  await expect(detail.getByRole("button", { name: "Remove Work", exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "Remove Family", exact: true }).click();
  await expect(detail.getByRole("button", { name: "Remove Family", exact: true })).toBeHidden();
  await expect(page.locator(".con-save")).toHaveText("");
  await page.reload();
  await expect(detail.getByRole("button", { name: "Remove Work", exact: true })).toBeVisible();
  await detail.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Full name", exact: true })).toBeVisible();
});

// Next 16.2 seeded a reloaded static page's plain-path router cache entry with the queried URL,
// so a later link to /contacts came back filtered. Next 16.4 keys that entry by the real search.
test("All contacts clears a reloaded search after visiting duplicates", async ({ page }) => {
  const count = page.locator(".con-list-heading").getByRole("status");
  await open(page);
  await search(page, "Ada Fern");
  await expect(count).toHaveText("1 contacts matching “Ada Fern”");
  await page.reload();
  await expect(count).toHaveText("1 contacts matching “Ada Fern”");
  await navigation(page, /^Merge duplicates/);
  await expect(page.getByRole("heading", { name: "Merge duplicates", exact: true })).toBeVisible();
  await navigation(page, /^All contacts/);
  await expect(page).toHaveURL(/\/contacts$/);
  await expect(count).toHaveText("40 contacts");
  await expect(page.getByRole("searchbox", { name: "Search Contacts", exact: true })).toHaveValue(
    "",
  );
});
