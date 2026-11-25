// AUTHORED-BY Codex GPT-6.1-Sol
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Browser } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { launchChromium, profileSite } from "../src/profile.js";
import { discoverCredentialSources, redactTrace } from "../src/session-tokens.js";

let browser: Browser;
let origin: string;
const token = "demo-only-form-key-secret";
it("retains traces and item identities for a one-character HttpOnly cookie check, while redacting a six-character session", () => {
  const { secrets } = discoverCredentialSources(
    [],
    [
      { name: "_cookie_check", value: "1", httpOnly: true },
      { name: "session", value: "Ab7xQ2", httpOnly: true },
    ],
  );
  expect(secrets.has("1")).toBe(false);
  expect(secrets.has("Ab7xQ2")).toBe(true);
  const trace = redactTrace(
    [
      {
        seq: 0,
        phase: "crawl",
        method: "GET",
        url: "https://shop.test/items/1",
        resourceType: "document",
        requestHeaders: {},
        cookieNames: ["_cookie_check", "session"],
        bodySample: '<article id="1">item 1 Ab7xQ2</article>',
      },
    ],
    secrets,
  );
  expect(trace[0]?.url).toBe("https://shop.test/items/1");
  expect(trace[0]?.bodySample).toBe('<article id="1">item 1 [redacted]</article>');
  expect(JSON.stringify(trace)).not.toContain("samples suppressed");
});
const site = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://fixture.test").pathname;
  res.setHeader("content-type", "text/html");
  if (path === "/rotate") {
    res.setHeader("set-cookie", "ordinary=second-cookie-secret; HttpOnly; Path=/");
    return res.end("rotated");
  }
  if (path === "/rotated-cookie") {
    res.setHeader("set-cookie", "ordinary=%22first-cookie-secret%22; HttpOnly; Path=/");
    return res.end('<script>fetch("/rotate")</script><p>first-cookie-secret</p>');
  }
  if (path === "/encoded-secrets") {
    res.setHeader("set-cookie", [
      "sid=%22quoted-cookie-secret%22; Path=/; HttpOnly",
      "preference=1; Path=/",
    ]);
    return res.end(
      '<script>fetch("/blocked?csrf=%63srf+one%20two+secret&cookie=quoted-cookie-secret", {method:"POST"}).catch(()=>{});</script><input type="hidden" name="form_key" value="demo-only-form-key-secret"><meta name="csrf-token" content="csrf one two secret"><p>demo&#45;only&#45;form&#45;key&#45;secret %63srf+one%20two+secret quoted-cookie-secret</p>',
    );
  }
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

it("r10 redacts entity, mixed-form and logical cookie echoes from profiler traces and warnings", async () => {
  const result = await profileSite({
    startUrl: `${origin}/encoded-secrets`,
    browser,
    maxPages: 1,
    verify: false,
    demonstrations: [
      {
        name: "block-own-secret-probe",
        async run(page) {
          await page.goto(`${origin}/encoded-secrets`);
          // A blocked write attempt contributes a warning containing the encoded echo.
          await page.evaluate(async () => {
            await fetch("/blocked?csrf=%63srf+one%20two+secret&cookie=quoted-cookie-secret", {
              method: "POST",
            }).catch(() => undefined);
          });
        },
      },
    ],
  });
  const traces = JSON.stringify(result.trace),
    warnings = JSON.stringify(result.warnings);
  expect(traces).toContain("[redacted]");
  expect(warnings).toContain("[redacted]");
  for (const surface of [traces, warnings]) {
    expect(surface).not.toMatch(
      /demo(?:&#45;|-)only(?:&#45;|-)form(?:&#45;|-)key(?:&#45;|-)secret|%63srf|csrf one two secret|quoted-cookie-secret/,
    );
  }
});

it("r10 retains logical cookie secrets rotated before the final browser jar is read", async () => {
  const result = await profileSite({
    startUrl: `${origin}/rotated-cookie`,
    browser,
    maxPages: 1,
    verify: false,
  });
  expect(JSON.stringify(result.trace)).not.toContain("first-cookie-secret");
  expect(JSON.stringify(result.trace)).not.toContain("second-cookie-secret");
  expect(JSON.stringify(result.trace)).toContain("[redacted]");
});
