// AUTHORED-BY Codex GPT-6.1-Sol
import { accessible, expect, tabTo, test } from "./fixtures";

for (const keyboardOnly of [false, true]) {
  test(`scenario 4: launcher, current app and arrow/Enter navigation${keyboardOnly ? " (keyboard only)" : " (click)"}`, async ({
    page,
  }) => {
    await page.goto("/home");
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
    await accessible(page);
  });
}

test("scenario 4: Cmd/Ctrl+K opens the launcher with the current app marked", async ({ page }) => {
  await page.goto("/home");
  await page.keyboard.press("ControlOrMeta+k");
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
  await accessible(page);
});
