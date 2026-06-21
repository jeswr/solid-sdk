// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import type { Quad } from "@rdfjs/types";
import { describe, expect, it } from "vitest";
import {
  buildScene,
  parseScene,
  parseSceneTtl,
  type SceneData,
  sceneSubject,
  serializeScene,
} from "./scene.js";
import {
  DCT_TITLE_IRI,
  DRAW_SCENE_DOCUMENT_IRI,
  DRAW_SCENE_IRI,
  DRAW_SCHEMA_VERSION_IRI,
  RDF_TYPE_IRI,
} from "./vocab.js";

const URL_ = "http://localhost:3000/alice/drawings/diagram.ttl";
const CANVAS = "http://localhost:3000/alice/drawings/diagram.excalidraw";
const THUMB = "http://localhost:3000/alice/drawings/diagram.png";
const ABOUT = "http://localhost:3000/alice/projects/roadmap#it";
const ACTIVITY = "http://localhost:3000/alice/activities/edit-1#it";

const FULL: SceneData = {
  sceneDocument: CANVAS,
  title: "System architecture",
  created: "2026-06-21T10:00:00.000Z",
  modified: "2026-06-21T11:30:00.000Z",
  schemaVersion: "2",
  viewBackgroundColor: "#ffffff",
  thumbnail: THUMB,
  about: ABOUT,
  wasGeneratedBy: ACTIVITY,
};

/** Quads of the scene subject, for assertions (the n3 Store is iterable). */
function subjectQuads(store: Iterable<Quad>): Quad[] {
  const subject = `${URL_}#it`;
  return [...store].filter((q) => q.subject.value === subject);
}

describe("buildScene — the n3 Store it produces", () => {
  it("stamps draw:Scene and the REQUIRED draw:sceneDocument link", () => {
    const store = buildScene(URL_, { sceneDocument: CANVAS });
    expect(sceneSubject(URL_).value).toBe(`${URL_}#it`);

    const quads = subjectQuads(store);
    const types = quads
      .filter((q) => q.predicate.value === RDF_TYPE_IRI)
      .map((q) => q.object.value);
    expect(types).toContain(DRAW_SCENE_IRI);

    const docs = quads.filter((q) => q.predicate.value === DRAW_SCENE_DOCUMENT_IRI);
    expect(docs).toHaveLength(1);
    expect(docs[0]?.object.termType).toBe("NamedNode");
    expect(docs[0]?.object.value).toBe(CANVAS);
  });

  it("omits absent optional fields (no empty triples)", () => {
    const store = buildScene(URL_, { sceneDocument: CANVAS });
    const titleQuads = subjectQuads(store).filter((q) => q.predicate.value === DCT_TITLE_IRI);
    expect(titleQuads).toHaveLength(0);
  });

  it("writes schemaVersion as a plain literal", () => {
    const store = buildScene(URL_, { sceneDocument: CANVAS, schemaVersion: "2" });
    const q = subjectQuads(store).find((x) => x.predicate.value === DRAW_SCHEMA_VERSION_IRI);
    expect(q?.object.termType).toBe("Literal");
    expect(q?.object.value).toBe("2");
  });
});

describe("serializeScene — n3.Writer output", () => {
  it("produces Turtle that uses the draw: prefix and the canvas link", async () => {
    const ttl = await serializeScene(URL_, FULL);
    expect(ttl).toContain("@prefix draw:");
    expect(ttl).toContain("draw:Scene");
    expect(ttl).toContain("draw:sceneDocument");
    expect(ttl).toContain("diagram.excalidraw");
  });
});

describe("round-trip — serialize (n3.Writer) → parse (@jeswr/fetch-rdf) → equal", () => {
  it("a fully-populated scene survives a Turtle round-trip", async () => {
    const ttl = await serializeScene(URL_, FULL);
    const parsed = await parseSceneTtl(URL_, ttl, "text/turtle");
    expect(parsed).toEqual(FULL);
  });

  it("a minimal scene (only the canvas link) survives a round-trip", async () => {
    const minimal: SceneData = { sceneDocument: CANVAS };
    const ttl = await serializeScene(URL_, minimal);
    const parsed = await parseSceneTtl(URL_, ttl, "text/turtle");
    expect(parsed).toEqual(minimal);
  });

  it("defaults a null content-type to text/turtle", async () => {
    const ttl = await serializeScene(URL_, FULL);
    const parsed = await parseSceneTtl(URL_, ttl, null);
    expect(parsed).toEqual(FULL);
  });

  it("round-trips through JSON-LD too (content-type dispatch)", async () => {
    const jsonld = JSON.stringify({
      "@id": `${URL_}#it`,
      "@type": DRAW_SCENE_IRI,
      [DRAW_SCENE_DOCUMENT_IRI]: { "@id": CANVAS },
      [DCT_TITLE_IRI]: "System architecture",
    });
    const parsed = await parseSceneTtl(URL_, jsonld, "application/ld+json");
    expect(parsed?.sceneDocument).toBe(CANVAS);
    expect(parsed?.title).toBe("System architecture");
  });
});

