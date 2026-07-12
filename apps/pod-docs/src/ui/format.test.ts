// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it } from "vitest";
import { displayTitle, errorMessage, formatModified } from "./format.js";

describe("displayTitle", () => {
  it("uses the title when present", () => {
    expect(displayTitle({ title: "My notes", name: "abc.ttl" })).toBe("My notes");
  });

  it("falls back to the name for an empty title", () => {
    expect(displayTitle({ title: "", name: "abc.ttl" })).toBe("abc.ttl");
  });

  it("falls back to the name for a whitespace-only title", () => {
    expect(displayTitle({ title: "   ", name: "abc.ttl" })).toBe("abc.ttl");
  });
});

describe("formatModified", () => {
  it("renders an ISO date for a valid timestamp", () => {
    expect(formatModified("2026-06-15T10:30:00.000Z")).toBe("2026-06-15");
  });

  it("returns an em dash for an absent timestamp", () => {
    expect(formatModified(undefined)).toBe("—");
  });

  it("returns an em dash for an unparseable timestamp", () => {
    expect(formatModified("not-a-date")).toBe("—");
  });
});

describe("errorMessage", () => {
  it("uses an Error's message", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("stringifies a non-Error value", () => {
    expect(errorMessage("plain string")).toBe("plain string");
  });
});
