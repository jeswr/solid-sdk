// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, it, vi } from "vitest";
import { nativeSettings } from "../scripts/native-settings.mjs";

afterEach(() => vi.unstubAllEnvs());

it.each([
  "PUBLIC_SUITE_URL",
  "NEXT_PUBLIC_PUBLIC_SUITE_URL",
])("rejects ambiguous or credential-bearing %s bases", (setting) => {
  for (const value of [
    "https://suite.example?x=y",
    "https://suite.example/#fragment",
    "https://suite.example/?",
    "https://suite.example/#",
    "https://user:password@suite.example/",
    "https://user@suite.example/",
  ])
    expect(() => nativeSettings({ [setting]: value })).toThrow("Public base URLs");
});

it.each([
  ["https://SUITE.example:443/", "https://suite.example"],
  ["https://suite.example/base///", "https://suite.example/base"],
])("bakes canonical navigation and identity URLs from %s", async (input, canonical) => {
  const settings = nativeSettings({ PUBLIC_SUITE_URL: input });
  expect(settings.publicSuiteUrl).toBe(canonical);
  expect(settings.clientIdUrl).toBe(`${canonical}/.well-known/solid-client-id-mobile.jsonld`);
  vi.stubEnv("NEXT_PUBLIC_PUBLIC_SUITE_URL", settings.publicSuiteUrl);
  vi.stubEnv("NEXT_PUBLIC_APP_BASE_URL", settings.appBaseUrl);
  vi.stubEnv("NEXT_PUBLIC_CLIENT_ID_URL", settings.clientIdUrl);
  vi.resetModules();
  const urls = await import("../src/lib/urls.ts");
  expect(`${urls.PUBLIC_SUITE_URL}/drive/my`).toBe(`${canonical}/drive/my`);
  expect(urls.CLIENT_ID_URL).toBe(`${canonical}/.well-known/solid-client-id-mobile.jsonld`);
  expect(`${urls.appBaseUrl()}/drive/my`).toBe("https://localhost/drive/my");
});

it("rejects invalid public bases in the web URL helper too", async () => {
  vi.stubEnv("NEXT_PUBLIC_PUBLIC_SUITE_URL", "https://suite.example?x=y");
  vi.resetModules();
  await expect(import("../src/lib/urls.ts")).rejects.toThrow("Public base URLs");
});

// AUTHORED-BY Claude Opus 5.5
it.each([
  "CLIENT_ID_URL",
  "NEXT_PUBLIC_CLIENT_ID_URL",
])("rejects an explicit %s with a fragment, userinfo or cleartext", (setting) => {
  for (const value of [
    "https://suite.example/id.jsonld#a",
    "https://suite.example/id.jsonld#",
    "https://user@suite.example/id.jsonld",
    "http://suite.example/id.jsonld",
  ])
    expect(() => nativeSettings({ [setting]: value })).toThrow("Client ID URLs");
});

it("rejects an invalid explicit Client ID URL in the web URL helper too", async () => {
  vi.stubEnv("NEXT_PUBLIC_CLIENT_ID_URL", "https://suite.example/id.jsonld#a");
  vi.resetModules();
  await expect(import("../src/lib/urls.ts")).rejects.toThrow("Client ID URLs");
});

it("bakes a deduplicated predecessor plan and defaults to the public deployed origin", () => {
  expect(nativeSettings({}).predecessorOrigins).toEqual(["https://solid-suite.vercel.app"]);
  expect(
    nativeSettings({ PUBLIC_SUITE_URL: "https://suite.example/base" }).predecessorOrigins,
  ).toEqual(["https://suite.example"]);
  expect(
    nativeSettings({
      PREDECESSOR_ORIGINS: JSON.stringify([
        "https://old.example",
        "https://other.example:8443",
        "https://old.example",
      ]),
    }).predecessorOrigins,
  ).toEqual(["https://old.example", "https://other.example:8443"]);
  expect(nativeSettings({ PREDECESSOR_ORIGINS: "[]" }).predecessorOrigins).toEqual([]);
});
it.each([
  null,
  true,
  {},
  "https://old.example",
  [null],
  [1],
  [true],
  ["https://old.example", "http://evil.example"],
  ["https://old.example/"],
  ["https://old.example/path"],
  ["https://u:p@old.example"],
  ["https://old.example?"],
  ["https://old.example#"],
  ["https://localhost"],
  ["capacitor://localhost"],
  ["https://localhost:443"],
  ["https://old.example:0"],
  ["https://old.example:65536"],
  ["https://OLD.example"],
  ["https://old.example/../"],
  ["https://old.example\\evil"],
])("rejects hostile predecessor settings %#", (value) => {
  expect(() => nativeSettings({ PREDECESSOR_ORIGINS: JSON.stringify(value) })).toThrow(
    "PREDECESSOR_ORIGINS",
  );
});
it("rejects malformed predecessor JSON", () => {
  expect(() => nativeSettings({ PREDECESSOR_ORIGINS: "[" })).toThrow();
});