describe("parseScene — guards", () => {
  it("returns undefined when the subject is not a draw:Scene", async () => {
    const ttl = `<${URL_}#it> <${DRAW_SCENE_DOCUMENT_IRI}> <${CANVAS}> .`;
    const parsed = await parseSceneTtl(URL_, ttl, "text/turtle");
    expect(parsed).toBeUndefined();
  });

  it("returns undefined when a draw:Scene has NO draw:sceneDocument (invalid)", async () => {
    const ttl = `<${URL_}#it> a <${DRAW_SCENE_IRI}> ; <${DCT_TITLE_IRI}> "Orphan" .`;
    const parsed = await parseSceneTtl(URL_, ttl, "text/turtle");
    expect(parsed).toBeUndefined();
  });

  it("ignores a draw:sceneDocument whose object is a literal (must be an IRI)", async () => {
    const ttl = `<${URL_}#it> a <${DRAW_SCENE_IRI}> ; <${DRAW_SCENE_DOCUMENT_IRI}> "not-an-iri" .`;
    const parsed = await parseSceneTtl(URL_, ttl, "text/turtle");
    expect(parsed).toBeUndefined();
  });

  it("rejects a scene with TWO draw:sceneDocument links (cardinality, not first-wins)", async () => {
    // A malformed/hostile descriptor with two canvas links must NOT parse to a
    // valid scene that silently picks one — the SHACL shape is maxCount 1, and the
    // parser enforces the same rule so a viewer never opens an ambiguous /
    // attacker-chosen canvas. (roborev finding, scene.ts: exactly-one rule.)
    const other = "http://localhost:3000/alice/drawings/other.excalidraw";
    const ttl = `<${URL_}#it> a <${DRAW_SCENE_IRI}> ;
      <${DRAW_SCENE_DOCUMENT_IRI}> <${CANVAS}> , <${other}> .`;
    const parsed = await parseSceneTtl(URL_, ttl, "text/turtle");
    expect(parsed).toBeUndefined();
  });

  it("rejects when ONE draw:sceneDocument is an IRI and a second is a literal", async () => {
    const ttl = `<${URL_}#it> a <${DRAW_SCENE_IRI}> ;
      <${DRAW_SCENE_DOCUMENT_IRI}> <${CANVAS}> , "decoy" .`;
    const parsed = await parseSceneTtl(URL_, ttl, "text/turtle");
    expect(parsed).toBeUndefined();
  });

  it("parseScene works on a directly-built store's dataset", () => {
    const store = buildScene(URL_, FULL);
    const parsed = parseScene(URL_, store);
    expect(parsed).toEqual(FULL);
  });
});

