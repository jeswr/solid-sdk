// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  FALLBACK_BRAND_COLORS,
  foregroundFor,
  hostOf,
  monogramFor,
  PROVIDER_BRANDS,
  providerBrandFor,
  relativeLuminance,
  safeHref,
  signUpTarget,
  toneAt,
  toneFor,
  validColor,
} from "../src/sign-in/index.js";

describe("sign-in presentation helpers", () => {
  it("calculates WCAG luminance and symmetric contrast from known reference values", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBe(1);
    expect(relativeLuminance("#ff0000")).toBeCloseTo(0.2126, 8);
    expect(relativeLuminance("#00ff00")).toBeCloseTo(0.7152, 8);
    expect(relativeLuminance("#0000ff")).toBeCloseTo(0.0722, 8);
    expect(relativeLuminance("#080808")).toBeCloseTo(8 / 255 / 12.92, 8);
    expect(contrastRatio("#000000", "#ffffff")).toBe(21);
    expect(contrastRatio("#ffffff", "#000000")).toBe(21);
    expect(contrastRatio("#7c4dff", "#ffffff")).toBeCloseTo(4.813678, 5);
    expect(contrastRatio("#abcdef", "#abcdef")).toBe(1);
    expect(() => relativeLuminance("red")).toThrow(TypeError);
  });

  it("chooses white only when it reaches the 4.5:1 threshold", () => {
    expect(foregroundFor("#000000")).toBe("#ffffff");
    expect(foregroundFor("#ffffff")).toBe("#111111");
    expect(foregroundFor("#767676")).toBe("#ffffff");
    expect(foregroundFor("#777777")).toBe("#111111");
    expect(foregroundFor("#F5A623")).toBe("#111111");
  });

  it("accepts only a literal six-digit RGB colour", () => {
    for (const value of [
      undefined,
      "",
      "red",
      "#123",
      "#11223344",
      "#12345g",
      " #112233",
      "#112233\n",
      "var(--primary)",
    ]) {
      expect(validColor(value)).toBeUndefined();
    }
    expect(validColor("#Ab12EF")).toBe("#Ab12EF");
  });

  it("gives every registry and fallback colour at least 4.5:1 text contrast", () => {
    expect(Object.keys(PROVIDER_BRANDS)).toEqual([
      "https://solidcommunity.net",
      "https://login.inrupt.com",
      "https://solidweb.org",
      "https://teamid.live",
    ]);
    expect(FALLBACK_BRAND_COLORS).toHaveLength(6);
    expect(new Set(FALLBACK_BRAND_COLORS).size).toBe(6);
    for (const color of [
      ...Object.values(PROVIDER_BRANDS).map((brand) => brand.color),
      ...FALLBACK_BRAND_COLORS,
    ]) {
      expect(contrastRatio(color, foregroundFor(color))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("looks up brands by origin, preserves logos on colour override and resists lookalike hosts", () => {
    expect(
      providerBrandFor({ issuer: "https://SOLIDCOMMUNITY.NET:443/issuer?foo=bar#fragment" }),
    ).toEqual(PROVIDER_BRANDS["https://solidcommunity.net"]);
    expect(providerBrandFor({ issuer: "https://login.inrupt.com/oidc", color: "#AABBCC" })).toEqual(
      { ...PROVIDER_BRANDS["https://login.inrupt.com"], color: "#AABBCC" },
    );
    expect(providerBrandFor({ issuer: "https://solidcommunity.net/", color: "red" }).color).toBe(
      "#7C4DFF",
    );
    for (const issuer of [
      "https://solidcommunity.net.evil.example/",
      "https://solidcommunity.net:8080/",
      "http://solidcommunity.net/",
      "https://solidcommunity.net@evil.example/",
      "not a URL",
      "__proto__",
      "constructor",
      "toString",
      "",
    ]) {
      const brand = providerBrandFor({ issuer });
      expect(brand.Logo).toBeUndefined();
      expect(FALLBACK_BRAND_COLORS).toContain(brand.color);
    }
  });

  it("hashes unknown issuer origins stably across paths and reordering using all six colours", () => {
    const issuers = Array.from({ length: 30 }, (_, i) => `https://provider-${i}.example`);
    const colors = issuers.map((issuer) => providerBrandFor({ issuer }).color);
    expect(
      [...issuers]
        .reverse()
        .map((issuer) => providerBrandFor({ issuer: `${issuer}/oidc` }).color)
        .reverse(),
    ).toEqual(colors);
    expect(new Set(colors).size).toBe(6);
    for (const color of colors) expect(FALLBACK_BRAND_COLORS).toContain(color);
  });

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
