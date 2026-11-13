// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, type Page, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/__tasks-test-reset", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Reset</title>" }),
  );
  await page.goto("/__tasks-test-reset");
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("solid-suite-demo");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Demo pod database deletion blocked"));
    });
  });
  await page.unroute("**/__tasks-test-reset");
});

async function sidebar(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) < 1024) {
    const drawer = page.getByRole("dialog", { name: "Navigation", exact: true });
    if (!(await drawer.isVisible()))
      await page.getByRole("button", { name: "Open navigation", exact: true }).press("Enter");
    return drawer.getByRole("navigation", { name: "Tasks", exact: true });
  }
  return page.getByRole("navigation", { name: "Tasks", exact: true });
}

test("nests projects and operates the sidebar tree with the keyboard across reloads", async ({
  page,
}) => {
  await page.goto("/tasks/inbox");
  for (const name of ["Work", "Clients", "Acme"]) {
    const nav = await sidebar(page);
    await nav.getByRole("button", { name: "New project", exact: true }).press("Enter");
    const field = nav.getByRole("textbox", { name: "New project name", exact: true });
    await field.fill(name);
    await field.press("Enter");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
  }
  for (const [name, parent] of [
    ["Clients", "Work"],
    ["Acme", "Work › Clients"],
  ] as const) {
    const nav = await sidebar(page);
    await nav
      .getByRole("button", { name: `Project actions for ${name}`, exact: true })
      .press("ArrowDown");
    const item = page.getByRole("menuitem", { name: "Move under…", exact: true });
    await item.focus();
    await item.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Move under…", exact: true });
    await dialog
      .getByRole("combobox", { name: "Parent project", exact: true })
      .selectOption({ label: parent });
    await dialog.getByRole("button", { name: "Move", exact: true }).press("Enter");
    await expect(dialog).toBeHidden();
  }
  let nav = await sidebar(page);
  const toggle = nav.getByRole("button", { name: "Sub-projects of Work", exact: true });
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(nav.getByRole("link", { name: /Clients/ })).toHaveCount(0);
  await page.reload();
  nav = await sidebar(page);
  const restored = nav.getByRole("button", { name: "Sub-projects of Work", exact: true });
  await expect(restored).toHaveAttribute("aria-expanded", "false");
  await restored.press("Enter");
  await expect(nav.getByRole("link", { name: /Clients/ })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(nav.getByRole("link", { name: /Work/ })).toBeFocused();
  if ((page.viewportSize()?.width ?? 1280) < 1024) await page.keyboard.press("Escape");
  const breadcrumb = page.getByRole("navigation", { name: "Project breadcrumb", exact: true });
  await expect(breadcrumb.getByRole("link")).toHaveText(["Work", "Clients", "Acme"]);
});