describe("parseScene — optional fields enforce the SHACL contract (roborev finding)", () => {
  // The parser must mirror the bundled shape: every property is maxCount 1, the
  // timestamps are xsd:dateTime, and thumbnail/about/provenance are IRIs. A field
  // that would FAIL the shape is DROPPED — the result never reflects a value the
  // shape rejects.

  it('drops a dct:created that is NOT an xsd:dateTime (e.g. "yesterday")', async () => {
    const ttl = `
      @prefix draw: <https://w3id.org/jeswr/drawing#> .
      @prefix dct:  <http://purl.org/dc/terms/> .
      <#it> a draw:Scene ;
        draw:sceneDocument <${CANVAS}> ;
        dct:created "yesterday" .
    `;
    const parsed = await parseSceneTtl(URL_, ttl, "text/turtle");
    expect(parsed).toEqual({ sceneDocument: CANVAS });
    expect(parsed?.created).toBeUndefined();
  });

  it("keeps a dct:created that IS an xsd:dateTime", async () => {
    const ttl = `
      @prefix draw: <https://w3id.org/jeswr/drawing#> .
      @prefix dct:  <http://purl.org/dc/terms/> .
      @prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .
      <#it> a draw:Scene ;
        draw:sceneDocument <${CANVAS}> ;
        dct:created "2026-06-21T10:00:00.000Z"^^xsd:dateTime .
    `;
    const parsed = await parseSceneTtl(URL_, ttl, "text/turtle");
    expect(parsed?.created).toBe("2026-06-21T10:00:00.000Z");
  });

  it("drops a DUPLICATED optional field (maxCount 1) — two dct:title literals", async () => {
    const ttl = `
      @prefix draw: <https://w3id.org/jeswr/drawing#> .
      @prefix dct:  <http://purl.org/dc/terms/> .
      <#it> a draw:Scene ;
        draw:sceneDocument <${CANVAS}> ;
        dct:title "A" , "B" .
    `;
    const parsed = await parseSceneTtl(URL_, ttl, "text/turtle");
    expect(parsed).toEqual({ sceneDocument: CANVAS });
    expect(parsed?.title).toBeUndefined();
  });

  it("keeps a plain (xsd:string) dct:title", async () => {
    const ttl = `
      @prefix draw: <https://w3id.org/jeswr/drawing#> .
      @prefix dct:  <http://purl.org/dc/terms/> .
      <#it> a draw:Scene ;
        draw:sceneDocument <${CANVAS}> ;
        dct:title "My board" .
    `;
    const parsed = await parseSceneTtl(URL_, ttl, "text/turtle");
    expect(parsed?.title).toBe("My board");
  });

  it("drops a LANGUAGE-TAGGED dct:title (rdf:langString, not xsd:string per the shape)", async () => {
    const ttl = `
      @prefix draw: <https://w3id.org/jeswr/drawing#> .
      @prefix dct:  <http://purl.org/dc/terms/> .
      <#it> a draw:Scene ;
        draw:sceneDocument <${CANVAS}> ;
        dct:title "Mon tableau"@fr .
    `;
    const parsed = await parseSceneTtl(URL_, ttl, "text/turtle");
    expect(parsed).toEqual({ sceneDocument: CANVAS });
    expect(parsed?.title).toBeUndefined();
  });

  it("drops a NON-STRING-datatype dct:title (e.g. xsd:integer)", async () => {
    const ttl = `
      @prefix draw: <https://w3id.org/jeswr/drawing#> .
      @prefix dct:  <http://purl.org/dc/terms/> .
      @prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .
      <#it> a draw:Scene ;
        draw:sceneDocument <${CANVAS}> ;
        dct:title "42"^^xsd:integer .
    `;
    const parsed = await parseSceneTtl(URL_, ttl, "text/turtle");
    expect(parsed).toEqual({ sceneDocument: CANVAS });
    expect(parsed?.title).toBeUndefined();
  });

  it("drops TWO draw:thumbnail IRIs (maxCount 1), keeping the rest", async () => {
    const ttl = `
      @prefix draw: <https://w3id.org/jeswr/drawing#> .
      <#it> a draw:Scene ;
        draw:sceneDocument <${CANVAS}> ;
        draw:thumbnail <http://h/a.png> , <http://h/b.png> .
    `;
    const parsed = await parseSceneTtl(URL_, ttl, "text/turtle");
    expect(parsed).toEqual({ sceneDocument: CANVAS });
    expect(parsed?.thumbnail).toBeUndefined();
  });

  it("drops a draw:thumbnail that is a literal (must be an IRI)", async () => {
    const ttl = `
      @prefix draw: <https://w3id.org/jeswr/drawing#> .
      <#it> a draw:Scene ;
        draw:sceneDocument <${CANVAS}> ;
        draw:thumbnail "preview.png" .
    `;
    const parsed = await parseSceneTtl(URL_, ttl, "text/turtle");
    expect(parsed).toEqual({ sceneDocument: CANVAS });
    expect(parsed?.thumbnail).toBeUndefined();
  });

  it("drops a schema:about that is a literal (must be an IRI)", async () => {
    const ttl = `
      @prefix draw:   <https://w3id.org/jeswr/drawing#> .
      @prefix schema: <http://schema.org/> .
      <#it> a draw:Scene ;
        draw:sceneDocument <${CANVAS}> ;
        schema:about "not-an-iri" .
    `;
    const parsed = await parseSceneTtl(URL_, ttl, "text/turtle");
    expect(parsed).toEqual({ sceneDocument: CANVAS });
    expect(parsed?.about).toBeUndefined();
  });
});
