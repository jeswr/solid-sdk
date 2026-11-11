// AUTHORED-BY Codex GPT-6.1-Sol
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
  const audit = await new AxeBuilder({ page }).analyze();
  expect(audit.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual(
    [],
  );
});
