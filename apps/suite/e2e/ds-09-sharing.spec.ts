// AUTHORED-BY Codex GPT-6.1-Sol
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import buttonStyleSnapshot from "./snapshots/ds-09-consent-button-styles.json" with {
  type: "json",
};

const directory = fileURLToPath(new URL("../../../artifacts/screens/DS-09/", import.meta.url));
async function accessible(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((item) => item.impact === "serious" || item.impact === "critical"),
  ).toEqual([]);
}
async function reflow(page: Page) {
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  for (const dialog of await page.getByRole("dialog").all()) {
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
  }
  await accessible(page);
}
async function capture(page: Page, name: string, project: string) {
  await page.evaluate(() => document.fonts.ready);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${name}-${project}.png`, fullPage: true });
}
async function tabTo(page: Page, target: Locator) {
  for (let index = 0; index < 60; index++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error("Keyboard path did not reach its target");
}

for (const component of [
  "people-picker",
  "role-select",
  "duration-chips",
  "consent-sheet",
  "permission-row",
]) {
  test(`${component}: every fixture state, axe and reflow`, async ({ page }, info) => {
    await page.goto(`/dev/components/${component}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await accessible(page);
    await capture(page, component, info.project.name);
    await reflow(page);
  });
}

for (const name of [
  "All roles",
  "viewer disabled",
  "commenter disabled",
  "editor disabled",
  "manager disabled",
]) {
  test(`role menu: ${name}`, async ({ page }, info) => {
    await page.goto("/dev/components/role-select");
    await page.locator(`[data-fixture="${name}"]`).getByRole("combobox").click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await accessible(page);
    await capture(page, `role-${name.replaceAll(" ", "-")}`, info.project.name);
    await reflow(page);
  });
}

