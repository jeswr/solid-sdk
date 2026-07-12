// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it } from "vitest";
import { sameWebId } from "../src/login-controller.js";

describe("sameWebId", () => {
  it("is true for identical WebIDs (verbatim, fragment kept)", () => {
    expect(sameWebId("https://id.example/card#me", "https://id.example/card#me")).toBe(true);
  });
  it("tolerates only surrounding whitespace, not case or path", () => {
    expect(sameWebId("  https://id.example/me  ", "https://id.example/me")).toBe(true);
    // WebIDs are case-sensitive URLs — a host-case difference is NOT equal here
    // (this helper is intentionally strict; the auth seam uses the stricter check).
    expect(sameWebId("https://ID.example/me", "https://id.example/me")).toBe(false);
    expect(sameWebId("https://id.example/a#me", "https://id.example/b#me")).toBe(false);
  });
  it("fails closed on a missing side", () => {
    expect(sameWebId(null, "https://id.example/me")).toBe(false);
    expect(sameWebId("https://id.example/me", undefined)).toBe(false);
    expect(sameWebId("", "")).toBe(false);
  });
});
