// AUTHORED-BY Codex GPT-6
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { encodeRef } from "../../src/lib/refs";

async function ready(page: Page, path = "/home") {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    /Good (morning|afternoon|evening), Alice/,
  );
  await expect(page.getByRole("status", { name: "Loading your data", exact: true })).toBeHidden();
}
async function accessible(page: Page) {
  await expect(page).toHaveTitle(/\S/);
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((item) => item.impact === "serious" || item.impact === "critical"),
  ).toEqual([]);
}

test("Home greets Alice, shows identity, music provenance and app sections", async ({ page }) => {
  await ready(page);
  await expect(page.getByRole("region", { name: "Your pod", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Alice Wilder", exact: true })).toBeVisible();
  await expect(page.getByText("Your storage doesn't report a limit")).toBeVisible();
  await expect(page.getByRole("link", { name: "See who has access" })).toHaveAttribute(
    "href",
    "/permissions",
  );
  await accessible(page);
  await page.keyboard.press("6");
  await expect(page).toHaveURL("/home/media");
  const music = page.getByRole("list", { name: "Music items", exact: true });
  await expect(music.getByRole("listitem")).toHaveCount(3);
  expect(
    await music.evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length),
  ).toBe(
    (page.viewportSize()?.width ?? 1280) >= 1280
      ? 3
      : (page.viewportSize()?.width ?? 1280) >= 768
        ? 2
        : 1,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(music.getByText("Provided by Spotify", { exact: true })).toHaveCount(3);
  await expect(page.getByRole("main")).not.toContainText(/http|WebID|ACL|RDF|container|Type Index/);
  await accessible(page);
  await page.screenshot({ path: test.info().outputPath("home-media.png"), fullPage: true });
  await page.keyboard.press("2");
  await expect(page).toHaveURL("/home/documents");
  await expect(page.getByRole("link", { name: "Open in Drive", exact: true })).toHaveAttribute(
    "href",
    "/drive",
  );
  await expect(page.getByRole("link", { name: "Open in Docs", exact: true })).toHaveAttribute(
    "href",
    "/docs",
  );
  const notes = page.getByRole("list", { name: "Notes items", exact: true });
  await expect(notes.getByText("Added by you")).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText(/http/);
  await accessible(page);
});

test("empty domains offer the appropriate actions", async ({ page }) => {
  await ready(page, "/home/mobility");
  await expect(page.getByRole("heading", { name: "Nothing here yet" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Connect a service", exact: true })).toHaveAttribute(
    "href",
    "/connect?domain=mobility",
  );
  await expect(page.getByRole("button", { name: "Add manually", exact: true })).toHaveCount(0);
  await accessible(page);
  await page.keyboard.press("4");
  await expect(page).toHaveURL("/home/body-health");
  await expect(page.getByRole("button", { name: "Add manually", exact: true })).toHaveCount(2);
  await expect(page.getByRole("link", { name: "Connect a service", exact: true })).toBeVisible();
  await accessible(page);
});

test("keys 1–9 navigate domains and ignore modifiers and text inputs", async ({ page }) => {
  await ready(page);
  for (const [key, domain] of [
    "personal",
    "documents",
    "calendar",
    "body-health",
    "financial",
    "media",
    "work-study",
    "mobility",
    "socials",
  ].entries()) {
    await page.keyboard.press(String(key + 1));
    await expect(page).toHaveURL(domain === "personal" ? "/home" : `/home/${domain}`);
  }
  await page.keyboard.press("Alt+2");
  await expect(page).toHaveURL("/home/socials");
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.setAttribute("aria-label", "Test input");
    document.querySelector("main")?.append(input);
    input.focus();
  });
  await page.keyboard.press("2");
  await expect(page).toHaveURL("/home/socials");
  await page.getByRole("textbox", { name: "Test input" }).fill("");
  await accessible(page);
});

test("the shortcut preference disables and re-enables character navigation", async ({ page }) => {
  await ready(page);
  await page.evaluate(() => localStorage.setItem("suite.settings.shortcuts", "off"));
  for (const key of "123456789") await page.keyboard.press(key);
  await expect(page).toHaveURL("/home");
  await page.evaluate(() => localStorage.removeItem("suite.settings.shortcuts"));
  await page.keyboard.press("6");
  await expect(page).toHaveURL("/home/media");
});

test("URL filters, card menus, source links and keyboard opening", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await ready(page, "/home/documents?types=notes");
  await expect(page.getByRole("list", { name: "Notes items", exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Files items", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  await expect(page).toHaveURL(/types=docs%2Cnotes/);
  await page.goBack();
  await ready(page, "/home/media");
  await page.getByRole("button", { name: "More actions for Caroline", exact: true }).click();
  const route = `/home/media/i/${encodeRef("https://alice.demo.pod/integrations/spotify/caroline.ttl")}`;
  await expect(page.getByRole("menuitem", { name: "Open", exact: true })).toHaveAttribute(
    "href",
    route,
  );
  await expect(
    page.getByRole("menuitem", { name: "Who can see this", exact: true }),
  ).toHaveAttribute("href", `${route}#access`);
  const source = page.getByRole("menuitem", { name: "Open in Spotify", exact: true });
  await expect(source).toHaveAttribute("target", "_blank");
  await expect(source).toHaveAttribute("rel", "noopener noreferrer");
  await page.getByRole("menuitem", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    new URL(route, page.url()).href,
  );
  await page.getByRole("link", { name: "Caroline", exact: true }).click({ button: "right" });
  await expect(page.getByRole("menuitem")).toHaveCount(6);
  await page.keyboard.press("Escape");
  await accessible(page);
  await page.getByRole("link", { name: "Caroline", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(route);
});

test("offline keeps the last loaded cards", async ({ page, context }) => {
  await ready(page, "/home/media");
  await expect(
    page.getByRole("list", { name: "Music items", exact: true }).getByRole("listitem"),
  ).toHaveCount(3);
  await context.setOffline(true);
  await expect(page.getByText("Showing saved copies", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Music items", exact: true }).getByRole("listitem"),
  ).toHaveCount(3);
  await context.setOffline(false);
  await expect(page.getByText("Showing saved copies", { exact: true })).toBeHidden();
  await accessible(page);
});

test("an offline cold open reads the browser's saved demo pod", async ({ page }) => {
  await ready(page, "/home/media");
  // Reload the app with an offline signal while leaving navigation/assets available to the harness.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
  });
  await ready(page, "/home/media");
  await expect(page.getByText("Showing saved copies", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Music items", exact: true }).getByRole("listitem"),
  ).toHaveCount(3);
  await accessible(page);
});

test("live changes from another app update cards without skeletons", async ({ page, context }) => {
  await ready(page, "/home/documents");
  await expect(page.getByRole("list", { name: "Files items", exact: true })).toBeVisible();
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      if (document.querySelector(".hm-progress")) {
        document.documentElement.dataset.homeRefreshSeen = "true";
        if (document.querySelector('.suite-loading[data-preset="grid"]'))
          document.documentElement.dataset.homeRefreshSkeleton = "true";
      }
    });
    observer.observe(document.querySelector("main") as HTMLElement, {
      subtree: true,
      childList: true,
    });
  });
  const drive = await context.newPage();
  await drive.goto("/drive");
  await expect(
    drive.getByRole("heading", { level: 1, name: "My Drive", exact: true }),
  ).toBeVisible();
  await drive.getByTestId("drive-upload-input").setInputFiles({
    name: "Live update.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("A change from Drive"),
  });
  await expect(page.getByRole("link", { name: "Live update.txt", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-home-refresh-seen", "true");
  await expect(page.locator("html")).not.toHaveAttribute("data-home-refresh-skeleton");
  await expect(page.getByRole("status").filter({ hasText: /^Updated/ })).toHaveCount(1);
  await drive.close();
  await accessible(page);
});
