// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { accessible, expect, tabTo, test } from "./fixtures";

for (const keyboardOnly of [false, true]) {
  test(`scenario 4: launcher, current app and arrow/Enter navigation${keyboardOnly ? " (keyboard only)" : " (click)"}`, async ({
    page,
  }) => {
    await page.goto("/home");
    await page.getByRole("heading", { level: 1, name: "Home", exact: true }).waitFor();
    const trigger = page
      .getByRole("button", {
        name: (page.viewportSize()?.width ?? 1280) < 768 ? "More apps" : "Apps",
        exact: true,
      })
      .filter({ visible: true });
    if (keyboardOnly) {
      await tabTo(page, trigger);
      await page.keyboard.press("Enter");
    } else await trigger.click();
    const launcher = page.getByRole("dialog", { name: "Apps", exact: true });
    await expect(launcher).toBeVisible();
    await expect(launcher.getByRole("link", { name: "Home", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(launcher.getByRole("searchbox")).toBeFocused();
    await accessible(page);
    await page.keyboard.press("Tab");
    await expect(launcher.getByRole("link", { name: "Home", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(launcher.getByRole("link", { name: "Drive", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/drive(?:\/my)?\/?$/);
    await expect(launcher).toBeHidden();
    await page.getByRole("heading", { level: 1, name: "Drive", exact: true }).waitFor();
    await accessible(page);
  });
}

test("scenario 4: Cmd/Ctrl+K then Open app opens the launcher with the current app marked", async ({
  page,
}) => {
  await page.goto("/home");
  await page.getByRole("heading", { level: 1, name: "Home", exact: true }).waitFor();
  // A document load finishes before the DPoP-bound refresh restores the interactive shell.
  await expect(page.getByRole("button", { name: "Toggle sidebar", exact: true })).toBeVisible();
  // Cmd/Ctrl+K opens the command palette; its "Open app…" command opens the launcher (§3).
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await page.keyboard.type("Open app");
  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
  const launcher = page.getByRole("dialog", { name: "Apps", exact: true });
  await expect(launcher).toBeVisible();
  await expect(launcher.getByRole("link", { name: "Home", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await accessible(page);
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowRight");
  await expect(launcher.getByRole("link", { name: "Drive", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/drive(?:\/my)?\/?$/);
  await page.getByRole("heading", { level: 1, name: "Drive", exact: true }).waitFor();
  await accessible(page);
});
