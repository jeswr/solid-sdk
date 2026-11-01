// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  hostOf,
  monogramFor,
  safeHref,
  signUpTarget,
  toneAt,
  toneFor,
} from "../src/sign-in/index.js";

describe("sign-in presentation helpers", () => {
  it.each([
    ["Solid community", "S"],
    ["  alice  ", "A"],
    ["Élodie", "É"],
    ["🌱 Solid", "🌱"],
    ["", "?"],
    ["   ", "?"],
  ])("makes a monogram for %j", (name, expected) => {
    expect(monogramFor(name)).toBe(expected);
  });

  it("assigns stable colours from the theme token palette without depending on list order", () => {
    const issuers = Array.from({ length: 30 }, (_, i) => `https://provider-${i}.example/`);
    const tones = issuers.map(toneFor);
    expect([...issuers].reverse().map(toneFor).reverse()).toEqual(tones);
    expect(new Set(tones).size).toBeGreaterThan(1);
    for (const tone of [...tones, toneFor(""), toneFor("not a URL")]) {
      expect(tone).toMatch(/^var\(--app-(home|drive|docs|tasks|calendar|contacts)\)$/);
    }
  });

  it("gives the first six positions distinct app tones and repeats the palette in order", () => {
    const palette = ["home", "drive", "docs", "tasks", "calendar", "contacts"].map(
      (tone) => `var(--app-${tone})`,
    );
    expect(Array.from({ length: 18 }, (_, index) => toneAt(index))).toEqual([
      ...palette,
      ...palette,
      ...palette,
    ]);
  });

  it.each([
    ["https://provider.example/join", "https://provider.example/join"],
    ["http://localhost:3000/photo.png", "http://localhost:3000/photo.png"],
    ["  https://provider.example/join \n", "https://provider.example/join"],
    ["HTTPS://PROVIDER.EXAMPLE/help", "https://provider.example/help"],
  ])("accepts absolute HTTP(S) URLs: %j", (value, expected) => {
    expect(safeHref(value)).toBe(expected);
    expect(safeHref(value, true)).toBe(expected);
  });

  it.each([
    undefined,
    "",
    " \t\n",
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "java\nscript:alert(1)",
    "data:image/svg+xml,<svg/>",
    "blob:https://provider.example/image",
    "ftp://provider.example/image",
    "//evil.example/help",
    " //evil.example/help ",
    "/\\evil.example/help",
    "/\t/evil.example/help",
    "https://",
    "https://provider.exa mple/help",
    "https://provider.\nexample/help",
    "help/webid",
    "./help/webid",
    "../help/webid",
    "#webid",
    "?help=webid",
  ])("rejects unsafe or relative URLs even when local help paths are allowed: %j", (value) => {
    expect(safeHref(value)).toBeUndefined();
    expect(safeHref(value, true)).toBeUndefined();
  });

  it.each([
    "/",
    "/help/webid",
    "/help/webid?from=sign-in#about",
    "/help/%2Fwebid",
  ])("accepts a same-origin path only with explicit opt-in: %j", (value) => {
    expect(safeHref(value)).toBeUndefined();
    expect(safeHref(value, true)).toBe(value);
    expect(safeHref(`  ${value}  `, true)).toBe(value);
  });

  it.each([
    ["https://alice.example/profile/card#me", "alice.example"],
    ["http://localhost:3000/me", "localhost:3000"],
    ["https://user:password@alice.example/me", "alice.example"],
    ["not a URL", ""],
    ["", ""],
    ["https://", ""],
    ["javascript:alert(1)", ""],
  ])("reads a safe host for %j", (value, expected) => {
    expect(hostOf(value)).toBe(expected);
  });

  it("prefers the home provider's sign-up URL, then the first available one", () => {
    const provider = { id: "home", name: "Home", issuer: "https://home.example/" };
    expect(signUpTarget([])).toBeUndefined();
    expect(signUpTarget([provider])).toBeUndefined();
    expect(
      signUpTarget([
        { ...provider, signUpUrl: " " },
        { ...provider, id: "second", signUpUrl: "https://second.example/join" },
        { ...provider, id: "third", signUpUrl: "https://third.example/join" },
      ]),
    ).toBe("https://second.example/join");
    expect(signUpTarget([{ ...provider, signUpUrl: "https://home.example/join" }])).toBe(
      "https://home.example/join",
    );
    expect(
      signUpTarget([
        { ...provider, signUpUrl: "javascript:alert(1)" },
        { ...provider, id: "second", signUpUrl: " https://second.example/join " },
      ]),
    ).toBe("https://second.example/join");
    expect(signUpTarget([{ ...provider, signUpUrl: "/join" }])).toBeUndefined();
  });
});
