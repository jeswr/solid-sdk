// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate

import { describe, expect, it } from "vitest";
import {
  FEDREG,
  MEMBERSHIP_STATUS,
  statusName,
  TRUSTED_STATUS,
  VALID_STATUS_IRIS,
} from "../src/vocab.js";

describe("vocab", () => {
  it("pins the fedreg namespace", () => {
    expect(FEDREG).toBe("https://jeswr.org/ns/fedreg#");
  });

  it("maps each status name to its fedreg IRI", () => {
    expect(MEMBERSHIP_STATUS.Active).toBe("https://jeswr.org/ns/fedreg#Active");
    expect(MEMBERSHIP_STATUS.Proposed).toBe("https://jeswr.org/ns/fedreg#Proposed");
    expect(MEMBERSHIP_STATUS.Suspended).toBe("https://jeswr.org/ns/fedreg#Suspended");
    expect(MEMBERSHIP_STATUS.Revoked).toBe("https://jeswr.org/ns/fedreg#Revoked");
  });

  it("VALID_STATUS_IRIS and statusName accept all four statuses in both namespaces", () => {
    expect(VALID_STATUS_IRIS.size).toBe(8);
    for (const [name, iri] of Object.entries(MEMBERSHIP_STATUS)) {
      const legacy = `https://w3id.org/jeswr/fedreg#${name}`;
      expect(VALID_STATUS_IRIS.has(iri)).toBe(true);
      expect(VALID_STATUS_IRIS.has(legacy)).toBe(true);
      expect(statusName(iri)).toBe(name);
      expect(statusName(legacy)).toBe(name);
    }
  });

  it.each([
    "https://jeswr.org/ns/fedreg#Bogus",
    "https://w3id.org/jeswr/fedreg#Bogus",
    "https://example.org/Active",
    "not-an-iri",
  ])("VALID_STATUS_IRIS and statusName reject unknown status %s", (iri) => {
    expect(VALID_STATUS_IRIS.has(iri)).toBe(false);
    expect(statusName(iri)).toBeUndefined();
  });

  it("only Active is a trusted (live) status", () => {
    expect(TRUSTED_STATUS.has("Active")).toBe(true);
    expect(TRUSTED_STATUS.has("Proposed")).toBe(false);
    expect(TRUSTED_STATUS.has("Suspended")).toBe(false);
    expect(TRUSTED_STATUS.has("Revoked")).toBe(false);
  });
});
