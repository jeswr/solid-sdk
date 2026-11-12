// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test } from "@playwright/test";
import { appRegistry } from "../../src/shell/registry";

test("the shell launcher lists every app and filters Docs to one result", async ({ page }) => {
  await page.goto("/welcome?next=%2Fhome");
  await page.getByRole("button", { name: "Try it with a demo pod" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home", exact: true })).toBeVisible();
  const trigger = page
    .getByRole("button", {
      name: (page.viewportSize()?.width ?? 1280) < 768 ? "More apps" : "Apps",
      exact: true,
    })
    .filter({ visible: true });
  await trigger.click();
  const launcher = page.getByRole("dialog", { name: "Apps", exact: true });
  await expect(launcher.getByRole("link")).toHaveCount(appRegistry.length);
  for (const name of ["Calendar", "Chat", "Agent"]) {
    await expect(launcher.getByRole("link", { name, exact: true })).toBeVisible();
  }
  const filter = launcher.getByRole("searchbox", { name: "Filter apps" });
  await expect(filter).toBeFocused();
  await filter.fill("Docs");
  await expect(launcher.getByRole("link")).toHaveCount(1);
  await filter.press("ArrowDown");
  const docs = launcher.getByRole("link", { name: "Docs", exact: true });
  await expect(docs).toBeFocused();
  await docs.press("Enter");
  await expect(page).toHaveURL(/\/docs\/?$/);
  await expect(launcher).toBeHidden();
});
