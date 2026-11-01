// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 4.8
//
// HONEST P0 FINDING — the fed-vocab bookmarks SECTOR profile diverges from the
// @jeswr/solid-bookmark package contract, so it cannot (today) drive generation of
// the package's tested model. The sector is a THIN Mode-A marker that explicitly
// defers the detailed `book:` vocabulary to the separate solid-bookmark repo; the
// pilot therefore generates from the package's OWN ontology + SHACL profile (which
// the sector aligns to), and this test documents the divergence the sector must
// close (the §4 ratchet) before it can drive package generation.
//
// Read the current workspace sector profile so this comparison cannot go stale.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { localName, parseShapes } from "../../src/index.js";

const sectorTtl = readFileSync(
  new URL("../../../solid-federation-vocab/sectors/bookmarks/bookmarks.shacl.ttl", import.meta.url),
  "utf8",
);
const shapes = parseShapes(sectorTtl, "https://jeswr.org/ns/sectors/bookmarks/shapes#");
const shape = shapes.nodeShapes[0];

describe("fed-vocab bookmarks SECTOR vs the solid-bookmark package contract", () => {
  it("uses a DIFFERENT target class IRI (sectors/bookmarks# vs bookmark#)", () => {
    expect(shape?.targetClass).toBe("https://jeswr.org/ns/sectors/bookmarks#Bookmark");
    expect(shape?.targetClass).not.toBe("https://jeswr.org/ns/bookmark#Bookmark");
  });

  it("models tags as bookmark:hasTag skos:Concept (IRI), NOT schema:keywords string literals", () => {
    const hasTag = shape?.properties.find((p) => p.pathIri.endsWith("hasTag"));
    expect(hasTag).toBeDefined();
    expect(hasTag?.kind).toBe("iri");
    expect(hasTag?.hasClass).toBe("http://www.w3.org/2004/02/skos/core#Concept");
    // The package instead reuses schema:keywords string literals.
    expect(shape?.properties.some((p) => p.pathIri === "http://schema.org/keywords")).toBe(false);
  });

  it("does NOT cover dct:created / dct:modified (the package's timestamps)", () => {
    const paths = new Set(shape?.properties.map((p) => p.pathIri));
    expect(paths.has("http://purl.org/dc/terms/created")).toBe(false);
    expect(paths.has("http://purl.org/dc/terms/modified")).toBe(false);
  });

  it("covers 6 properties (vs the package's 8) — the coverage gap the ratchet must close", () => {
    expect(shape?.properties).toHaveLength(6);
    expect(shape?.properties.map((p) => localName(p.pathIri)).sort()).toEqual([
      "archived",
      "description",
      "hasTag",
      "notes",
      "title",
      "url",
    ]);
  });
});

// The sector still lacks the package's http(s) URL policy and legacy read contract.
it("does not express the package's URL pattern or legacy type/predicate aliases", () => {
  expect(
    shape?.properties.find((p) => p.pathIri === "http://schema.org/url")?.pattern,
  ).toBeUndefined();
  expect(shape?.aliasTypeIris).toBeUndefined();
  expect(shape?.properties.every((p) => p.aliasPredicates === undefined)).toBe(true);
});
