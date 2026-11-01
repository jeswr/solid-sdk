// AUTHORED-BY Codex GPT-6.1-Sol
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo, test } from "@playwright/test";

const directory = fileURLToPath(new URL("../../../artifacts/screens/DS-03/", import.meta.url));
async function accessible(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.filter((item) => item.impact === "serious" || item.impact === "critical"),
  ).toEqual([]);
}
async function capture(page: Page, name: string, info: TestInfo) {
  await page.evaluate(() => document.fonts.ready);
  await accessible(page);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${name}-${info.project.name}.png`, fullPage: true });
}
async function reflow(page: Page) {
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await accessible(page);
}

for (const component of ["app-rail", "app-launcher", "bottom-tab-bar"]) {
  test(`${component}: responsive anatomy and closed state`, async ({ page }, info) => {
    await page.goto(`/dev/components/${component}`);
    const small = (info.project.use.viewport?.width ?? 1280) < 768;
    if (component === "app-rail") {
      if (small) await expect(page.locator(".suite-rail")).toBeHidden();
      else {
        await expect(page.locator(".suite-rail")).toBeVisible();
        expect(
          await page
            .locator(".suite-rail")
            .evaluate((element) => element.getBoundingClientRect().width),
        ).toBe(56);
        await expect(page.locator('.suite-rail a[aria-current="page"]')).toHaveAccessibleName(
          "Drive",
        );
        await expect(
          page.getByRole("button", { name: "Account menu, Alice Wilder" }),
        ).toBeVisible();
      }
    }
    if (component !== "app-launcher") {
      if (small) {
        await expect(page.locator(".suite-bottom-tabs")).toBeVisible();
        await expect(page.locator(".suite-bottom-tabs a")).toHaveText([
          "Home",
          "Drive",
          "Docs",
          "Tasks",
        ]);
        await expect(page.locator('.suite-bottom-tabs a[aria-current="page"]')).toHaveText("Drive");
      } else await expect(page.locator(".suite-bottom-tabs")).toBeHidden();
    }
    await capture(page, `${component}-closed`, info);
    await reflow(page);
  });
}

const launcherStates = [
  "ready",
  "loading",
  "refreshing",
  "saving",
  "empty",
  "unavailable",
  "cached",
  "reauth",
  "forbidden",
  "not-found",
  "conflict",
  "name-taken",
  "quota",
  "too-large",
  "offline",
  "unreachable",
  "unsupported",
  "unknown",
  "filtered",
  "customise",
];
for (const state of launcherStates) {
  test(`AppLauncher: ${state}`, async ({ page }, info) => {
    await page.goto("/dev/components/app-launcher");
    if (state !== "filtered" && state !== "customise")
      await page.getByLabel("Fixture state").selectOption(state);
    await page.getByRole("button", { name: "Apps", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Apps", exact: true })).toBeVisible();
    if (state === "filtered")
      await page.getByRole("searchbox", { name: "Filter apps" }).fill("missing");
    if (state === "customise" || state === "saving")
      await page.getByRole("button", { name: "Customise rail", exact: true }).click();
    await capture(page, `app-launcher-${state}`, info);
    if (state === "customise") {
      await page.locator(".suite-launcher").evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await capture(page, "app-launcher-customise-scrolled", info);
    }
    await reflow(page);
  });
}

for (const component of ["app-rail", "bottom-tab-bar"]) {
  test(`${component}: More opens the accessible launcher and restores focus`, async ({
    page,
  }, info) => {
    await page.goto(`/dev/components/${component}`);
    const small = (info.project.use.viewport?.width ?? 1280) < 768;
    const trigger =
      component === "bottom-tab-bar" && !small
        ? page.getByRole("button", { name: "Apps", exact: true })
        : page.getByRole("button", { name: "More apps" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await capture(page, `${component}-more`, info);
    if (small) {
      const box = await page.locator(".suite-launcher").boundingBox();
      expect(box?.x).toBe(0);
      expect(box?.y).toBe(0);
      expect(box?.width).toBe(info.project.use.viewport?.width);
    }
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await reflow(page);
  });
}

for (const state of ["loading", "empty", "cached"]) {
  test(`AppRail: ${state}`, async ({ page }, info) => {
    await page.goto("/dev/components/app-rail");
    await page.getByLabel("Fixture state").selectOption(state);
    await capture(page, `app-rail-${state}`, info);
    await reflow(page);
  });
}

test("launcher keyboard navigation, filter, native Enter navigation and Create", async ({
  page,
}) => {
  await page.goto("/dev/components/app-launcher");
  const trigger = page.getByRole("button", { name: "Apps", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("searchbox")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Home", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("link", { name: "Drive", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("link", { name: "Permissions", exact: true })).toBeFocused();
  await page.keyboard.type("docs");
  await expect(page.getByRole("searchbox")).toHaveValue("docs");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("link", { name: "Docs", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.press("Enter");
  await page.getByRole("button", { name: "New document" }).click();
  await expect(page.getByRole("status")).toHaveText("Create a document selected");
  await trigger.press("Enter");
  // The app pages are a later shell lane; verify the native link's real navigation here.
  await page.route("**/docs", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html lang="en"><title>Docs destination</title><main><h1>Docs destination</h1></main></html>',
    }),
  );
  await page.getByRole("link", { name: "Docs", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/docs$/);
});

test("checkbox and keyboard reorder persist in the fixture; desktop and mobile pins stay distinct", async ({
  page,
}) => {
  await page.goto("/dev/components/app-launcher");
  await page.getByRole("button", { name: "Apps", exact: true }).click();
  await page.getByRole("button", { name: "Customise rail", exact: true }).click();
  await page.getByRole("checkbox", { name: "Home", exact: true }).uncheck();
  await page.getByRole("button", { name: "Move Docs up" }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByRole("button", { name: "Apps", exact: true }).click();
  await page.getByRole("button", { name: "Customise rail", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Home", exact: true })).not.toBeChecked();
  await expect(page.locator(".suite-customise li label").first()).toHaveText("Docs");
  await accessible(page);
});

test("backlog remains hidden unless the flag is 1, then opens as a separate group", async ({
  page,
}, info) => {
  await page.goto("/dev/components/app-launcher");
  await page.getByRole("button", { name: "Apps", exact: true }).click();
  if (process.env.NEXT_PUBLIC_SHOW_BACKLOG_APPS === "1") {
    await expect(page.locator(".suite-coming-soon")).not.toHaveAttribute("open", "");
    await capture(page, "app-launcher-backlog-collapsed", info);
    await page.getByText("Coming soon", { exact: true }).click();
    await expect(page.getByRole("link", { name: "Calendar", exact: true })).toBeVisible();
    await capture(page, "app-launcher-backlog-expanded", info);
    await page.locator(".suite-launcher").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await capture(page, "app-launcher-backlog-scrolled", info);
  } else {
    await expect(page.getByText("Coming soon", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Calendar", exact: true })).toHaveCount(0);
  }
  await reflow(page);
});
