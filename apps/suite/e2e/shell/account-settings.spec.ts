// AUTHORED-BY Codex GPT-6.1-Sol
import { mkdir, readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// Mirrors src/shell/session/demo-backend.ts and src/shell/account/test-backends.ts. Importing
// those here would load the demo pod seed (and its calendar deps) into the Playwright runner.
const demoAccount = {
  id: "demo",
  name: "Alice Wilder",
  webId: "https://alice.demo.pod/profile/card#me",
  storageUrl: "https://alice.demo.pod/",
  kind: "demo",
};
const secondDemoAccount = {
  id: "test-second-demo",
  kind: "demo",
  name: "Rowan Vale",
  webId: "https://example.org/rowan/profile#me",
  storageUrl: "https://example.org/rowan/",
};

async function accessible(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
  await expect(page.locator("h1")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function capture(page: Page, name: string, project: string) {
  await accessible(page);
  const directory = "../../artifacts/playwright/shell";
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${name}-${project}.png`, fullPage: true });
}

const trigger = (page: Page, name = demoAccount.name) =>
  page.getByRole("button", { name: `Account: ${name}`, exact: true }).filter({ visible: true });
async function menu(page: Page) {
  await trigger(page).click();
  const dialog = page.getByRole("dialog", { name: "Account menu", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ first, second }) => {
      if (localStorage.getItem("suite.accounts.v1") === null)
        localStorage.setItem(
          "suite.accounts.v1",
          JSON.stringify({ activeId: first.id, accounts: [first, second] }),
        );
    },
    { first: demoAccount, second: secondDemoAccount },
  );
});
test.afterEach(async ({ page }) => {
  await accessible(page);
});

test("rail and TopBar account menu copies the Account ID and links to account actions", async ({
  page,
  context,
}, info) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/search?q=project");
  const account = trigger(page);
  if ((page.viewportSize()?.width ?? 1280) < 768)
    await expect(
      page
        .locator(".shell-mobile-account")
        .getByRole("button", { name: `Account: ${demoAccount.name}`, exact: true }),
    ).toBeVisible();
  else
    await expect(
      page
        .getByRole("navigation", { name: "Apps", exact: true })
        .getByRole("button", { name: `Account: ${demoAccount.name}`, exact: true }),
    ).toBeVisible();
  await account.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Account menu", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Copy Account ID" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(demoAccount.webId);
  await expect(dialog.getByRole("link", { name: "Add another account" })).toHaveAttribute(
    "href",
    "/signin?add=1&next=%2Fsearch%3Fq%3Dproject",
  );
  await expect(dialog.getByRole("link", { name: "Manage your account" })).toHaveAttribute(
    "href",
    "/settings/account",
  );
  await expect(dialog.getByRole("link", { name: "Report a problem" })).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
  await capture(page, "account-menu", info.project.name);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(account).toBeFocused();
});

test("About and shortcut help open and return focus to the account trigger", async ({
  page,
}, info) => {
  await page.goto("/search");
  let dialog = await menu(page);
  await dialog.getByRole("button", { name: "About Solid Suite", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "About Solid Suite", exact: true });
  await expect(dialog).toContainText("Version preview");
  await expect(dialog).toContainText("MIT licence");
  await capture(page, "account-menu-about", info.project.name);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(trigger(page)).toBeFocused();
  dialog = await menu(page);
  await dialog.getByRole("button", { name: "Keyboard shortcuts", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
  await expect(dialog.getByRole("checkbox", { name: /Use single-key shortcuts/ })).toBeVisible();
  await expect(dialog.getByRole("table")).not.toHaveCount(0);
  await accessible(page);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(trigger(page)).toBeFocused();
});

test("switching remembered accounts keeps search and shows the active name and toast", async ({
  page,
}, info) => {
  await page.goto("/search?q=project");
  const dialog = await menu(page);
  await dialog.getByRole("button", { name: /Rowan Vale/ }).click();
  await expect(trigger(page, secondDemoAccount.name)).toBeVisible();
  await expect(page.getByText("Now using Rowan Vale", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/search\?q=project$/);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("suite.accounts.v1") ?? "{}").activeId,
    ),
  ).toBe(secondDemoAccount.id);
  await capture(page, "account-menu-switched", info.project.name);
});

test("sign out of all accounts returns to welcome", async ({ page }) => {
  await page.goto("/search");
  const dialog = await menu(page);
  await dialog.getByRole("button", { name: "Sign out of all accounts", exact: true }).click();
  await expect(page).toHaveURL(/\/welcome$/);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("suite.accounts.v1") ?? "{}").accounts,
    ),
  ).toEqual([]);
});

test("appearance autosaves and restores theme, density, font and motion after reload", async ({
  page,
}, info) => {
  await page.goto("/settings/appearance");
  await page.getByRole("radio", { name: "Dark", exact: true }).check();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("combobox", { name: "Density", exact: true }).selectOption("compact");
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  expect(
    await page
      .locator("html")
      .evaluate((html) => getComputedStyle(html).getPropertyValue("--row-h").trim()),
  ).toBe("32px");
  await page.getByRole("combobox", { name: "UI font size", exact: true }).selectOption("110");
  await page.getByRole("combobox", { name: "Reduce motion", exact: true }).selectOption("reduce");
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("radio", { name: "Dark", exact: true })).toBeChecked();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await expect(page.locator("html")).toHaveAttribute("data-font-scale", "110");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce");
  await capture(page, "settings-appearance-saved", info.project.name);
});

test("preferences stay scoped to their account", async ({ page }) => {
  await page.goto("/settings/appearance");
  await page.getByRole("combobox", { name: "Density", exact: true }).selectOption("compact");
  const dialog = await menu(page);
  await dialog.getByRole("button", { name: /Rowan Vale/ }).click();
  await expect(page).toHaveURL(/\/settings\/appearance$/);
  await expect(page.getByRole("combobox", { name: "Density", exact: true })).toHaveValue(
    "comfortable",
  );
  await expect(page.locator("html")).toHaveAttribute("data-density", "comfortable");
});

test("desktop notifications need the account's own opt-in, saved per account", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["notifications"]);
  await page.goto("/settings/notifications");
  const optIn = page.getByRole("checkbox", { name: "Show desktop notifications for this account" });
  await expect(optIn).toBeEnabled();
  await expect(optIn).not.toBeChecked();
  await optIn.check();
  await expect
    .poll(() =>
      page.evaluate(
        (id) => JSON.parse(localStorage.getItem(`suite.prefs.v1.${id}`) ?? "{}").desktop,
        demoAccount.id,
      ),
    )
    .toBe(true);
  await page.getByRole("checkbox", { name: "Access requests" }).uncheck();
  await page.reload();
  await expect(optIn).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Access requests" })).not.toBeChecked();
  await accessible(page);
});

for (const [section, title] of [
  ["account", "Account"],
  ["appearance", "Appearance"],
  ["storage", "Storage"],
  ["notifications", "Notifications"],
  ["offline", "Offline"],
  ["shortcuts", "Shortcuts"],
  ["advanced", "Advanced"],
] as const) {
  test(`settings ${section} has one heading and responsive section navigation`, async ({
    page,
  }, info) => {
    await page.goto(`/settings/${section}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await capture(page, `settings-${section}`, info.project.name);
    if ((page.viewportSize()?.width ?? 1280) < 1024)
      await page.getByRole("button", { name: "Toggle sidebar", exact: true }).click();
    const sidebar = page
      .getByRole("navigation", { name: "Settings sections", exact: true })
      .filter({ visible: true });
    await expect(sidebar.getByRole("link")).toHaveCount(7);
    await expect(sidebar.getByRole("link", { name: title, exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await accessible(page);
    if ((page.viewportSize()?.width ?? 1280) < 1024)
      await sidebar.getByRole("link", { name: title, exact: true }).click();
  });
}

test("storage capabilities match the demo defaults", async ({ page }) => {
  await page.goto("/settings/storage");
  const table = page.getByRole("table", { name: "What your storage supports" });
  await expect(table).toBeVisible();
  for (const feature of [
    "Live co-editing",
    "Live updates",
    "Search",
    "Access requests",
    "Version history",
    "Trash",
    "Link sharing",
    "Expiring access",
    "Move",
  ]) {
    await expect(
      table
        .getByRole("row")
        .filter({ has: page.getByRole("rowheader", { name: feature, exact: true }) })
        .getByRole("cell"),
    ).toHaveText(feature === "Trash" || feature === "Move" ? "Yes" : "No");
  }
  await expect(page.getByText(/used \(no limit reported\)/)).toBeVisible();
});

test("shortcuts remain searchable with the single-key switch", async ({ page }) => {
  await page.goto("/settings/shortcuts");
  await page.getByRole("checkbox", { name: /Use single-key shortcuts/ }).uncheck();
  await page.getByRole("textbox", { name: "Find a shortcut" }).fill("sidebar");
  await expect(page.getByRole("rowheader", { name: "Toggle sidebar" })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: "Command palette" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /Use single-key shortcuts/ })).not.toBeChecked();
});

test("clearing saved copies requires confirmation and preserves other data", async ({ page }) => {
  await page.goto("/settings/offline");
  await page.evaluate(async () => {
    await caches.open("suite-test-copy");
    await caches.open("other-test-copy");
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("suite-test-copies", 1);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  });
  await page.getByRole("button", { name: "Clear saved copies", exact: true }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Your original files stay in your storage");
  await accessible(page);
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await page.evaluate(() => caches.has("suite-test-copy"))).toBe(true);
  await page.getByRole("button", { name: "Clear saved copies", exact: true }).click();
  await confirm.getByRole("button", { name: "Clear saved copies", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved copies cleared" })).toBeVisible();
  expect(await page.evaluate(() => caches.keys())).toEqual(["other-test-copy"]);
  expect(
    await page.evaluate(async () =>
      (await indexedDB.databases()).some(({ name }) => name === "suite-test-copies"),
    ),
  ).toBe(false);
});

test("downloaded diagnostics contain no Account IDs or storage URLs", async ({ page }) => {
  await page.goto("/settings/advanced");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download diagnostics", exact: true }).click();
  const path = await (await download).path();
  expect(path).toBeTruthy();
  const data = await readFile(path as string, "utf8");
  expect(JSON.parse(data).route).toBe("/settings/advanced");
  expect(data).not.toContain(demoAccount.webId);
  expect(data).not.toContain(demoAccount.storageUrl);
  expect(data).not.toMatch(/https?:|%3a/iu);
});

test("settings redirects to account and reflows at 320px", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings\/account$/);
  await capture(page, "settings-account-320", info.project.name);
});
