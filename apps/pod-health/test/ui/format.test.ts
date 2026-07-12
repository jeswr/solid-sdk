// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it } from "vitest";
import type { HealthEntry } from "../../src/entries.js";
import { entryIcon, errorMessage, formatDate, formatValue } from "../../src/ui/format.js";

function entry(kind: HealthEntry["kind"]): HealthEntry {
  return {
    iri: "https://x.example/e",
    kind,
    date: undefined,
    typeLabel: kind,
    value: undefined,
    unitCode: undefined,
    codeRef: undefined,
  };
}

describe("formatDate", () => {
  it("renders an ISO date for a valid Date", () => {
    expect(formatDate(new Date("2026-06-13T08:00:00Z"))).toBe("2026-06-13");
  });
  it("renders a dash for an absent date", () => {
    expect(formatDate(undefined)).toBe("—");
  });
  it("renders a dash for an invalid Date rather than 'Invalid Date'", () => {
    expect(formatDate(new Date("not-a-date"))).toBe("—");
  });
});

describe("formatValue", () => {
  it("renders a value with its unit code", () => {
    expect(formatValue(72, "/min")).toBe("72 /min");
  });
  it("renders a bare value when there is no unit", () => {
    expect(formatValue(42, undefined)).toBe("42");
  });
  it("groups large numbers locale-independently", () => {
    expect(formatValue(10000, "m")).toBe("10,000 m");
  });
  it("renders a dash for an absent value", () => {
    expect(formatValue(undefined, "/min")).toBe("—");
  });
  it("renders a dash for a NaN value", () => {
    expect(formatValue(Number.NaN, "/min")).toBe("—");
  });
});

describe("errorMessage", () => {
  it("uses an Error's message", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });
  it("returns a fixed generic message for a non-Error throw (never stringifies it)", () => {
    // A raw non-Error throw could carry health content — it must NOT be rendered.
    expect(errorMessage({ secret: "diagnosis" })).toBe("Could not load health records.");
  });
});

describe("entryIcon", () => {
  it("returns a distinct icon per kind", () => {
    const icons = (
      ["Record", "Observation", "Condition", "Medication", "Immunization", "Workout"] as const
    ).map((k) => entryIcon(entry(k)));
    // Six kinds → six distinct icons.
    expect(new Set(icons).size).toBe(6);
  });

  it("falls back to a bullet for an unknown kind", () => {
    // Force an out-of-union kind to exercise the defensive default branch.
    const unknown = { ...entry("Record"), kind: "Mystery" } as unknown as HealthEntry;
    expect(entryIcon(unknown)).toBe("•");
  });
});
