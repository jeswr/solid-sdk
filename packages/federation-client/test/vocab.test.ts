// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it } from "vitest";
import {
  ACL_MODES,
  accessModeName,
  FEDAPP,
  KNOWN_SECTOR_SLUGS,
  sectorIri,
  VALID_ACCESS_MODE_IRIS,
} from "../src/index.js";

describe("vocab helpers", () => {
  it("exposes the fedapp namespace", () => {
    expect(FEDAPP).toBe("https://w3id.org/jeswr/fed#");
  });

  it("maps the four acl modes to IRIs", () => {
    expect(ACL_MODES.Read).toBe("http://www.w3.org/ns/auth/acl#Read");
    expect(ACL_MODES.Control).toBe("http://www.w3.org/ns/auth/acl#Control");
    expect(VALID_ACCESS_MODE_IRIS.size).toBe(4);
  });

  it("round-trips access-mode IRI ↔ short name", () => {
    for (const [name, iri] of Object.entries(ACL_MODES)) {
      expect(accessModeName(iri)).toBe(name);
    }
    expect(accessModeName("https://example.com/unknown")).toBeUndefined();
  });

  it("builds sector IRIs from known slugs", () => {
    expect(sectorIri("identity")).toBe("https://w3id.org/jeswr/sectors/identity");
    expect(KNOWN_SECTOR_SLUGS).toContain("health");
  });
});
