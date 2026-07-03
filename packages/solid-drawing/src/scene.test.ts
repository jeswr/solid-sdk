// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import type { Quad } from "@rdfjs/types";
import { Parser } from "n3";
import { describe, expect, it } from "vitest";
import { escapeIri, safeHttpIri, safeSubjectBaseIri } from "./iri.js";
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

describe("IRI-injection hardening (n3.Writer does NOT escape IRIs)", () => {
  // The payload closes the `<…>` IRI-ref early with `>`, then supplies a full
  // extra triple; if the field reached namedNode() unescaped, n3.Writer would emit
  // it verbatim and the re-parsed graph would contain the injected `<https://evil/s2>`
  // subject. safeHttpIri neutralises it (URL parse percent-encodes `> " space`).
  const Injection = "https://evil/x> . <https://evil/s2> <https://evil/p2> <https://evil/o2";
  const InjectedSubject = "https://evil/s2";

  it("neutralises an injection payload in an OPTIONAL field (schema:about) — no extra triples", async () => {
    const ttl = await serializeScene(URL_, { sceneDocument: CANVAS, about: Injection });

    // Re-parse the serialised Turtle and assert the attacker's triple is absent. The
    // payload's host is `evil`, so the rest ("> . <https://evil/s2> …") is percent-
    // encoded INTO the path by URL — a single safe object IRI, never a new subject.
    const quads = new Parser({ baseIRI: URL_ }).parse(ttl);
    const injected = quads.filter(
      (q) => q.subject.value === InjectedSubject || q.object.value === InjectedSubject,
    );
    expect(injected).toHaveLength(0);
    // Every triple in the whole document must still be rooted at the scene subject —
    // a raw payload would have introduced the injected `<https://evil/s2>` subject.
    expect(quads.every((q) => q.subject.value === `${URL_}#it`)).toBe(true);
    // The about value survives only in fully-encoded, break-out-free form.
    const aboutQuad = quads.find((q) => q.predicate.value === "http://schema.org/about");
    expect(aboutQuad?.object.value).not.toMatch(/[<>" ]/);
  });

  it("neutralises an injection payload in draw:thumbnail — no extra triples", async () => {
    const ttl = await serializeScene(URL_, { sceneDocument: CANVAS, thumbnail: Injection });
    const quads = new Parser({ baseIRI: URL_ }).parse(ttl);
    expect(quads.filter((q) => q.subject.value === InjectedSubject)).toHaveLength(0);
    expect(quads.every((q) => q.subject.value === `${URL_}#it`)).toBe(true);
  });

  it("NEUTRALISES a hostile REQUIRED sceneDocument that is itself a parseable URL (encoded, no injection)", async () => {
    // The payload's scheme+host (`https://evil`) make it a VALID (if weird) URL, so
    // it is canonicalised (break-out chars percent-encoded into the path), NOT thrown
    // — the serialised document must still hold exactly one, safe, scene triple.
    const ttl = await serializeScene(URL_, { sceneDocument: Injection });
    const quads = new Parser({ baseIRI: URL_ }).parse(ttl);
    expect(quads.filter((q) => q.subject.value === InjectedSubject)).toHaveLength(0);
    expect(quads.every((q) => q.subject.value === `${URL_}#it`)).toBe(true);
    const docQuad = quads.find(
      (q) => q.predicate.value === "https://w3id.org/jeswr/drawing#sceneDocument",
    );
    expect(docQuad?.object.value).not.toMatch(/[<>" ]/);
  });

  it("REJECTS a non-http(s) sceneDocument (e.g. file:) — required field throws", () => {
    expect(() => buildScene(URL_, { sceneDocument: "file:///etc/passwd" })).toThrow(TypeError);
  });

  it("REJECTS an unparseable sceneDocument (not an IRI at all) — required field throws", () => {
    expect(() => buildScene(URL_, { sceneDocument: "not an iri" })).toThrow(TypeError);
  });

  it("serializeScene propagates the throw for an invalid required sceneDocument", async () => {
    await expect(serializeScene(URL_, { sceneDocument: "file:///etc/passwd" })).rejects.toThrow(
      TypeError,
    );
  });

  describe("safeHttpIri", () => {
    it("returns undefined for non-string / non-http(s) / unparseable input", () => {
      expect(safeHttpIri(undefined)).toBeUndefined();
      expect(safeHttpIri("file:///etc/passwd")).toBeUndefined();
      expect(safeHttpIri("javascript:alert(1)")).toBeUndefined();
      expect(safeHttpIri("not an iri")).toBeUndefined();
      expect(safeHttpIri("urn:isbn:0451450523")).toBeUndefined();
    });

    it("passes a clean http(s) IRI through unchanged", () => {
      expect(safeHttpIri(CANVAS)).toBe(CANVAS);
      expect(safeHttpIri("https://example.org/a#it")).toBe("https://example.org/a#it");
    });

    it("percent-encodes the Turtle-illegal chars URL leaves untouched (| ^ `)", () => {
      const out = safeHttpIri("https://example.org/a|b^c`d");
      expect(out).toBeDefined();
      expect(out).not.toMatch(/[|^`]/);
      expect(out).toContain("%7C");
      expect(out).toContain("%5E");
      expect(out).toContain("%60");
    });

    it("neutralises the delimiter break-out chars (none of angle/quote/space survive)", () => {
      const out = safeHttpIri(Injection);
      // The payload IS a parseable URL, so it canonicalises; the break-out delimiters
      // must be percent-encoded away.
      expect(out).toBeDefined();
      expect(out).not.toMatch(/[<>" ]/);
    });
  });
});

describe("IRI-injection hardening — the REQUIRED scene SUBJECT (resourceUrl)", () => {
  // roborev finding (scene.ts sceneSubject): the caller-supplied `resourceUrl` flowed
  // through `namedNode(`${resourceUrl}#it`)` UNGUARDED, so a hostile resourceUrl
  // carrying Turtle IRI-ref delimiters broke out of EVERY serialised subject `<…>` —
  // the prior round guarded the SceneData object fields but left the subject an
  // unescaped n3.Writer injection sink. The subject is REQUIRED, so it now FAILS
  // CLOSED: a non-parseable / non-http(s) resourceUrl THROWS (never an
  // injectable/empty subject); a parseable http(s) IRI is escaped lexically.

  const SubjectPayload = "> <https://evil/s> <https://evil/p> <https://evil/o";

  it("THROWS on a resourceUrl that is not a parseable absolute IRI (break-out payload)", () => {
    expect(() => sceneSubject(SubjectPayload)).toThrow(TypeError);
    expect(() => buildScene(SubjectPayload, { sceneDocument: CANVAS })).toThrow(TypeError);
  });

  it("THROWS on a lone-space resourceUrl and one that starts with `<`", () => {
    expect(() => buildScene(" ", { sceneDocument: CANVAS })).toThrow(TypeError);
    expect(() => buildScene("<https://evil/s>", { sceneDocument: CANVAS })).toThrow(TypeError);
  });

  it("THROWS on a non-http(s) resourceUrl (e.g. file:)", () => {
    expect(() => buildScene("file:///etc/passwd", { sceneDocument: CANVAS })).toThrow(TypeError);
  });

  it("serializeScene REJECTS (never emits an injected triple) for a hostile resourceUrl", async () => {
    await expect(serializeScene(SubjectPayload, { sceneDocument: CANVAS })).rejects.toThrow(
      TypeError,
    );
  });

  it("a clean http(s) resourceUrl round-trips byte-identical as the subject", async () => {
    expect(sceneSubject(URL_).value).toBe(`${URL_}#it`);
    const ttl = await serializeScene(URL_, { sceneDocument: CANVAS });
    const quads = new Parser({ baseIRI: URL_ }).parse(ttl);
    expect(quads.length).toBeGreaterThan(0);
    // EVERY triple is rooted at the exact `${URL_}#it` subject — no injected subject.
    expect(quads.every((q) => q.subject.value === `${URL_}#it`)).toBe(true);
  });

  it("neutralises (escapes, no injection) a PARSEABLE http resourceUrl carrying break-out chars", async () => {
    // A parseable http(s) URL whose PATH carries `>`/space/`<` is a VALID (if weird)
    // absolute http IRI, so it is not thrown — but its lexeme is percent-encoded, so
    // the serialised subject is a single safe `<…>`, never a break-out.
    const sneaky = "https://pod.example/a> <https://evil/s> <https://evil/p> <https://evil/o";
    const ttl = await serializeScene(sneaky, { sceneDocument: CANVAS });
    const quads = new Parser({ baseIRI: URL_ }).parse(ttl);
    expect(quads.filter((q) => q.subject.value === "https://evil/s")).toHaveLength(0);
    const subjects = new Set(quads.map((q) => q.subject.value));
    expect(subjects.size).toBe(1);
    const only = [...subjects][0] ?? "";
    expect(only).not.toMatch(/[<>" ]/);
  });

  describe("safeSubjectBaseIri + escapeIri", () => {
    it("returns the exact lexeme for a clean http(s) IRI (no URL canonicalisation)", () => {
      expect(safeSubjectBaseIri(URL_)).toBe(URL_);
      // A path that WHATWG-URL would canonicalise (e.g. a `..` segment) is preserved
      // lexically — a subject's identity is its exact string.
      const lexical = "https://pod.example/a/../b";
      expect(safeSubjectBaseIri(lexical)).toBe(lexical);
    });

    it("returns undefined for non-string / non-http(s) / unparseable input", () => {
      expect(safeSubjectBaseIri(undefined)).toBeUndefined();
      expect(safeSubjectBaseIri("file:///etc/passwd")).toBeUndefined();
      expect(safeSubjectBaseIri("not an iri")).toBeUndefined();
      expect(safeSubjectBaseIri(SubjectPayload)).toBeUndefined();
    });

    it("escapes the FULL Turtle-IRIREF-forbidden set (angle/quote/space/brace/pipe/caret/backtick/backslash + controls)", () => {
      const out = escapeIri('a<b>c"d e{f}g|h^i`j\\k\tl\nm');
      expect(out).not.toMatch(/[<>"{}|^`\\ \t\n]/);
      expect(out).toContain("%3C"); // <
      expect(out).toContain("%3E"); // >
      expect(out).toContain("%22"); // "
      expect(out).toContain("%20"); // space
      expect(out).toContain("%7C"); // |
      expect(out).toContain("%5E"); // ^
      expect(out).toContain("%60"); // `
      expect(out).toContain("%5C"); // backslash
      expect(out).toContain("%09"); // tab
      expect(out).toContain("%0A"); // newline
    });

    it("leaves an already-safe string untouched", () => {
      expect(escapeIri("https://example.org/a/b#it")).toBe("https://example.org/a/b#it");
    });
  });
});
