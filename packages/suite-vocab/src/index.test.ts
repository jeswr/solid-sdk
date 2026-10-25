// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { canonicalize, isLegacy, LEGACY_NAMESPACES, NS, termsEqual } from "./index.js";

describe("namespace aliases", () => {
  it.each(Object.entries(LEGACY_NAMESPACES))("canonicalizes %s", (legacy, canonical) => {
    for (const suffix of ["", "Document", "SomeLocalName"]) {
      expect(canonicalize(legacy + suffix)).toBe(canonical + suffix);
      expect(isLegacy(legacy + suffix)).toBe(true);
      expect(isLegacy(canonical + suffix)).toBe(false);
      expect(canonicalize(canonical + suffix)).toBe(canonical + suffix);
      expect(termsEqual(legacy + suffix, canonical + suffix)).toBe(true);
    }
  });

  it.each([
    "",
    "urn:example:Document",
    "https://example.org/ns#Document",
    "https://w3id.org/jeswr.evil/core#Person",
    "https://w3id.org/jeswrish/core#Person",
    "http://schema.org.evil/Thing",
    "https://TBD.example/solid/healthcare#Thing",
    "https://w3id.org/agent-description#Agent",
  ])("preserves unknown IRI %s", (iri) => {
    expect(canonicalize(iri)).toBe(iri);
    expect(isLegacy(iri)).toBe(false);
  });

  it("preserves nested paths and version IRIs under the legacy suite root", () => {
    expect(canonicalize("https://w3id.org/jeswr/sectors/health/diet#Meal")).toBe(
      `${NS.HEALTH_DIET}Meal`,
    );
    expect(canonicalize("https://w3id.org/jeswr/core/1.0.0")).toBe(
      "https://jeswr.org/ns/core/1.0.0",
    );
  });

  it("compares terms symmetrically without conflating local names", () => {
    expect(termsEqual(`${NS.SCHEMA}Event`, "http://schema.org/Event")).toBe(true);
    expect(termsEqual(`${NS.SCHEMA}Event`, "http://schema.org/event")).toBe(false);
    expect(termsEqual("urn:a", "urn:b")).toBe(false);
    expect(NS.FEDCON).toBe("https://jeswr.org/fedcon#");
  });
});
