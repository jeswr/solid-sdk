// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate

import { describe, expect, it } from "vitest";
import { decodeBase64url, encodeBase64url } from "../../src/protocol/index.js";

describe("base64url", () => {
  it("round-trips ASCII", () => {
    expect(decodeBase64url(encodeBase64url("hello world"))).toBe("hello world");
  });

  it("round-trips UTF-8 (multi-byte)", () => {
    const s = "café — 日本語 — 🔐";
    expect(decodeBase64url(encodeBase64url(s))).toBe(s);
  });

  it("round-trips the empty string", () => {
    expect(decodeBase64url(encodeBase64url(""))).toBe("");
  });

  it("emits url-safe alphabet with no padding", () => {
    // A payload whose standard base64 contains + / and = padding.
    const token = encodeBase64url("<<<???>>>");
    expect(token).toMatch(/^[A-Za-z0-9_-]*$/);
    expect(token).not.toContain("=");
  });

  it("throws on illegal characters", () => {
    expect(() => decodeBase64url("has spaces!")).toThrow(/base64url/);
    expect(() => decodeBase64url("AAAA==")).toThrow(/base64url/);
  });

  it("throws on invalid UTF-8 byte sequences", () => {
    // 0xFF is never a valid standalone UTF-8 byte; base64url of a single 0xFF.
    expect(() => decodeBase64url("_w")).toThrow();
  });
});
