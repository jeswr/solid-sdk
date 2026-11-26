// AUTHORED-BY Codex GPT-6.1-Sol
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("demo recovery and legacy contact persists with the selected folders and applies no grants", async ({
  page,
}) => {
  await page.goto("/welcome?next=%2Fsettings%2Faccount");
  await page.getByRole("button", { name: "Try it with a demo pod" }).click();
  await expect(page).toHaveURL(/\/settings\/account$/);
  if ((page.viewportSize()?.width ?? 1280) < 768)
    await page.getByRole("button", { name: "Toggle sidebar", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Settings sections", exact: true })
    .filter({ visible: true })
    .getByRole("link", { name: "Recovery & legacy", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Recovery & legacy", exact: true })).toBeVisible();
  await expect(
    page.getByText("Your profile lists 2 sign-in providers.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Export your data", exact: true })).toHaveAttribute(
    "href",
    "/settings/export",
  );
  await page
    .getByLabel("Legacy contact WebID", { exact: true })
    .fill("https://jordan.example/profile/card#me");
  await page.getByLabel("Display name", { exact: true }).fill("Jordan");
  await page.getByLabel("Access scope", { exact: true }).selectOption("containers");
  await page.getByRole("checkbox", { name: "Photos /drive/Photos/", exact: true }).check();
  await page.getByRole("checkbox", { name: "Work /drive/Work/", exact: true }).check();
  await page.getByRole("button", { name: "Add legacy contact", exact: true }).click();
  const preview = page.getByRole("region", { name: "Proposed access preview" });
  await expect(preview).toContainText("Jordan would be able to read Photos and Work.");
  await page.getByRole("button", { name: "Save legacy plan", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Legacy plan saved." })).toBeVisible();
  // Inspect the fixture's actual ACL bytes, proving save did not apply contact grants.
  const privateAcl = await page.evaluate(async () => {
    const pod = window.__suiteDemoPod;
    if (!pod) throw new Error("Expected the demo pod fixture");
    return (await pod.fetch("https://alice.demo.pod/settings/legacy-plan.ttl.acl")).text();
  });
  expect(privateAcl).not.toContain("jordan.example");
  await page.reload();
  await expect(page.getByRole("region", { name: "Proposed access preview" })).toContainText(
    "Jordan would be able to read Photos and Work.",
  );
  await expect(page.getByRole("button", { name: "Remove Jordan" })).toBeVisible();
  const a11y = await new AxeBuilder({ page }).analyze();
  expect(a11y.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual(
    [],
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
