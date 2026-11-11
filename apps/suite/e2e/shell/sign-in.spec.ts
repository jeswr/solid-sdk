// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function accessible(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
  await expect(page.locator("h1")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function screenshot(page: Page, name: string, project: string) {
  const directory = "../../artifacts/playwright/shell";
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${name}-${project}.png`, fullPage: true });
}

test("signed-out entry shows welcome, sign-in links and an optional demo", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Your documents, files and tasks — kept in a pod you control",
  );
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute(
    "href",
    "/signin",
  );
  await expect(page.getByRole("link", { name: "Create account", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try it with a demo pod" })).toBeVisible();
  await accessible(page);
  await screenshot(page, "welcome", info.project.name);
});

test("different-account validation and unavailable production loopback auth", async ({
  page,
}, info) => {
  await page.goto("/signin");
  const address = page.getByRole("textbox", { name: "WebID", exact: true });
  await expect(address).toBeVisible();
  await accessible(page);
  await screenshot(page, "signin", info.project.name);
  await address.fill("notaurl");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveText(
    "We couldn't find a sign-in service at that address",
  );
  await expect(address).toHaveAttribute("aria-invalid", "true");
  await accessible(page);
  await address.fill("https://example.org/profile/card#me");
  await address.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveText(
    "We couldn't sign you in. Please try again.",
  );
  const remembered = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem("suite.recentProviders.v1") ?? "[]"));
  // A WebID is never remembered as a provider.
  expect(await remembered()).toEqual([]);
  await accessible(page);
  // The production HTTP loopback harness cannot authenticate. Real OAuth runs in shell-css
  // with a development server; failed addresses must never become remembered providers.
  await page.getByRole("button", { name: "Other provider", exact: true }).click();
  const provider = page.getByRole("combobox", { name: "Provider address" });
  await provider.fill("https://login.example.org/realms/solid");
  await provider.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveText(
    "We couldn't sign you in. Please try again.",
  );
  expect(await remembered()).toEqual([]);
  await accessible(page);
  // Provider buttons: the known community providers, each a real button.
  await expect(page.getByRole("list", { name: "Providers" }).getByRole("button")).not.toHaveCount(
    0,
  );
});

test("pod explainer opens with the keyboard and returns focus", async ({ page }) => {
  await page.goto("/signin");
  const trigger = page.getByRole("button", { name: "What is a pod?" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText(
    "A pod is a place to keep your data online.",
  );
  await accessible(page);
  // Focus starts on Close, whose tooltip takes the first Escape (WCAG 1.4.13 dismissible).
  await page.keyboard.press("Escape");
  if (await page.getByRole("dialog").isVisible()) await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("demo lands on the start page and the shell keeps the session", async ({ page }, info) => {
  await page.goto("/signin");
  await page.getByRole("button", { name: "Try it with a demo pod" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto("/search");
  await expect(page.getByRole("heading", { name: "Search", exact: true, level: 1 })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Account: / }).filter({ visible: true }),
  ).toBeVisible();
  await accessible(page);
  await screenshot(page, "search", info.project.name);
  await page.reload();
  await expect(
    page.getByRole("button", { name: /^Account: / }).filter({ visible: true }),
  ).toBeVisible();
  await accessible(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/home$/);
});

test("session guard keeps a safe return route", async ({ page }) => {
  await page.goto("/search");
  await expect(page).toHaveURL(/\/signin\?next=%2Fsearch$/);
  await accessible(page);
  await page.getByRole("button", { name: "Try it with a demo pod" }).click();
  await expect(page).toHaveURL(/\/search$/);
  await accessible(page);
});

test("unsafe next cannot redirect the demo outside the suite", async ({ page }) => {
  await page.goto("/signin?next=//evil.example");
  await accessible(page);
  await page.getByRole("button", { name: "Try it with a demo pod" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await accessible(page);
});

test("expired sessions keep content inert until reauthentication or signout", async ({ page }) => {
  await page.goto("/signin");
  await page.getByRole("textbox", { name: "WebID", exact: true }).fill("https://example.org/");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toBeVisible();
  await page.evaluate(() =>
    localStorage.setItem(
      "suite.accounts.v1",
      JSON.stringify({
        activeId: "example",
        accounts: [
          {
            id: "example",
            name: "Alex Example",
            webId: "https://example.org/profile#me",
            storageUrl: "https://example.org/storage/",
            issuer: "https://id.example.org/",
            kind: "solid",
          },
        ],
      }),
    ),
  );
  await page.goto("/search");
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Your session ended — sign in again to continue");
  await expect(page.locator("[inert] #suite-page-title")).toHaveText("Search");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await page.mouse.click(1, 1);
  await expect(dialog).toBeVisible();
  // The hidden, inert page still owns its one h1 while the dialog has its own h2.
  await accessible(page);
  await dialog.getByRole("button", { name: "Sign in again" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("We couldn't sign you in. Please try again.");
  await dialog.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/signin\?next=%2Fsearch$/);
  await accessible(page);
});

test("invalid Drive reference renders the not-found page", async ({ page }) => {
  await page.goto("/signin");
  await page.getByRole("button", { name: "Try it with a demo pod" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto("/drive/f/not-a-ref");
  await expect(
    page.getByRole("heading", { name: "We couldn't find that page", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to Home" })).toHaveAttribute("href", "/home");
  await expect(page.getByRole("link", { name: "Search", exact: true })).toHaveAttribute(
    "href",
    "/search",
  );
  await accessible(page);
});

test("client identity and callback bridge are served", async ({ page, request, baseURL }) => {
  const clientUrl = `${baseURL}/.well-known/solid-client-id.jsonld`;
  const client = await request.get(clientUrl);
  expect(client.ok()).toBe(true);
  expect(client.headers()["content-type"]).toContain("application/ld+json");
  // Unconfigured local server: answered for loopback only, never cached.
  expect(client.headers()["cache-control"]).toBe("no-store");
  const document = await client.json();
  const origin = new URL(document.client_id).origin;
  expect(new URL(origin).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  expect(document.client_id).toBe(`${origin}/.well-known/solid-client-id.jsonld`);
  expect(document.redirect_uris).toEqual([`${origin}/auth/callback.html`]);
  const forged = await request.get(clientUrl, {
    headers: { "x-forwarded-host": "attacker.example" },
  });
  expect((await forged.json()).client_id).toBe(document.client_id);
  const callback = await request.get("/auth/callback.html");
  expect(callback.ok()).toBe(true);
  expect(await callback.text()).toContain("Signing you in…");
  await page.goto("/auth/callback.html?code=example&state=test");
  await expect(page).toHaveURL(/\/signin\?callback=1$/);
  expect(await page.evaluate(() => sessionStorage.getItem("suite.auth.callback"))).toBe(
    `${baseURL}/auth/callback.html?code=example&state=test`,
  );
  await accessible(page);
});

test("same-origin popup sends its callback only to its opener", async ({ page, baseURL }) => {
  await page.goto("/signin");
  await page.evaluate(() => {
    window.addEventListener("message", (event) => {
      if (event.origin === location.origin)
        sessionStorage.setItem("test.callback", JSON.stringify(event.data));
    });
    window.open("/auth/callback.html?code=example&state=popup");
  });
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem("test.callback")))
    .toBe(
      JSON.stringify({
        type: "solid-suite:auth-callback",
        url: `${baseURL}/auth/callback.html?code=example&state=popup`,
      }),
    );
  await accessible(page);
});
