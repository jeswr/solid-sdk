// AUTHORED-BY Claude Opus 5.5
// DS-13 visual and accessibility gate: every /dev/components fixture page, plus the states
// that need a click, key or URL to appear, screenshotted against committed baselines and
// checked with axe (0 serious/critical) in each of the 6 width × theme projects.
// Run with `pnpm test:visual` (`playwright.visual.config.ts`); not part of `playwright test`.
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { fixtureNames } from "../../src/app/dev/components/fixture-names";
import { BASELINED } from "./baselines";

// Fixtures that show relative times ("2 minutes ago", "tomorrow 5pm") read this clock.
const FIXED_NOW = new Date("2026-10-26T10:00:00Z");

// Routes with their own page under src/app/dev/components (the catalog index links them).
const standaloneRoutes = [
  "tokens",
  "date-time-field",
  "date-picker-popover",
  "recurrence-editor",
  "empty-state",
  "error-state",
  "loading-skeleton",
  "toasts",
  "render-async",
  "data-table",
  "file-grid",
  "toolbar",
  "filter-chips",
  "breadcrumbs",
  "editable-text",
  "tag-input",
  "upload-dock",
  "drop-zone-overlay",
  "preview-pane",
  "typed-view",
  "item-details",
  "pod-meter",
  "app-rail",
  "app-launcher",
  "bottom-tab-bar",
  "shell",
  "top-bar",
  "sidebar-nav",
  "details-pane",
  "people-picker",
  "role-select",
  "duration-chips",
  "consent-sheet",
  "permission-row",
  "sign-in",
  "notifications-tray",
  "share-dialog",
] as const;
// The two composite catalogs repeat the per-component pages; only their extra
// "State reference" strip is captured (see the interaction list below).
const composite = new Set<string>(["primitives", "atoms"]);
const pageRoutes = [
  "",
  ...fixtureNames.filter((name) => !composite.has(name)),
  ...standaloneRoutes,
];

type Shot = {
  name: string;
  path: string;
  /** Drives the page into the state; returns what to capture (default: the viewport). */
  act: (page: Page) => Promise<Locator | undefined>;
};
const region = (page: Page) =>
  page.getByRole("region", { name: "comfortable fixtures", exact: true });
const button = (page: Page, name: string, within?: Locator) =>
  (within ?? page).getByRole("button", { name, exact: true }).first();
async function open(page: Page, trigger: Locator, role: Parameters<Page["getByRole"]>[0]) {
  const target = page.getByRole(role).last();
  await expect(async () => {
    if (!(await target.isVisible())) await trigger.click();
    await expect(target).toBeVisible({ timeout: 1_000 });
  }).toPass();
  return target;
}
async function choose(page: Page, label: string, value: string) {
  // A wrapping <label> also names the select with its current value ("Fixture state ready").
  await page
    .getByRole("combobox", { name: new RegExp(`^${label}`) })
    .first()
    .selectOption(value);
}
const viewport = async () => undefined;
const main = (page: Page) => page.locator("main").first();
// Fixtures whose component (rail, top bar, sidebar, panes) sits outside <main>: whole page.
const chrome = new Set(["app-rail", "shell", "top-bar", "sidebar-nav", "details-pane"]);

