// AUTHORED-BY Codex GPT-6
import { expect, test } from "./fixtures";

test("Drive keeps its search route and details state in the authenticated shell", async ({
  page,
}) => {
  const response = await page.goto("/drive");
  // Finish the entry redirect in HTTP before the session-gated RSC tree exists.
  const entry = response?.request().redirectedFrom();
  expect(entry?.url()).toBe(new URL("/drive", page.url()).href);
  expect((await entry?.response())?.status()).toBe(307);
  await expect(page.getByRole("heading", { level: 1, name: "Drive", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "My Drive", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  // A shell/app heading can render before discovery finishes. Require a real listing.
  await expect(page.getByRole("heading", { name: "Your Drive is empty", exact: true })).toBeVisible(
    { timeout: 30_000 },
  );
  const search = page.getByRole("searchbox", { name: "Search in Drive", exact: true });
  await search.fill("report");
  await search.press("Enter");
  // This route is compiled on its first dev navigation. The fixture-backed Drive
  // suite checks the file results; this fresh CSS account checks the shell wiring.
  await page.waitForURL("/drive/search?q=report");
  await expect(page).toHaveURL("/drive/search?q=report");

  const show = page.getByRole("button", { name: "Show details", exact: true });
  await show.click();
  await expect(
    page.getByRole("button", { name: "Hide details", exact: true, includeHidden: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Close details", exact: true }).first().click();
  await expect(show).toBeVisible();
  await expect(show).toHaveAttribute("aria-pressed", "false");
  await show.click();
  await expect(
    page.getByRole("button", { name: "Hide details", exact: true, includeHidden: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Close details", exact: true }).first(),
  ).toBeVisible();
  await expect(page).toHaveURL("/drive/search?q=report");
});
