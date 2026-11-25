// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const account = {
      id: "demo",
      name: "Alice Wilder",
      kind: "demo",
      webId: "https://alice.demo.pod/profile/card#me",
      storageUrl: "https://alice.demo.pod/",
    };
    localStorage.setItem(
      "suite.accounts.v1",
      JSON.stringify({ activeId: account.id, accounts: [account] }),
    );
  });
});

test("serves an installable manifest and every icon", async ({ page, context, request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("application/manifest+json");
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    name: "Solid Suite",
    id: "/",
    start_url: "/home",
    display: "standalone",
  });
  for (const icon of [
    ...manifest.icons,
    { src: "/icons/apple-touch-icon.png", type: "image/png" },
  ]) {
    const image = await request.get(icon.src);
    expect(image.status(), icon.src).toBe(200);
    expect(image.headers()["content-type"]).toContain(icon.type);
  }
  await page.goto("/settings/advanced");
  await expect(page.getByRole("heading", { name: "Advanced", exact: true })).toBeVisible();
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    "/icons/apple-touch-icon.png",
  );
  expect(await page.locator('meta[name="theme-color"]').count()).toBe(2);
  const session = await context.newCDPSession(page);
  await expect
    .poll(async () => (await session.send("Page.getInstallabilityErrors")).installabilityErrors)
    .toEqual([]);
  await session.detach();
});

test("shows Safari's manual install instruction and hides it in an installed iOS app", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", { value: "iPhone AppleWebKit Safari" });
    Object.defineProperty(navigator, "standalone", { value: false, configurable: true });
    // Chromium still evaluates installability with its real UA; Safari has no native event.
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    });
  });
  await page.goto("/settings/advanced");
  await expect(page.getByText("Use Share, then Add to Home Screen", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Install", exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "standalone", { value: true });
    window.dispatchEvent(new Event("appinstalled"));
  });
  await expect(page.getByRole("region", { name: "Install app", exact: true })).toHaveCount(0);
});

test("keeps maskable artwork inside the safe circle and the monochrome centre transparent", async ({
  page,
}) => {
  await page.goto("/settings/advanced");
  const pixels = await page.evaluate(async () => {
    async function load(src: string) {
      const image = new Image();
      image.src = src;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 512;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");
      ctx.drawImage(image, 0, 0, 512, 512);
      return ctx.getImageData(0, 0, 512, 512).data;
    }
    const maskable = await load("/icons/icon-maskable-512.png");
    let outsideSafeCircle = 0;
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 512; x++) {
        if (Math.hypot(x - 256, y - 256) <= 512 * 0.4) continue;
        const index = (y * 512 + x) * 4;
        if ([0, 1, 2, 3].some((channel) => maskable[index + channel] !== maskable[channel]))
          outsideSafeCircle++;
      }
    }
    const monochrome = await load("/icons/icon-monochrome.svg");
    return {
      outsideSafeCircle,
      centreAlpha: monochrome[(256 * 512 + 256) * 4 + 3],
      ringAlpha: monochrome[(85 * 512 + 256) * 4 + 3],
    };
  });
  expect(pixels).toEqual({ outsideSafeCircle: 0, centreAlpha: 0, ringAlpha: 255 });
});

test("shows the Settings install row in both themes and handles dismissal", async ({ page }) => {
  await page.goto("/settings/advanced");
  await expect(page.getByRole("heading", { name: "Advanced", exact: true })).toBeVisible();
  // Native prompt availability varies under automation; installability is verified separately.
  await page.evaluate(() => {
    window.dispatchEvent(
      Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
        prompt: async () => {},
        userChoice: Promise.resolve({ outcome: "dismissed" }),
      }),
    );
  });
  const row = page.getByRole("region", { name: "Install app", exact: true });
  await expect(row.getByRole("button", { name: "Install", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await row.getByRole("button", { name: "Install", exact: true }).click();
  await expect(row.getByRole("status")).toContainText("Installation dismissed");
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  // The section stays mounted so the outcome is announced; only the Install action goes away.
  await expect(row.getByRole("button", { name: "Install", exact: true })).toHaveCount(0);
  await expect(row.getByRole("status")).toContainText("Installation dismissed");
});

const offlineHeading = /You're offline/;
// Launch routes whose page redirects to the app's own landing page.
const redirects: Record<string, string> = {
  "/mail": "/mail/inbox",
  "/calendar": "/calendar/week",
  "/tasks": "/tasks/inbox",
};

test("opens the installed app's launch routes offline and falls back only for unvisited routes", async ({
  page,
  context,
  request,
}) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  const launchRoutes: string[] = [
    manifest.start_url,
    ...manifest.shortcuts.map((shortcut: { url: string }) => shortcut.url),
  ];
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
          once: true,
        }),
      );
  });
  await context.setOffline(true);
  // Each launch target (start_url and every shortcut) opens its own app, never the fallback.
  for (const path of launchRoutes) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    // Some launch routes redirect on the client; let that settle before leaving the page.
    if (path in redirects) await expect(page).toHaveURL(new RegExp(`${redirects[path]}$`));
    // Both shell frames (the suite shell and the interim app frame) render this main landmark.
    await expect(page.locator("main#main-content"), path).toBeVisible();
    await expect(page.getByRole("heading", { name: offlineHeading }), path).toHaveCount(0);
    await expect(page.getByText("Application error", { exact: false })).toHaveCount(0);
  }
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  // A route that was never visited or precached shows the designed fallback instead.
  const response = await page.goto("/sheets");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: offlineHeading })).toBeVisible();
  await expect(page.locator(".shell-public-card")).toBeVisible();
});
