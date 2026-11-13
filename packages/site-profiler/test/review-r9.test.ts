// AUTHORED-BY Codex GPT-6.1-Sol
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Browser } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { launchChromium, profileSite } from "../src/profile.js";

let browser: Browser;
let origin: string;
const token = "demo-only-form-key-secret";
const site = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://fixture.test").pathname;
  res.setHeader("content-type", "text/html");
  if (path === "/demonstration-hidden")
    return res.end(`<input type="hidden" name="form_key" value="${token}"><h1>Example editor</h1>`);
  if (path === "/demonstration-meta")
    return res.end(`<meta name="form_key" content="${token}"><h1>Example editor</h1>`);
  if (req.method === "POST" && path === "/products/save") {
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ saved: true, message: token }));
  }
  res.end("<h1>Example shop</h1>");
});
beforeAll(async () => {
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  browser = await launchChromium();
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => site.close(() => resolve()));
});
it.each([
  "hidden",
  "meta",
])("r9 redacts every learned %s credential from standalone demonstration pages before returning traces", async (kind) => {
  const result = await profileSite({
    startUrl: origin,
    browser,
    maxPages: 1,
    verify: false,
    demonstrations: [
      {
        name: "save-own-example",
        async run(page) {
          await page.goto(`${origin}/demonstration-${kind}`);
          await page.evaluate(
            async ({ token }) => {
              await fetch("/products/save", {
                method: "POST",
                headers: { "content-type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                  "item[name]": "Example Widget 42",
                  "item[sku]": "EX-42",
                  form_key: token,
                }),
              });
            },
            { token },
          );
        },
      },
    ],
  });
  const write = result.model.operations.find((op) => op.request.method === "POST");
  expect(write?.csrf).toContainEqual({
    source:
      kind === "hidden"
        ? {
            kind: "html",
            urlTemplate: `${origin}/demonstration-hidden`,
            selector: 'input[name="form_key"]',
            attribute: "value",
          }
        : { kind: "meta", urlTemplate: `${origin}/demonstration-meta`, name: "form_key" },
    target: { kind: "form", name: "form_key" },
  });
  expect(
    result.trace.some(
      (r) => r.url.endsWith(`/demonstration-${kind}`) && r.bodySample?.includes("[redacted]"),
    ),
  ).toBe(true);
  expect(JSON.stringify(result.trace)).not.toContain(token);
  expect(JSON.stringify(result.warnings)).not.toContain(token);
});
