// AUTHORED-BY Codex (GPT-6.1 Sol)
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("demo invitation, reply change, edit and cancellation are accessible and persist", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("/events");
  const demo = page.getByRole("button", { name: "Try it with a demo pod", exact: true });
  if (await demo.isVisible()) await demo.click();
  await page.goto("/events");
  await expect(
    page.getByRole("article", { name: "A little supper club", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New event", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Event name", { exact: true }).fill("Lanterns in the garden");
  await dialog.getByLabel("Starts", { exact: true }).fill("2027-12-10T18:30");
  await dialog.getByLabel("Place", { exact: true }).fill("The Glasshouse");
  await dialog.getByLabel("Anyone with the link, including named guests", { exact: true }).check();
  await dialog.getByLabel("Let guests see the guest list and replies", { exact: true }).check();
  await dialog.getByRole("button", { name: "Save invitation", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Lanterns in the garden", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Saving invitation…", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Send reply", exact: true }).click();
  await expect(page.getByText("Your reply has been sent", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Maybe", exact: true }).click();
  await page.getByRole("button", { name: "Change your reply", exact: true }).click();
  await expect(page.getByText("Your reply is in", { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Edit details", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Event name", { exact: true })
    .fill("Lanterns & supper");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Lanterns & supper", exact: true })).toBeVisible();
  await expect(page.getByText("Saving invitation…", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel event", exact: true }).click();
  await page.getByRole("button", { name: "Confirm cancellation", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Replies are closed", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Saving invitation…", { exact: true })).toHaveCount(0);
  await page.reload();
  await page
    .getByRole("button", { name: "Cancelled", exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.getByRole("article", { name: "Lanterns & supper", exact: true })).toBeVisible();
});

for (const width of [375, 768, 1280])
  test(`invitations fit a ${width}px viewport in both themes`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/events");
    const demo = page.getByRole("button", { name: "Try it with a demo pod", exact: true });
    if (await demo.isVisible()) await demo.click();
    await page.goto("/events");
    await expect(
      page.getByRole("article", { name: "A little supper club", exact: true }),
    ).toBeVisible();
    for (const dark of [false, true]) {
      await page.evaluate(
        (value) => document.documentElement.classList.toggle("dark", value),
        dark,
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
  });
