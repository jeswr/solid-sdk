// AUTHORED-BY Codex (GPT-6.1 Sol)
import { describe, expect, it } from "vitest";
import { formUrl } from "../src/apps/forms/lib/form-url";

describe("form URL contract", () => {
  it.each([
    "javascript:alert(1)",
    "data:text/plain,hello",
    "http://192.168.0.1/form",
    "http://author.example/form",
    "https://user@evil.example",
    "https://@evil.example",
    "https://:secret@evil.example",
    "/relative",
    "#fragment",
    "//author.example/form",
    "https:author.example/form",
    "https:/author.example",
    "https://author.example/has space",
    "https://author.example/\\evil",
    "https://",
    `https://author.example/${"x".repeat(4096)}`,
  ])("refuses %s", (value) => {
    expect(() => formUrl(value, false)).toThrow();
  });
  it("allows absolute HTTPS shape fragments and the exact length boundary", () => {
    expect(formUrl("https://author.example/form#shape", false).href).toBe(
      "https://author.example/form#shape",
    );
    const value = `https://author.example/${"x".repeat(4096 - "https://author.example/".length)}`;
    expect(formUrl(value, false).href).toHaveLength(4096);
  });
  it("allows HTTP only for development loopback", () => {
    for (const host of ["localhost", "127.0.0.1"]) {
      expect(formUrl(`http://${host}:3210/form#shape`, true).hostname).toBe(host);
      expect(() => formUrl(`http://${host}:3210/form#shape`, false)).toThrow();
    }
    expect(() => formUrl("http://localhost.evil.example/form", true)).toThrow();
    expect(() => formUrl("http://192.168.1.2/form", true)).toThrow();
  });
});