const interactions: Shot[] = [
  {
    name: "details-pane-embedded",
    path: "details-pane?state=embedded",
    act: async (page) => {
      const toggle = page.getByRole("button", { name: "Toggle details pane" });
      if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
      await expect(page.getByRole("complementary")).toBeVisible();
      return page.getByRole("complementary");
    },
  },
  {
    name: "primitives-state-reference",
    path: "primitives",
    act: async (page) => page.getByRole("region", { name: "Async state examples" }),
  },
  // Primitive overlays, menus and help, opened from the comfortable region.
  ...(
    [
      ["dialog", "Open dialog", "dialog"],
      ["sheet", "Open sheet", "dialog"],
      ["sheet", "Open bottom sheet", "dialog"],
      ["alert-dialog", "Open confirmation", "alertdialog"],
      ["alert-dialog", "Open small confirmation", "alertdialog"],
      ["command", "Open command dialog", "dialog"],
    ] as const
  ).map(
    ([path, label, role]): Shot => ({
      name: `${path}-${label.toLowerCase().replaceAll(" ", "-")}`,
      path,
      act: async (page) => {
        return open(page, button(page, label, region(page)), role);
      },
    }),
  ),
  ...(
    [
      ["popover", "Open popover", "dialog"],
      ["popover", "Open storage popover", "dialog"],
      ["dropdown-menu", "File actions", "menu"],
      ["dropdown-menu", "Sort and view", "menu"],
    ] as const
  ).map(
    ([path, label, role]): Shot => ({
      name: `${path}-${label.toLowerCase().replaceAll(" ", "-")}`,
      path,
      act: async (page) => open(page, button(page, label, region(page)), role),
    }),
  ),
  {
    name: "dropdown-menu-submenu",
    path: "dropdown-menu",
    act: async (page) => {
      await open(page, button(page, "Sort and view", region(page)), "menu");
      await page.getByRole("menuitem", { name: "Move to" }).hover();
      await expect(page.getByRole("menu")).toHaveCount(2);
      return page.getByRole("menu").last();
    },
  },
  {
    name: "context-menu-open",
    path: "context-menu",
    act: async (page) => {
      await region(page).getByRole("button").click({ button: "right" });
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();
      return menu;
    },
  },
  ...(["Role", "Save to"] as const).map(
    (label): Shot => ({
      name: `select-${label.toLowerCase().replaceAll(" ", "-")}-open`,
      path: "select",
      act: async (page) =>
        open(page, region(page).getByRole("combobox", { name: label, exact: true }), "listbox"),
    }),
  ),
  {
    name: "tooltip-open",
    path: "tooltip",
    act: async (page) => {
      await button(page, "Hover or focus for help", region(page)).hover();
      await expect(page.getByRole("tooltip")).toBeVisible();
      return region(page);
    },
  },
  {
    name: "hover-card-open",
    path: "hover-card",
    act: async (page) => {
      await region(page).getByRole("link", { name: "About the suite icons" }).hover();
      await expect(page.locator('[data-slot="hover-card-content"]')).toBeVisible();
      return region(page);
    },
  },
  {
    name: "toast-error",
    path: "toast",
    act: async (page) => {
      await button(page, "Show error toast", region(page)).click();
      const toast = page.locator("[data-sonner-toast]");
      await expect(toast).toBeVisible();
      return toast;
    },
  },
  {
    name: "form-error",
    path: "form",
    act: async (page) => {
      await button(page, "Save title", region(page)).click();
      await expect(region(page).getByRole("alert")).toHaveText("Enter a title");
      return region(page);
    },
  },
  ...(
    [
      ["button", "button", "default"],
      ["input", "textbox", "File name"],
      ["checkbox", "checkbox", "Select false"],
    ] as const
  ).map(
    ([path, role, label]): Shot => ({
      name: `${path}-focus`,
      path,
      act: async (page) => {
        await region(page).getByRole(role, { name: label, exact: true }).focus();
        return region(page);
      },
    }),
  ),
  // Suite components.
  ...(["Mixed", "Failed", "Offline with changes"] as const).map(
    (scenario): Shot => ({
      name: `sync-sheet-${scenario.toLowerCase().replaceAll(" ", "-")}`,
      path: "sync-sheet",
      act: async (page) => {
        return open(page, button(page, `Open ${scenario}`), "dialog");
      },
    }),
  ),
  ...(["Open conflict", "Open long summary"] as const).map(
    (label): Shot => ({
      name: `conflict-dialog-${label.toLowerCase().replaceAll(" ", "-")}`,
      path: "conflict-dialog",
      act: async (page) => {
        return open(page, button(page, label), "dialog");
      },
    }),
  ),
  {
    name: "app-launcher-open",
    path: "app-launcher",
    act: async (page) => {
      return open(page, button(page, "Apps"), "dialog");
    },
  },
  ...(["loading", "unreachable"] as const).map(
    (state): Shot => ({
      name: `app-rail-${state}`,
      path: "app-rail",
      act: async (page) => {
        await choose(page, "Fixture state", state);
        return viewport();
      },
    }),
  ),
  ...(
    [
      "loading",
      "first-use",
      "filtered",
      "forbidden",
      "unreachable",
      "not-found",
      "refreshing",
      "offline",
    ] as const
  ).map(
    (state): Shot => ({
      name: `shell-${state}`,
      path: `shell?state=${state}`,
      // The progress bar and offline pill live in the top bar; other states in the file list.
      act: async (page) =>
        state === "refreshing" || state === "offline"
          ? page.getByRole("banner")
          : page.locator("#fixture-files"),
    }),
  ),
  ...(
    [
      "loading",
      "refreshing",
      "empty",
      "filtered-empty",
      "error",
      "offline-cached",
      "offline-uncached",
    ] as const
  ).map(
    (state): Shot => ({
      name: `render-async-${state}`,
      path: "render-async",
      act: async (page) => {
        await choose(page, "Content state", state);
        return page.locator('[data-fixture-state="async-list"]');
      },
    }),
  ),
  ...(["populated", "loading", "error", "empty"] as const).map(
    (state): Shot => ({
      name: `notifications-tray-${state}`,
      path: "notifications-tray",
      act: async (page) => {
        await choose(page, "Fixture state", state);
        await page.getByRole("checkbox", { name: "Show list" }).check();
        if (state === "populated")
          await expect(page.getByText("Project plan changed")).toBeVisible();
        return main(page);
      },
    }),
  ),
  ...(["results", "results-error", "empty"] as const).map(
    (state): Shot => ({
      name: `global-search-${state}`,
      path: "global-search",
      act: async (page) => {
        await choose(page, "Fixture state", state);
        if (state !== "empty") return main(page);
        // GlobalSearch swaps to its Search sheet below 768px (its matchMedia breakpoint).
        const opened = (page.viewportSize()?.width ?? 1280) < 768;
        if (opened) await page.getByRole("button", { name: "Search", exact: true }).click();
        const scope = opened ? page.getByRole("dialog") : main(page);
        await scope.getByPlaceholder("Search your storage").fill("project");
        await expect(scope.getByRole("listbox").or(scope.getByText(/No results/))).toBeVisible();
        return scope;
      },
    }),
  ),
  {
    name: "command-palette-open",
    path: "command-palette",
    act: async (page) => {
      return open(page, button(page, "Open command palette"), "dialog");
    },
  },
  {
    name: "shortcut-help-open",
    path: "shortcut-help",
    act: async (page) => {
      return open(page, button(page, "Show keyboard shortcuts"), "dialog");
    },
  },
  {
    name: "share-dialog-open",
    path: "share-dialog",
    act: async (page) => {
      return open(page, button(page, "Open share dialog"), "dialog");
    },
  },
  ...(["loading", "empty", "error-quota", "collapsed", "failed"] as const).map(
    (state): Shot => ({
      name: `upload-dock-${state}`,
      path: `upload-dock?state=${state}`,
      act: async (page) => main(page),
    }),
  ),
  ...(["drag-over", "disabled", "loading", "error-forbidden"] as const).map(
    (state): Shot => ({
      name: `drop-zone-overlay-${state}`,
      path: `drop-zone-overlay?state=${state}`,
      act: async (page) => main(page),
    }),
  ),
  ...(["audio", "text", "markdown", "typed", "unknown"] as const).map(
    (kind): Shot => ({
      name: `preview-pane-${kind}`,
      path: `preview-pane?kind=${kind}`,
      act: async (page) => main(page),
    }),
  ),
  ...(["loading", "empty", "error-not-found"] as const).map(
    (state): Shot => ({
      name: `preview-pane-${state}`,
      path: `preview-pane?kind=text&state=${state}`,
      act: async (page) => main(page),
    }),
  ),
  {
    name: "editable-text-invalid",
    path: "editable-text",
    act: async (page) => {
      await page
        .getByRole("button", { name: "Document name: Q4 launch plan", exact: true })
        .press("F2");
      const input = page.getByRole("textbox", { name: "Document name", exact: true });
      await input.fill("");
      await input.press("Enter");
      await expect(input).toHaveAttribute("aria-invalid", "true");
      return main(page);
    },
  },
  {
    name: "tag-input-suggestions",
    path: "tag-input",
    act: async (page) => {
      const input = page.getByRole("combobox", { name: "Labels", exact: true });
      await input.click();
      await input.fill("r");
      await expect(page.getByRole("listbox")).toBeVisible();
      return main(page);
    },
  },
  {
    name: "toolbar-overflow",
    path: "toolbar",
    act: async (page) => {
      const narrow = page.getByRole("toolbar", { name: "Narrow file actions" });
      return open(page, button(page, "More", narrow), "menu");
    },
  },
  {
    name: "date-picker-popover-open",
    path: "date-picker-popover",
    act: async (page) => {
      return open(page, page.getByRole("button", { name: /Due date Choose/ }).first(), "dialog");
    },
  },
];