const asyncNames = [
  "Loading",
  "First use",
  "Filtered empty",
  "Error reauth",
  "Error forbidden",
  "Error not-found",
  "Error unreachable",
  "Error unsupported",
  "Error unknown",
  "Offline saved copies",
  "Offline unavailable",
];
for (const name of [
  "Default",
  "No purpose",
  "Nothing selected",
  "Partly selected",
  "Single account",
  "Expiry unavailable",
  "Custom duration",
  ...asyncNames,
]) {
  test(`consent: ${name}`, async ({ page }, info) => {
    await page.goto("/dev/components/consent-sheet");
    await page.getByRole("button", { name: `Open ${name}`, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await accessible(page);
    await capture(page, `consent-${name.toLowerCase().replaceAll(" ", "-")}`, info.project.name);
    await dialog.getByRole("button", { name: "Share", exact: true }).scrollIntoViewIfNeeded();
    await capture(
      page,
      `consent-${name.toLowerCase().replaceAll(" ", "-")}-actions`,
      info.project.name,
    );
    if (name === "Nothing selected" || asyncNames.includes(name)) {
      await expect(dialog.getByRole("button", { name: "Share", exact: true })).toBeDisabled();
    }
    if (name === "Single account") await expect(dialog.getByRole("combobox")).toHaveCount(0);
    if (name === "Expiry unavailable") {
      for (const radio of await dialog.getByRole("radio").all()) await expect(radio).toBeDisabled();
      await expect(dialog.getByText("Not available on this storage")).toBeVisible();
    }
    await reflow(page);
  });
}

test("consent: identical computed button weight and size", async ({ page }, info) => {
  await page.goto("/dev/components/consent-sheet");
  await page.getByRole("button", { name: "Open Default", exact: true }).click();
  const buttons = page.locator("[data-consent-actions] > button");
  const styles = await buttons.evaluateAll((elements) =>
    elements.map((element) => {
      const css = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return {
        width: bounds.width,
        height: bounds.height,
        fontWeight: css.fontWeight,
        fontSize: css.fontSize,
        padding: css.padding,
        backgroundColor: css.backgroundColor,
        color: css.color,
        borderColor: css.borderColor,
        borderRadius: css.borderRadius,
        borderWidth: css.borderWidth,
        borderStyle: css.borderStyle,
        boxShadow: css.boxShadow,
      };
    }),
  );
  expect(styles).toHaveLength(2);
  expect(styles[0]).toEqual(styles[1]);
  expect(
    styles[0] && {
      height: styles[0].height,
      fontWeight: styles[0].fontWeight,
      fontSize: styles[0].fontSize,
      borderRadius: styles[0].borderRadius,
      borderWidth: styles[0].borderWidth,
      borderStyle: styles[0].borderStyle,
    },
  ).toEqual(buttonStyleSnapshot.styles);
  await info.attach("consent-computed-styles", {
    body: JSON.stringify(styles, null, 2),
    contentType: "application/json",
  });
});

test("people: keyboard selection, raw entry, email validation and removal", async ({
  page,
}, info) => {
  await page.goto("/dev/components/people-picker");
  const fixture = page.locator('[data-fixture="Contacts and raw entry"]');
  const input = fixture.getByRole("combobox");
  await tabTo(page, input);
  await page.keyboard.press("ArrowDown");
  await expect(fixture.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await accessible(page);
  await capture(page, "people-suggestions", info.project.name);
  await page.keyboard.press("Enter");
  await expect(fixture.getByRole("list", { name: "Selected people" })).toContainText("Bram Kerst");
  await expect(input).toBeFocused();
  await page.keyboard.type("bram@example.com");
  await page.keyboard.press("Enter");
  await expect(fixture.getByRole("alert")).toHaveText("This person is already added");
  await capture(page, "people-duplicate", info.project.name);
  await input.fill("nobody@example.com");
  await page.keyboard.press("Enter");
  await expect(fixture.getByRole("alert")).toHaveText(
    "No account found for this email — paste their account ID",
  );
  await accessible(page);
  await capture(page, "people-email-unresolved", info.project.name);
  await input.fill("javascript:alert(1)");
  await page.keyboard.press("Enter");
  await expect(fixture.getByRole("alert")).toContainText("http:// or https://");
  await capture(page, "people-invalid-account", info.project.name);
  await input.fill("https://a-very-long-account-name.example/profile/public#person");
  await page.keyboard.press("Enter");
  await expect(fixture.getByRole("list", { name: "Selected people" })).toContainText(
    "Account ID: https://a-very-long-account-name.example/profile/public#person",
  );
  await page.keyboard.press("Shift+Tab");
  await expect(fixture.getByRole("button", { name: /Remove https:/ })).toBeFocused();
  await page.keyboard.press("Space");
  await capture(page, "people-keyboard-selected", info.project.name);
  await reflow(page);
});

test("roles and durations: keyboard changes and disabled reasons", async ({ page }) => {
  await page.goto("/dev/components/role-select");
  const roles = page.locator('[data-fixture="All roles"]');
  await tabTo(page, roles.getByRole("combobox", { name: "Role" }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("option", { name: "Viewer", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name: "Commenter", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(roles.getByRole("combobox", { name: "Role" })).toContainText("Commenter");
  await page.locator('[data-fixture="manager disabled"]').getByRole("combobox").click();
  await expect(page.getByRole("option", { name: "Manager", exact: true })).toBeDisabled();
  await expect(page.getByRole("option", { name: "Manager", exact: true })).toContainText(
    "Not available on this storage",
  );
  await accessible(page);
  await page.keyboard.press("Escape");
  await page.goto("/dev/components/duration-chips");
  const durations = page.locator('[data-fixture="until-revoked"]');
  await tabTo(page, durations.getByRole("radio", { name: "Until revoked" }));
  await page.keyboard.press("ArrowRight");
  await expect(durations.getByRole("radio", { name: "1 day", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(
    page.locator('[data-fixture="Expiry unavailable"]').getByText("Not available on this storage"),
  ).toBeVisible();
  await accessible(page);
});

test("consent: keyboard cancel, deny, share and focus return", async ({ page }, info) => {
  await page.goto("/dev/components/consent-sheet");
  const trigger = page.getByRole("button", { name: "Open Default", exact: true });
  await tabTo(page, trigger);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("checkbox", { name: "Select all" })).toBeFocused();
  await page.keyboard.press("Space");
  await expect(dialog.getByRole("button", { name: "Share", exact: true })).toBeDisabled();
  await page.keyboard.press("Space");
  await tabTo(page, dialog.getByRole("button", { name: "Cancel", exact: true }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await accessible(page);
  await capture(page, "consent-deny-confirmation", info.project.name);
  await expect(page.getByRole("button", { name: "Keep reviewing" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await tabTo(page, page.getByRole("button", { name: "Deny", exact: true }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByText("Request denied", { exact: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await tabTo(page, dialog.getByRole("button", { name: "Share", exact: true }));
  await page.keyboard.press("Enter");
  await expect(page.getByText("Shared 3 data types from personal")).toBeVisible();
  await expect(trigger).toBeFocused();
});

test("permissions: keyboard expand, toggle, undo and confirm revoke", async ({ page }, info) => {
  await page.goto("/dev/components/permission-row");
  const collapsed = page.locator('[data-fixture="Collapsed"]');
  const trigger = collapsed.getByRole("button", { name: /MaraCoach.*Show details/ });
  await tabTo(page, trigger);
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const toggle = collapsed.getByRole("switch", { name: "Allow MaraCoach to use Activity" });
  await tabTo(page, toggle);
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(
    collapsed.getByText("Builds your weekly plan will stop working in MaraCoach"),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await tabTo(page, collapsed.getByRole("button", { name: "Revoke all" }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await accessible(page);
  await capture(page, "permission-revoke-confirmation", info.project.name);
  await tabTo(page, page.getByRole("button", { name: "Remove access" }));
  await page.keyboard.press("Enter");
  for (const control of await collapsed.getByRole("switch").all())
    await expect(control).toHaveAttribute("aria-checked", "false");
  await accessible(page);
  await capture(page, "permission-revoked", info.project.name);
  await reflow(page);
});
