// AUTHORED-BY Codex GPT-6.1-Sol
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import type {} from "./drive-preview-fixture";

let fixture: string;
test.beforeAll(async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("./drive-preview-fixture.tsx", import.meta.url))],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  fixture = result.outputFiles[0]?.text ?? "";
});

test.beforeEach(async ({ page }) => {
  // A private resource rejects ambient fetch; only the injected session can read it.
  await page.route("https://pod.example/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/") {
      await route.fulfill({ contentType: "text/html", body: "<!doctype html><body></body>" });
      return;
    }
    const allowed = route.request().headers()["x-test-session"];
    await route.fulfill({
      status: allowed ? 200 : 401,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>',
    });
  });
  await page.goto("https://pod.example/");
  await page.addScriptTag({ content: fixture });
});

for (const type of [
  "http://www.w3.org/2006/vcard/ns#Individual",
  "https://schema.org/MusicRecording",
  "https://schema.org/Photograph",
]) {
  test(`${type} reads private images through the session`, async ({ page }) => {
    expect(await page.evaluate(async () => (await fetch("/private.svg")).status)).toBe(401);
    await page.evaluate((type) => window.drivePreview.show(undefined, 0, type), type);
    const image = page.getByRole("img", { name: "Private artwork" });
    await expect(image).toHaveAttribute("src", /^blob:/);
    await expect(image).toHaveJSProperty("naturalWidth", 8);
    await expect(page.locator(".suite-raw-data")).toHaveCount(0);
    const first = await image.getAttribute("src");

    // Ordinary rerenders retain the resolver and the existing object URL.
    await page.evaluate((type) => window.drivePreview.show(undefined, 0, type, true), type);
    await expect(page.locator(".suite-raw-data")).toHaveCount(1);
    await expect(image).toHaveAttribute("src", first as string);
    expect(await page.evaluate(() => window.drivePreview.revoked)).not.toContain(first);

    await page.evaluate(() => window.drivePreview.close());
    await expect(image).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.drivePreview.revoked)).toContain(first);
    expect(await page.evaluate(() => window.drivePreview.requests.every((s) => s.aborted))).toBe(
      true,
    );
  });
}

test("replacing an image or session revokes the previous URL and reads again", async ({ page }) => {
  const reads: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "GET") reads.push(request.headers()["x-test-session"] ?? "anonymous");
  });
  await page.evaluate(() => window.drivePreview.show());
  const image = page.getByRole("img", { name: "Private artwork" });
  await expect(image).toHaveAttribute("src", /^blob:/);
  const first = await image.getAttribute("src");
  await page.evaluate(() => window.drivePreview.show("https://pod.example/other.svg"));
  await expect(image).not.toHaveAttribute("src", first as string);
  await expect(image).toHaveAttribute("src", /^blob:/);
  const second = await image.getAttribute("src");
  expect(second).not.toBe(first);
  expect(await page.evaluate(() => window.drivePreview.revoked)).toContain(first);
  await page.evaluate(() => window.drivePreview.show("https://pod.example/other.svg", 1));
  await expect(image).not.toHaveAttribute("src", second as string);
  await expect(image).toHaveAttribute("src", /^blob:/);
  expect(await image.getAttribute("src")).not.toBe(second);
  expect(await page.evaluate(() => window.drivePreview.revoked)).toContain(second);
  expect(reads).toContain("first");
  expect(reads).toContain("second");
  expect(reads).not.toContain("anonymous");
});

test("failed private reads retain the placeholder without an anonymous retry", async ({ page }) => {
  let requests = 0;
  await page.route("https://pod.example/denied.svg", async (route) => {
    requests++;
    expect(route.request().headers()["x-test-session"]).toBe("first");
    await route.fulfill({ status: 403 });
  });
  await page.evaluate(() => window.drivePreview.show("https://pod.example/denied.svg"));
  await expect(page.getByLabel("Image unavailable")).toBeVisible();
  await expect(page.getByRole("img")).toHaveCount(0);
  // StrictMode may start and abort an initial read before starting its replacement.
  expect(requests).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.drivePreview.revoked)).toEqual([]);
});
