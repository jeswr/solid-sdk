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
    expect(FEDREG).toBe("https://w3id.org/jeswr/fedreg#");
  });

  it("maps each status name to its fedreg IRI", () => {
    expect(MEMBERSHIP_STATUS.Active).toBe("https://w3id.org/jeswr/fedreg#Active");
    expect(MEMBERSHIP_STATUS.Proposed).toBe("https://w3id.org/jeswr/fedreg#Proposed");
    expect(MEMBERSHIP_STATUS.Suspended).toBe("https://w3id.org/jeswr/fedreg#Suspended");
    expect(MEMBERSHIP_STATUS.Revoked).toBe("https://w3id.org/jeswr/fedreg#Revoked");
  });

  it("VALID_STATUS_IRIS holds exactly the four coded values", () => {
    expect(VALID_STATUS_IRIS.size).toBe(4);
    for (const iri of Object.values(MEMBERSHIP_STATUS)) {
      expect(VALID_STATUS_IRIS.has(iri)).toBe(true);
    }
  });

  it("statusName round-trips each known status IRI", () => {
    for (const [name, iri] of Object.entries(MEMBERSHIP_STATUS)) {
      expect(statusName(iri)).toBe(name);
    }
  });

  it("statusName returns undefined for an unknown IRI", () => {
    expect(statusName("https://w3id.org/jeswr/fedreg#Bogus")).toBeUndefined();
    expect(statusName("not-an-iri")).toBeUndefined();
  });

  it("only Active is a trusted (live) status", () => {
    expect(TRUSTED_STATUS.has("Active")).toBe(true);
    expect(TRUSTED_STATUS.has("Proposed")).toBe(false);
    expect(TRUSTED_STATUS.has("Suspended")).toBe(false);
    expect(TRUSTED_STATUS.has("Revoked")).toBe(false);
  });
});
