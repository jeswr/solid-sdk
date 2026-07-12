// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { describe, expect, it } from "vitest";
import {
  DCT_CREATED_IRI,
  DCT_MODIFIED_IRI,
  DCT_TITLE_IRI,
  DRAW,
  DRAW_SCENE,
  DRAW_SCENE_DOCUMENT,
  DRAW_SCENE_DOCUMENT_IRI,
  DRAW_SCENE_IRI,
  DRAW_SCHEMA_VERSION,
  DRAW_SCHEMA_VERSION_IRI,
  DRAW_THUMBNAIL,
  DRAW_THUMBNAIL_IRI,
  DRAW_VIEW_BACKGROUND_COLOR,
  DRAW_VIEW_BACKGROUND_COLOR_IRI,
  draw,
  PREFIXES,
  PROV_WAS_GENERATED_BY_IRI,
  SCHEMA_ABOUT_IRI,
  SCHEMA_CREATIVE_WORK_IRI,
} from "./vocab.js";

describe("vocab — minted draw: IRIs (must match the spec EXACTLY)", () => {
  it("the namespace base is the dereferenceable w3id.org/jeswr/drawing#", () => {
    expect(DRAW).toBe("https://w3id.org/jeswr/drawing#");
  });

  // The exact five IRIs the federation-vocab drawing# alignments reference.
  it.each([
    ["Scene", DRAW_SCENE_IRI],
    ["sceneDocument", DRAW_SCENE_DOCUMENT_IRI],
    ["schemaVersion", DRAW_SCHEMA_VERSION_IRI],
    ["viewBackgroundColor", DRAW_VIEW_BACKGROUND_COLOR_IRI],
    ["thumbnail", DRAW_THUMBNAIL_IRI],
  ])("draw:%s = w3id.org/jeswr/drawing#%s", (local, iri) => {
    expect(iri).toBe(`https://w3id.org/jeswr/drawing#${local}`);
    expect(draw(local)).toBe(iri);
  });

  it("mints EXACTLY five draw: terms (nothing extra crept in)", () => {
    const mintedIris = [
      DRAW_SCENE_IRI,
      DRAW_SCENE_DOCUMENT_IRI,
      DRAW_SCHEMA_VERSION_IRI,
      DRAW_VIEW_BACKGROUND_COLOR_IRI,
      DRAW_THUMBNAIL_IRI,
    ];
    const underDraw = mintedIris.filter((i) => i.startsWith(DRAW));
    expect(underDraw).toHaveLength(5);
    expect(new Set(mintedIris).size).toBe(5);
  });
});

describe("vocab — re-used standard IRIs (NOT minted under draw:)", () => {
  it.each([
    ["dct:title", DCT_TITLE_IRI, "http://purl.org/dc/terms/title"],
    ["dct:created", DCT_CREATED_IRI, "http://purl.org/dc/terms/created"],
    ["dct:modified", DCT_MODIFIED_IRI, "http://purl.org/dc/terms/modified"],
    ["schema:about", SCHEMA_ABOUT_IRI, "http://schema.org/about"],
    ["schema:CreativeWork", SCHEMA_CREATIVE_WORK_IRI, "http://schema.org/CreativeWork"],
    ["prov:wasGeneratedBy", PROV_WAS_GENERATED_BY_IRI, "http://www.w3.org/ns/prov#wasGeneratedBy"],
  ])("%s is the canonical re-used IRI, not minted", (_name, iri, expected) => {
    expect(iri).toBe(expected);
    expect(iri.startsWith(DRAW)).toBe(false);
  });
});

describe("vocab — typed NamedNode constants (rdf-js)", () => {
  it.each([
    [DRAW_SCENE, DRAW_SCENE_IRI],
    [DRAW_SCENE_DOCUMENT, DRAW_SCENE_DOCUMENT_IRI],
    [DRAW_SCHEMA_VERSION, DRAW_SCHEMA_VERSION_IRI],
    [DRAW_VIEW_BACKGROUND_COLOR, DRAW_VIEW_BACKGROUND_COLOR_IRI],
    [DRAW_THUMBNAIL, DRAW_THUMBNAIL_IRI],
  ])("is a NamedNode whose .value is the matching IRI string", (node, iri) => {
    expect(node.termType).toBe("NamedNode");
    expect(node.value).toBe(iri);
  });
});

describe("vocab — PREFIXES", () => {
  it("maps draw: to the minted namespace and includes the re-used vocabs", () => {
    expect(PREFIXES.draw).toBe(DRAW);
    expect(PREFIXES.dct).toBe("http://purl.org/dc/terms/");
    expect(PREFIXES.schema).toBe("http://schema.org/");
    expect(PREFIXES.prov).toBe("http://www.w3.org/ns/prov#");
  });
});
