// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { serveExport } from "./server.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const origin = "https://localhost";
const ref = (folder) => Buffer.from(`https://native-browser.pod/${folder}/`).toString("base64url");
const href = (folder) => `/drive/f/${ref(folder)}/`;
// One Playwright version drives both the browser and the assertions.
const browser = await chromium.launch();

async function run(directory, exercise, expectedViolations = []) {
  const server = await serveExport(directory);
  const context = await browser.newContext({ serviceWorkers: "block" });
  const violations = [];
  const errors = [];
  const consoleErrors = [];
  const external = [];
  try {
    // Keep the real native origin and CSP byte-for-byte. Only the TCP transport is proxied.
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) {
        external.push(url.href);
        return route.abort();
      }
      const response = await fetch(`${server.url}${url.pathname}${url.search}`, {
        method: request.method(),
        headers: request.headers(),
        body: request.postDataBuffer() ?? undefined,
      });
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(
          [...response.headers].filter(
            ([name]) =>
              !["connection", "keep-alive", "transfer-encoding", "content-length"].includes(name),
          ),
        ),
        body: Buffer.from(await response.arrayBuffer()),
      });
    });
    await context.exposeFunction("recordCspViolation", (event) => violations.push(event));
    await context.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (event) => {
        window.recordCspViolation({
          directive: event.effectiveDirective,
          blocked: event.blockedURI,
        });
      });
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    // Hydration mismatches and recoverable React errors surface only on the console. CSP
    // reports and failed loads also log there; they are asserted through the violation events
    // and the server's request log instead.
    page.on("console", (message) => {
      const text = message.text();
      if (
        message.type() === "error" &&
        !text.includes("Content Security Policy") &&
        !text.startsWith("Failed to load resource")
      )
        consoleErrors.push(text);
    });
    await exercise(page, server.requests);
    // Allow queued policy events to cross the exposed binding before asserting the report.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    expect(external, "no external network requests").toEqual([]);
    expect(errors, "no browser startup/navigation errors").toEqual([]);
    expect(consoleErrors, "no console errors (hydration, recoverable React errors)").toEqual([]);
    // The server sends the policy as a header as well as the page's meta tag, so the browser
    // enforces two identical policies and reports each violation once per policy.
    expect(
      [...new Set(violations.map(({ directive }) => directive))],
      "exactly the expected violations under the final export CSP",
    ).toEqual(expectedViolations);
  } finally {
    await context.close();
    await server.close();
  }
}

try {
  await run(`${root}www`, async (page) => {
    await page.goto(`${origin}${href("alpha")}`);
    await expect(page.getByRole("heading", { name: "Sign in to open your Drive" })).toBeVisible();
    // The theme bootstrap adds this class; it is absent from the exported HTML.
    await expect(page.locator("html")).toHaveClass(/\b(light|dark)\b/);
    expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
  });
  console.log("PASS production export: cold deep link and startup under final CSP");

  // Positive control: the violation listener must report what the policy blocks.
  await run(
    `${root}www`,
    async (page) => {
      await page.goto(`${origin}${href("alpha")}`);
      await expect(page.getByRole("heading", { name: "Sign in to open your Drive" })).toBeVisible();
      await page.evaluate(() => {
        const script = document.createElement("script");
        script.textContent = "window.unhashed = true;";
        document.head.append(script);
      });
      await expect.poll(() => page.evaluate(() => window.unhashed === true)).toBe(false);
    },
    ["script-src-elem"],
  );
  console.log("PASS control: an unhashed inline script is blocked and reported");

  // Same build pipeline, isolated fixture session + page-local observations. www stays untouched.
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/build-native.mjs", "--browser-test"], {
      cwd: root,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Browser fixture export exited ${code}`)),
    );
  });
  await run(`${root}.native-stage/browser/www`, async (page, requests) => {
    // Next's Link prefetch also fetch()es each target's HTML, so counting .html responses
    // at the server cannot tell a prefetch from a reload. Count main-frame navigations.
    let navigations = 0;
    page.on("request", (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations += 1;
    });
    await page.goto(`${origin}${href("alpha")}`);
    await expect(page.getByTestId("route-ref")).toHaveText(ref("alpha"));
    await expect(page.getByRole("heading", { name: "alpha", exact: true })).toBeVisible();
    await page.getByLabel("Route state", { exact: true }).fill("retained across siblings");
    await page.evaluate(() => {
      window.documentToken = "same document";
    });
    expect(navigations, "the cold deep link is one document load").toBe(1);

    await page.getByRole("link", { name: "Open beta", exact: true }).click();
    await expect(page).toHaveURL(`${origin}${href("beta")}`);
    await expect(page.getByTestId("route-ref")).toHaveText(ref("beta"));
    await expect(page.getByRole("heading", { name: "beta", exact: true })).toBeVisible();
    await expect(page.getByLabel("Route state", { exact: true })).toHaveValue(
      "retained across siblings",
    );
    expect(
      requests.some(
        (request) =>
          request.rawPath.includes(ref("beta")) &&
          request.path.endsWith(".txt") &&
          request.status === 200,
      ),
    ).toBe(true);

    const beforePrefetch = requests.length;
    await page.getByRole("button", { name: "Prefetch gamma", exact: true }).click();
    await expect
      .poll(
        () =>
          requests
            .slice(beforePrefetch)
            .filter(
              (request) =>
                request.rawPath.includes(ref("gamma")) &&
                request.path.endsWith(".txt") &&
                request.status === 200,
            ).length,
      )
      .toBeGreaterThan(0);
    await page.getByRole("button", { name: "Push gamma", exact: true }).click();
    await expect(page).toHaveURL(`${origin}${href("gamma")}`);
    await expect(page.getByTestId("route-ref")).toHaveText(ref("gamma"));
    await expect(page.getByRole("heading", { name: "gamma", exact: true })).toBeVisible();
    await expect(page.getByLabel("Route state", { exact: true })).toHaveValue(
      "retained across siblings",
    );
    await page.goBack();
    await expect(page.getByTestId("route-ref")).toHaveText(ref("beta"));
    await page.goForward();
    await expect(page.getByTestId("route-ref")).toHaveText(ref("gamma"));
    await expect(page.getByLabel("Route state", { exact: true })).toHaveValue(
      "retained across siblings",
    );
    expect(await page.evaluate(() => window.documentToken)).toBe("same document");
    expect(navigations, "client navigation must use Flight without document reloads").toBe(1);
    // Every request the exercised routes need succeeds. Prefetches of other rail targets are
    // out of scope here: /docs has no route yet on web or native and 404s on both.
    expect(
      requests.filter(
        (request) =>
          request.status !== 200 &&
          (request.rawPath.startsWith("/_next/") || request.rawPath.startsWith("/drive/f/")),
      ),
    ).toEqual([]);
    // The navigation sheet mounts Radix's scroll lock, which inserts a runtime <style>.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).overflow))
      .toBe("hidden");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Navigation" })).toBeHidden();
  });
  console.log(
    "PASS fixture export: cold deep link, Link, router.push, prefetch, sibling state, back/forward, scroll-locked sheet, final CSP",
  );
} finally {
  await browser.close();
}
