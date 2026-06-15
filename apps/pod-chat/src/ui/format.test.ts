// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Unit tests for the pure presentation helpers — every fallback branch, the
// invalid-Date guard, and the safeHref allowlist (the XSS-defence seam).

import { describe, expect, it } from "vitest";
import {
  errorMessage,
  formatAuthor,
  formatBody,
  formatDate,
  formatRoomName,
  safeHref,
} from "./format.js";

describe("formatRoomName", () => {
  it("returns the name when present", () => {
    expect(formatRoomName("General")).toBe("General");
  });
  it("falls back to the provided fallback when the name is empty", () => {
    expect(formatRoomName("", "general-abc.ttl")).toBe("general-abc.ttl");
    expect(formatRoomName(undefined, "general-abc.ttl")).toBe("general-abc.ttl");
  });
  it("falls back to (untitled room) when name and fallback are both empty", () => {
    expect(formatRoomName(undefined)).toBe("(untitled room)");
    expect(formatRoomName("", "")).toBe("(untitled room)");
  });
});

describe("formatBody", () => {
  it("returns the content when present", () => {
    expect(formatBody("hello")).toBe("hello");
  });
  it("falls back to (no content) when absent or empty", () => {
    expect(formatBody(undefined)).toBe("(no content)");
    expect(formatBody("")).toBe("(no content)");
  });
});

describe("formatAuthor", () => {
  it("returns the author when present", () => {
    expect(formatAuthor("https://alice.example/card#me")).toBe("https://alice.example/card#me");
  });
  it("falls back to (unknown sender) when absent or empty", () => {
    expect(formatAuthor(undefined)).toBe("(unknown sender)");
    expect(formatAuthor("")).toBe("(unknown sender)");
  });
});

describe("formatDate", () => {
  it("formats a valid date as YYYY-MM-DD HH:MM (locale-independent)", () => {
    expect(formatDate(new Date("2026-06-12T15:30:00Z"))).toBe("2026-06-12 15:30");
  });
  it("returns an em-dash for an absent date", () => {
    expect(formatDate(undefined)).toBe("—");
  });
  it("returns an em-dash for an invalid date (never throws)", () => {
    expect(formatDate(new Date("not-a-date"))).toBe("—");
  });
});

describe("safeHref", () => {
  it("admits http(s) and mailto IRIs", () => {
    expect(safeHref("https://alice.example/card#me")).toBe("https://alice.example/card#me");
    expect(safeHref("http://bob.example/")).toBe("http://bob.example/");
    expect(safeHref("mailto:alice@example.org")).toBe("mailto:alice@example.org");
  });
  it("rejects javascript: and data: schemes (XSS guard)", () => {
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBeUndefined();
  });
  it("rejects non-URL values and empties", () => {
    expect(safeHref("not a url")).toBeUndefined();
    expect(safeHref("_:b0")).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
    expect(safeHref("")).toBeUndefined();
  });
});

describe("errorMessage", () => {
  it("returns an Error's message", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });
  it("stringifies a non-Error value", () => {
    expect(errorMessage("plain string")).toBe("plain string");
    expect(errorMessage(42)).toBe("42");
  });
});
