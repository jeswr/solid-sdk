// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * E2E smoke against a REAL local CSS + the real app (never the live deploy):
 * the Client ID Document is byte-correct, the callback page is served, and the
 * app boots to the suite login surface. This proves the whole stack stands up
 * against a live Solid environment.
 */
import { expect, test } from "@playwright/test";

test.describe("app boots against local CSS", () => {
  test("serves a correct Client ID Document", async ({ request, baseURL }) => {
    const res = await request.get("/clientid.jsonld");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/ld+json");
    const doc = await res.json();
    // client_id MUST equal the document's own URL byte-for-byte.
    expect(doc.client_id).toBe(`${baseURL}/clientid.jsonld`);
    expect(doc.redirect_uris).toContain(`${baseURL}/callback.html`);
    expect(doc.scope).toContain("webid");
    expect(doc.client_name).toBe("Coeliac Diary");
    expect(doc["@context"]).toContain("https://www.w3.org/ns/solid/oidc-context.jsonld");
  });

  test("serves the auth callback page", async ({ request }) => {
    const res = await request.get("/callback.html");
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain("opener.postMessage");
  });

  test("renders the suite login surface", async ({ page }) => {
    await page.goto("/");
    // Silent restore resolves to anonymous → the login area with the intro + panel.
    await expect(page.getByRole("heading", { name: "Coeliac Diary" })).toBeVisible();
    await expect(page.getByText(/Decision support, not diagnosis/i)).toBeVisible();
    // The <jeswr-login-panel> WebID entry (Playwright pierces the open shadow root).
    await expect(page.getByRole("textbox")).toBeVisible();
  });

  test("local CSS is reachable from the test environment", async ({ request }) => {
    const res = await request.get("http://localhost:3000/");
    expect(res.ok()).toBeTruthy();
  });
});
