// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("demo account changes shell language without reloading and supports Arabic RTL", async ({
  page,
}) => {
  await page.goto("/signin");
  await page.getByRole("button", { name: "Try it with a demo pod" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto("/settings/appearance");
  let navigations = 0;
  page.on("framenavigated", () => {
    navigations++;
  });
  await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("es");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.getByRole("heading", { name: "Apariencia", exact: true })).toBeVisible();
  await expect(page.getByText("Idioma y región", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Inicio", exact: true }).filter({ visible: true }),
  ).toBeVisible();
  expect(navigations).toBe(0);
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Idioma", exact: true })).toHaveValue("es");
  await page.getByRole("combobox", { name: "Idioma", exact: true }).selectOption("ar");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByText("اللغة والمنطقة", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "الرئيسية", exact: true }).filter({ visible: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // The shell grid follows the reading direction: the rail (or the mobile tab bar's launcher)
  // sits on the right, and the sidebar's border is on its left edge.
  const width = page.viewportSize()?.width ?? 1280;
  if (width >= 768) {
    const rail = await page.locator(".suite-rail").first().boundingBox();
    expect(rail && rail.x + rail.width / 2).toBeGreaterThan(width / 2);
    const sidebar = page.locator(".suite-sidebar-slot").filter({ visible: true });
    if (await sidebar.count()) {
      const box = await sidebar.first().boundingBox();
      const rect = await page.locator(".suite-rail").first().boundingBox();
      expect(box && rect && box.x + box.width).toBeLessThanOrEqual((rect?.x ?? 0) + 1);
      expect(await sidebar.first().evaluate((node) => getComputedStyle(node).borderLeftWidth)).toBe(
        "1px",
      );
    }
  }
  const audit = await new AxeBuilder({ page }).analyze();
  expect(audit.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual(
    [],
  );
});

test("signed-out language choice applies on the sign-in page and survives reload before restore", async ({
  page,
}) => {
  await page.goto("/signin");
  const picker = page.getByRole("combobox", { name: "Language", exact: true });
  await picker.selectOption("ar");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "تسجيل الدخول إلى Solid Suite" })).toBeAttached();
  await page.reload();
  // The pre-hydration script sets the direction before React runs.
  expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");
  await expect(page.getByRole("combobox", { name: "اللغة", exact: true })).toHaveValue("ar");
  await page.getByRole("combobox", { name: "اللغة", exact: true }).selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
});