async function prepare(page: Page, path: string) {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.goto(`/dev/components${path ? `/${path}` : ""}`);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  // Interactions before hydration are dropped and media-query layouts are still server-rendered.
  await expect(page.locator("html[data-fixtures-hydrated]")).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
}
// As in ds-06: a collection card's accessible name is its visible file name and its metadata
// is a description; axe's label-in-name heuristic counts every descendant text node.
const compositeCells = new Set(["data-table", "file-grid"]);
async function accessible(page: Page, path: string) {
  // Radix slider thumbs get aria-valuenow once they register after hydration.
  await expect(page.locator('[role="slider"]:not([aria-valuenow])')).toHaveCount(0);
  const builder = new AxeBuilder({ page });
  if (compositeCells.has(path)) builder.disableRules(["label-content-name-mismatch"]);
  const { violations } = await builder.analyze();
  const blocking = violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target.join(" ")) }));
  expect(blocking).toEqual([]);
}

test.describe("fixture pages", () => {
  for (const path of pageRoutes)
    test(path || "index", async ({ page }, info) => {
      await prepare(page, path);
      const name = `${path || "index"}.png`;
      const baselined = BASELINED.has(info.project.name);
      if (baselined && chrome.has(path))
        await expect(page).toHaveScreenshot(name, { fullPage: true });
      else if (baselined) await expect(main(page)).toHaveScreenshot(name);
      await accessible(page, path);
    });
});

test.describe("fixture states", () => {
  for (const shot of interactions)
    test(shot.name, async ({ page }, info) => {
      await prepare(page, shot.path);
      const target = await shot.act(page);
      if (BASELINED.has(info.project.name))
        await expect(target ?? page).toHaveScreenshot(`${shot.name}.png`);
      await accessible(page, shot.path);
    });
});

test("every catalog link is covered", async ({ page }) => {
  await prepare(page, "");
  const links = await page
    .getByRole("navigation", { name: "Component fixtures" })
    .getByRole("link")
    .evaluateAll((anchors) =>
      anchors.map((anchor) => new URL((anchor as HTMLAnchorElement).href).pathname),
    );
  const covered = new Set([...pageRoutes, ...composite].map((path) => `/dev/components/${path}`));
  expect(links.filter((link) => !covered.has(link))).toEqual([]);
});
