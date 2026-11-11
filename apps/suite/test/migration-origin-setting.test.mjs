// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { nativeSettings } from "../scripts/native-settings.mjs";

it("bakes the public remote origin by default without changing production URLs", () => {
  expect(nativeSettings({})).toEqual({
    target: "native",
    appBaseUrl: "https://localhost",
    publicSuiteUrl: "https://solid-suite.vercel.app",
    clientIdUrl: "https://solid-suite.vercel.app/.well-known/solid-client-id-mobile.jsonld",
    predecessorOrigins: ["https://solid-suite.vercel.app"],
  });
  expect(
    nativeSettings({ PUBLIC_SUITE_URL: "https://suite.example/base" }).predecessorOrigins,
  ).toEqual(["https://suite.example"]);
});

it("deduplicates explicit predecessor origins and allows an intentional empty list", () => {
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
  "http://old.example",
  "capacitor://localhost",
  "https://localhost",
  "https://a.localhost",
  "https://old.example/",
  "https://old.example/path",
  "https://old.example/../",
  "https://old.example?",
  "https://old.example#",
  "https://user@old.example",
  "https://user:secret@old.example",
  " https://old.example",
  "https://old.example\n",
  "https://old.example\\path",
  "https://OLD.example",
  "https://old.example:443",
  "https://old.example:0",
  "https://old.example:65536",
  "file:///etc/passwd",
  "",
  null,
  1,
  {},
])("rejects the entire plan containing hostile entry %j", (entry) => {
  expect(() =>
    nativeSettings({ PREDECESSOR_ORIGINS: JSON.stringify(["https://valid.example", entry]) }),
  ).toThrow();
});

it.each([
  "",
  "{",
  "null",
  "{}",
  '"https://old.example"',
  JSON.stringify(Array(33).fill("https://old.example")),
])("rejects malformed or unbounded setting %s", (setting) => {
  expect(() => nativeSettings({ PREDECESSOR_ORIGINS: setting })).toThrow();
});
