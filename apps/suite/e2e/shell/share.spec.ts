// AUTHORED-BY Codex GPT-6.1-Sol
import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function audit(page: Page, state: string, project: string) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((issue) => issue.impact === "serious" || issue.impact === "critical"),
  ).toEqual([]);
  await mkdir("../../artifacts/playwright/shell", { recursive: true });
  await page.screenshot({
    path: `../../artifacts/playwright/shell/share-${state}-${project}.png`,
    fullPage: true,
  });
}
async function open(page: Page, fixture = "restricted") {
  await page.goto("/dev/components/share-dialog");
  await page.getByLabel("Fixture state").selectOption(fixture);
  await page.getByRole("button", { name: "Open share dialog" }).click();
  await expect(
    page.getByRole("heading", { name: "People with access", exact: true }),
  ).toBeVisible();
  return page.getByRole("dialog", { name: "Share Project notes" });
}

test("add a contact as Editor, change role, remove and Undo", async ({ page }, info) => {
  const dialog = await open(page);
  await audit(page, "restricted", info.project.name);
  await dialog.getByRole("combobox", { name: "Add people", exact: true }).fill("Sage");
  await page.getByRole("option", { name: /Sage Brook/ }).click();
  await dialog.getByRole("combobox", { name: "New person's role" }).click();
  await page.getByRole("option", { name: "Editor", exact: true }).click();
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  const person = dialog.getByRole("listitem", { name: "https://example.org/sage#me", exact: true });
  await expect(person.getByRole("combobox")).toContainText("Editor");
  await audit(page, "added-editor", info.project.name);
  await person.getByRole("combobox").click();
  await page.getByRole("option", { name: "Viewer", exact: true }).click();
  await expect(person.getByRole("combobox")).toContainText("Viewer");
  await audit(page, "changed-role", info.project.name);
  await person.getByRole("combobox").click();
  await page.getByRole("option", { name: "Remove access" }).click();
  await expect(person).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(person.getByRole("combobox")).toContainText("Viewer");
  await audit(page, "undo", info.project.name);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open share dialog" })).toBeFocused();
});

test("unsupported link option explains why and duration is disabled", async ({ page }, info) => {
  await page.goto("/dev/components/share-dialog");
  await page.getByLabel("Link sharing", { exact: true }).uncheck();
  await page.getByLabel("Expiring access", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Open share dialog" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("radio", { name: "1 day", exact: true })).toBeDisabled();
  await expect(dialog.getByText("Not available on this storage", { exact: true })).toBeVisible();
  await dialog.getByRole("combobox", { name: "General access", exact: true }).click();
  const link = page.getByRole("option", { name: "Anyone with the link", exact: true });
  await expect(link).toBeDisabled();
  await link.locator("..").hover();
  await expect(page.getByRole("tooltip", { name: "Not available on this storage" })).toBeVisible();
  await audit(page, "unsupported", info.project.name);
});

test("forbidden and offline preserve the list and disable changes", async ({ page }, info) => {
  for (const fixture of ["forbidden", "offline"]) {
    const dialog = await open(page, fixture);
    await expect(
      dialog.getByText(
        fixture === "forbidden"
          ? "You can't change who has access to this"
          : "Reconnect to change sharing",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(dialog.getByRole("listitem", { name: "Ash Reed", exact: true })).toBeVisible();
    await expect(dialog.getByRole("combobox", { name: "Role for Ash Reed" })).toBeDisabled();
    await expect(dialog.getByRole("combobox", { name: "Add people", exact: true })).toBeDisabled();
    await audit(page, fixture, info.project.name);
  }
});

test("link state, inherited and owner rows, and protocol-neutral copy", async ({ page }, info) => {
  const dialog = await open(page, "link");
  await expect(dialog.getByText("Anyone with the link can view", { exact: true })).toBeVisible();
  await expect(
    dialog
      .getByRole("listitem", { name: "Rowan Vale", exact: true })
      .getByText("Owner", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Role for Ivo Marsh" })).toBeDisabled();
  await expect(dialog.getByRole("link", { name: "Inherited from My storage" })).toHaveAttribute(
    "href",
    "https://example.org/storage/",
  );
  await dialog.getByRole("combobox", { name: "General access role" }).click();
  await expect(page.getByRole("option", { name: "Manager", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await audit(page, "link", info.project.name);
});

test("access request succeeds and unsupported storage offers account copy", async ({
  page,
}, info) => {
  await page.goto("/dev/components/share-dialog");
  await page.getByLabel("Fixture state").selectOption("request");
  await page
    .getByRole("textbox", { name: "Message (optional)" })
    .fill("Please share the project notes");
  await page.getByRole("textbox", { name: "What is this for?" }).fill("Planning");
  await audit(page, "request-form", info.project.name);
  await page.getByRole("button", { name: "Request access", exact: true }).click();
  await expect(
    page.getByRole("status", { name: "" }).filter({ hasText: "Request sent to the owner" }),
  ).toBeVisible();
  await audit(page, "request-success", info.project.name);
  await page.getByLabel("Access requests", { exact: true }).uncheck();
  await expect(
    page.getByText("Ask the owner to share this with you", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy my Account ID" })).toBeVisible();
  await audit(page, "request-fallback", info.project.name);
});

test("keyboard-only add and reflow at 320px", async ({ page }, info) => {
  await page.goto("/dev/components/share-dialog");
  await page.getByRole("button", { name: "Open share dialog" }).focus();
  await page.keyboard.press("Enter");
  const picker = page.getByRole("combobox", { name: "Add people", exact: true });
  await expect(picker).toBeVisible();
  for (let index = 0; index < 24; index++) {
    if (await picker.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(picker).toBeFocused();
  await page.keyboard.type("https://example.org/fern#me");
  await page.keyboard.press("Enter");
  // Walk to the explicit grant action; selecting a person alone never writes access.
  for (let index = 0; index < 12; index++) {
    if (
      await page
        .getByRole("button", { name: "Add", exact: true })
        .evaluate((element) => element === document.activeElement)
    )
      break;
    await page.keyboard.press("Tab");
  }
  await expect(page.getByRole("button", { name: "Add", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("listitem", { name: "https://example.org/fern#me", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 900 });
  await expect(page.getByRole("dialog")).toHaveAttribute("data-slot", "sheet-content");
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await audit(page, "keyboard-320", info.project.name);
});
