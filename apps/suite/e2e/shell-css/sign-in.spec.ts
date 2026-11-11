// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { accessible, cssAccount, expect, signIn, signedOutTest as test } from "./fixtures";

for (const keyboardOnly of [false, true]) {
  test(`scenario 1: provider button, avatar and reload${keyboardOnly ? " (keyboard only)" : ""}`, async ({
    page,
  }) => {
    await signIn(page, "alice", { keyboardOnly });
    await accessible(page);
    await page.reload();
    await page.getByRole("heading", { level: 1, name: "Home", exact: true }).waitFor();
    await expect(page).toHaveURL(/\/home\/?$/);
    await expect(
      page
        .getByRole("button", { name: `Account: ${cssAccount("alice").name}`, exact: true })
        .filter({ visible: true }),
    ).toBeVisible();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await accessible(page);
    // A committed popup session must also resume if its opener reloads on /signin.
    await page.goto("/signin");
    await page.waitForURL(/\/home\/?$/);
    await page.getByRole("heading", { level: 1, name: "Home", exact: true }).waitFor();
    await expect(page).toHaveURL(/\/home\/?$/);
    await expect(
      page
        .getByRole("button", { name: `Account: ${cssAccount("alice").name}`, exact: true })
        .filter({ visible: true }),
    ).toBeVisible();
    await accessible(page);
  });
}

test("scenario 2: sign in with a WebID", async ({ page }) => {
  await signIn(page, "alice", { method: "webid" });
  await accessible(page);
});

test("scenario 2: invalid URL shows the discovery error", async ({ page }) => {
  await page.goto("/signin");
  const address = page.getByRole("textbox", { name: "WebID", exact: true });
  await address.fill("not-a-url");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveText(
    "We couldn't find a sign-in service at that address",
  );
  await expect(address).toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL(/\/signin$/);
  await accessible(page);
});
