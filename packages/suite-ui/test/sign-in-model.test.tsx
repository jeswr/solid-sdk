// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { hostOf, monogramFor, signUpTarget, toneFor } from "../src/sign-in/model.js";

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
  });
});
