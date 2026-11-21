// AUTHORED-BY Codex GPT-6
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { checkNative } from "../scripts/check-native.mjs";
import { addCsp, assertCspHashes, writeCsp } from "../scripts/csp-hashes.mjs";
import { nativeSettings } from "../scripts/native-settings.mjs";

const inline = 'self.__next_f.push([1,"Flight data"]);';
const html = `<html><head><script src="/_next/static/chunk.js" async></script><style>body{color:red}</style></head><body><script>${inline}</script><script>bootstrap()</script></body></html>`;
it("hashes every inline bootstrap and Flight script, ahead of all scripts", () => {
  const result = addCsp(html);
  const digest = createHash("sha256").update(inline).digest("base64");
  expect(result).toContain(`'sha256-${digest}'`);
  expect(result).toContain("https://localhost/_next/static/ capacitor://localhost/_next/static/");
  expect(result).toContain("frame-src 'none'");
  expect(result).toContain("img-src https://localhost capacitor://localhost");
  expect(result).not.toContain("'self'");
  expect(result).not.toContain("script-src 'unsafe-inline'");
  // Runtime-inserted <style> bodies cannot be hashed, so style elements are inline-allowed and
  // no style hash may appear (a hash would silently disable 'unsafe-inline').
  const styleSrc = /style-src ([^;]+)/.exec(result)?.[1] ?? "";
  expect(styleSrc).toContain("'unsafe-inline'");
  expect(styleSrc).not.toContain("sha256-");
  expect(result.indexOf("Content-Security-Policy")).toBeLessThan(result.indexOf("<script"));
  expect(() => assertCspHashes(result)).not.toThrow();
  expect(() => assertCspHashes(result.replace(`'sha256-${digest}'`, ""))).toThrow(
    "Missing inline-script CSP hash",
  );
  expect(() => assertCspHashes(result.replace("bootstrap()", "changed()"))).toThrow(
    "Missing inline-script CSP hash",
  );
});

it("rejects absent, duplicate or unsafe policies and missing HTML head", () => {
  expect(() => assertCspHashes(html)).toThrow("Missing Content-Security-Policy");
  expect(() => addCsp(addCsp(html))).toThrow("already exists");
  expect(() => addCsp("<html></html>")).toThrow("Missing HTML head");
  expect(() =>
    assertCspHashes(addCsp(html).replace("frame-src 'none'", "frame-src 'self'")),
  ).toThrow("Unsafe native CSP");
});

it.each([
  'data-src="bootstrap"',
  "x-src='bootstrap'",
  'data-note="src=bootstrap > still a value"',
  "data-src=bootstrap",
])("hashes inline scripts with %s and detects a removed hash", (attributes) => {
  const body = "window.booted = true;";
  const result = addCsp(`<html><head></head><script ${attributes}>${body}</script></html>`);
  const digest = createHash("sha256").update(body).digest("base64");
  expect(result).toContain(`'sha256-${digest}'`);
  expect(() => assertCspHashes(result.replace(`'sha256-${digest}'`, ""))).toThrow(
    "Missing inline-script CSP hash",
  );
});

it.each([
  "<script data-x=a'b>window.a=1</script>",
  '<script data-x=a"b>window.a=1</script>',
  "<script data-x=<b>window.a=1</script>",
])("fails closed on a script element the parser cannot read: %s", (element) => {
  expect(() => addCsp(`<html><head></head>${element}</html>`)).toThrow(
    "Unparseable script element",
  );
});

it.each([
  'SRC="/_next/static/a.js"',
  "src='/_next/static/a.js'",
  "src=/_next/static/a.js",
])("recognizes an exact external-script attribute %s", (attributes) => {
  const result = addCsp(`<html><head><script ${attributes}></script></head></html>`);
  expect(result).not.toContain("sha256-");
  expect(() => assertCspHashes(result)).not.toThrow();
});

it("checks all exported pages, fixture markers and the actual byte budget", async () => {
  const root = await mkdtemp(join(tmpdir(), "suite-csp-"));
  try {
    await writeFile(join(root, "index.html"), html);
    await writeFile(join(root, "404.html"), "<html><head></head><body>404</body></html>");
    await writeFile(join(root, "chunk.js"), "safe");
    await writeCsp(root);
    const output = await readFile(join(root, "index.html"), "utf8");
    expect(output).toContain("Content-Security-Policy");
    expect(await checkNative(root)).toBeGreaterThan(0);
    await expect(checkNative(root, 1)).rejects.toThrow("exceeds 40 MB");
    for (const marker of ["DEMO_", "dev/components"]) {
      await writeFile(join(root, "chunk.js"), marker);
      await expect(checkNative(root)).rejects.toThrow("Fixture marker");
    }
    await writeFile(join(root, "chunk.js"), "safe");
    await writeFile(join(root, "index.html"), html);
    await expect(checkNative(root)).rejects.toThrow("Missing Content-Security-Policy");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("bakes native target, local app origin, public URL and an https Client ID URL", () => {
  expect(nativeSettings({})).toEqual({
    target: "native",
    predecessorOrigins: ["https://solid-suite.vercel.app"],
    appBaseUrl: "https://localhost",
    publicSuiteUrl: "https://solid-suite.vercel.app",
    clientIdUrl: "https://solid-suite.vercel.app/.well-known/solid-client-id-mobile.jsonld",
  });
  expect(
    nativeSettings({
      APP_BASE_URL: "capacitor://localhost",
      PUBLIC_SUITE_URL: "https://suite.example/",
    }).clientIdUrl,
  ).toBe("https://suite.example/.well-known/solid-client-id-mobile.jsonld");
  expect(nativeSettings({ PUBLIC_SUITE_URL: "https://suite.example/" }).publicSuiteUrl).toBe(
    "https://suite.example",
  );
  expect(
    nativeSettings({ NEXT_PUBLIC_CLIENT_ID_URL: "https://identity.example/mobile" }).clientIdUrl,
  ).toBe("https://identity.example/mobile");
  for (const env of [
    { CLIENT_ID_URL: "http://suite.example/id" },
    { PUBLIC_SUITE_URL: "http://suite.example" },
    { APP_BASE_URL: "https://evil.example" },
  ])
    expect(() => nativeSettings(env)).toThrow();
});
