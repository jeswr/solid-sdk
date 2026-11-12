// AUTHORED-BY Codex GPT-6.1-Sol
import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Page, type TestInfo } from "@playwright/test";
import type { SheetEngine } from "../../src/apps/sheets/lib/contract";
import type { DemoPod } from "../../src/lib/demo-pod/pod";
import { seedDemoSession } from "../demo-session";

declare global {
  interface Window {
    // biome-ignore lint/style/useNamingConvention: explicitly contracted development fixture
    __sheetsEngine?: SheetEngine;
  }
}

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route("**/__sheets-test-reset", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Reset Sheets</title>",
      }),
    );
    await page.goto("/__sheets-test-reset");
    await page.evaluate(async () => {
      localStorage.clear();
      sessionStorage.clear();
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase("solid-suite-demo");
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("Demo pod reset blocked"));
      });
    });
    await page.unroute("**/__sheets-test-reset");
    await seedDemoSession(page);
    // Inject failures through the app's existing demo-pod fixture, before the session
    // captures fetch. page.route cannot intercept in-memory pod requests.
    await page.addInitScript(() => {
      let demo: DemoPod | undefined;
      Object.defineProperty(window, "__suiteDemoPod", {
        configurable: true,
        get: () => demo,
        set: (pod: DemoPod) => {
          demo = pod;
          const transport = pod.fetch;
          const fetch: typeof globalThis.fetch = async (input, init) => {
            const url =
              typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            const method = init?.method ?? (input instanceof Request ? input.method : "GET");
            const reading = method === "GET" || method === "HEAD";
            if (reading && url === sessionStorage.getItem("sheets-fail-resource"))
              return new Response(null, { status: 503 });
            const response = await transport(input, init);
            const readOnly = sessionStorage.getItem("sheets-read-only");
            if (
              reading &&
              readOnly &&
              ["index.ttl", "workbook.json"].some((name) => url === `${readOnly}${name}`)
            ) {
              const headers = new Headers(response.headers);
              headers.set("wac-allow", 'user="read",public=""');
              return new Response(response.body, { status: response.status, headers });
            }
            return response;
          };
          Object.defineProperty(pod, "fetch", { configurable: true, value: fetch });
        },
      });
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        get: () => sessionStorage.getItem("sheets-offline") !== "1",
      });
    });
    await use(page);
  },
});

export async function waitForEngine(page: Page, editable = true) {
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__sheetsEngine)), { timeout: 30000 })
    .toBe(true);
  await expect(page.getByRole("region", { name: "Spreadsheet grid" })).toBeVisible();
  // Initial comment discovery locks edits until its anchors have been registered.
  const insertChart = page.getByRole("button", { name: "Insert chart", exact: true });
  if (editable) await expect(insertChart).toBeEnabled();
  else await expect(insertChart).toBeDisabled();
}

export async function accessible(page: Page, info: TestInfo, surface: string) {
  // Univer's canvas, ribbon and sheet bar are third-party DOM we cannot fix here (main's
  // spec excluded them too). The app's own chrome, menus, dialogs and states are scanned.
  const { violations } = await new AxeBuilder({ page })
    .exclude('[data-testid="univer-container"]')
    .analyze();
  const severe = violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  await info.attach(`axe-${surface}`, {
    body: JSON.stringify({ viewport: page.viewportSize(), violations }, null, 2),
    contentType: "application/json",
  });
  expect(severe, `Serious/critical axe violations on ${surface}`).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

export async function fileMenu(page: Page, name: string) {
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
