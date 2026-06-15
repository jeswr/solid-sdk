// AUTHORED-BY Claude Opus 4.8
import { describe, expect, it } from "vitest";
import {
  errorMessage,
  formatDate,
  formatSender,
  formatSubject,
  safeHref,
} from "../../src/ui/format.js";

describe("formatSubject", () => {
  it("returns the raw subject when present", () => {
    expect(formatSubject("Hello")).toBe("Hello");
  });

  it("falls back to (no subject) for undefined", () => {
    expect(formatSubject(undefined)).toBe("(no subject)");
  });

  it("falls back to (no subject) for an empty string", () => {
    expect(formatSubject("")).toBe("(no subject)");
  });
});

describe("formatSender", () => {
  it("returns the raw sender when present", () => {
    expect(formatSender("https://alice.example/profile/card#me")).toBe(
      "https://alice.example/profile/card#me",
    );
  });

  it("falls back to (unknown sender) for undefined", () => {
    expect(formatSender(undefined)).toBe("(unknown sender)");
  });

  it("falls back to (unknown sender) for an empty string", () => {
    expect(formatSender("")).toBe("(unknown sender)");
  });
});

describe("formatDate", () => {
  it("returns an em-dash when the date is absent", () => {
    expect(formatDate(undefined)).toBe("—");
  });

  it("formats a date as YYYY-MM-DD HH:MM (UTC)", () => {
    expect(formatDate(new Date("2026-06-15T12:34:56Z"))).toBe("2026-06-15 12:34");
  });
});

describe("safeHref", () => {
  it("admits an http URL", () => {
    expect(safeHref("http://x.example/a")).toBe("http://x.example/a");
  });

  it("admits an https WebID", () => {
    expect(safeHref("https://alice.example/profile/card#me")).toBe(
      "https://alice.example/profile/card#me",
    );
  });

  it("admits a mailto URL", () => {
    expect(safeHref("mailto:alice@example.org")).toBe("mailto:alice@example.org");
  });

  it("rejects a javascript: scheme (XSS guard)", () => {
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
  });

  it("rejects a data: scheme", () => {
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBeUndefined();
  });

  it("rejects a non-URL bare token", () => {
    expect(safeHref("not a url")).toBeUndefined();
  });

  it("rejects undefined and empty", () => {
    expect(safeHref(undefined)).toBeUndefined();
    expect(safeHref("")).toBeUndefined();
  });
});

describe("errorMessage", () => {
  it("uses an Error's message", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("stringifies a non-Error thrown value", () => {
    expect(errorMessage("plain string")).toBe("plain string");
    expect(errorMessage(42)).toBe("42");
  });
});
