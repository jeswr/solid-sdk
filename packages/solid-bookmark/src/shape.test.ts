// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { parseRdf } from "@jeswr/fetch-rdf";
import { createRdfEngine } from "@jeswr/rdf-engine/node";
import { afterAll, describe, expect, it } from "vitest";
import { bookmarkSubject, serializeBookmark } from "./bookmark.js";
import { bookmarkOntologyTtl, bookmarkShapeTtl } from "./shape.js";
import { BOOK, LEGACY_BOOK_NS, LEGACY_CORE_NS } from "./vocab.js";

const RES = "http://localhost:3000/alice/bookmarks/x";
const SUBJ = bookmarkSubject(RES);

const engine = createRdfEngine();
afterAll(() => engine.dispose());

const shapes = bookmarkShapeTtl();

async function validateTtl(ttl: string) {
  const data = await parseRdf(ttl, "text/turtle", { baseIRI: RES });
  return engine.validate(data, shapes);
}

describe("the shipped .ttl artifacts parse", () => {
  it("ships canonical suite namespaces and the canonical ontology IRI", async () => {
    expect(bookmarkOntologyTtl()).not.toContain(LEGACY_BOOK_NS);
    expect(bookmarkOntologyTtl()).not.toContain(LEGACY_CORE_NS);
    const ontology = [...(await parseRdf(bookmarkOntologyTtl(), "text/turtle", {}))];
    expect(
      ontology.some(
        (q) =>
          q.subject.value === "https://jeswr.org/ns/bookmark" &&
          q.predicate.value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" &&
          q.object.value === "http://www.w3.org/2002/07/owl#Ontology",
      ),
    ).toBe(true);
  });

  it("bookmark.shacl.ttl is well-formed Turtle", async () => {
    expect((await parseRdf(bookmarkShapeTtl(), "text/turtle", {})).size).toBeGreaterThan(0);
  });

  it("bookmark.ttl (ontology) is well-formed Turtle and declares book:Bookmark", async () => {
    const quads = [...(await parseRdf(bookmarkOntologyTtl(), "text/turtle", {}))];
    expect(quads.length).toBeGreaterThan(0);
    expect(
      quads.some(
        (q) =>
          q.subject.value === "https://jeswr.org/ns/bookmark#Bookmark" &&
          q.predicate.value === "http://www.w3.org/2000/01/rdf-schema#subClassOf" &&
          q.object.value === "https://jeswr.org/ns/core#InformationResource",
      ),
    ).toBe(true);
  });
});

describe("SHACL shape (bookmark.shacl.ttl)", () => {
  it("a fully-populated, well-formed bookmark conforms", async () => {
    const ttl = await serializeBookmark(RES, {
      url: "https://example.org/article",
      title: "Great article",
      description: "A blurb.",
      notes: "My notes.",
      archived: true,
      tags: ["solid", "rdf"],
      created: new Date("2026-06-09T10:00:00.000Z"),
      modified: new Date("2026-06-10T11:00:00.000Z"),
    });
    expect((await validateTtl(ttl)).conforms).toBe(true);
  });

  it("a minimal bookmark (url only) conforms", async () => {
    const ttl = await serializeBookmark(RES, { url: "https://example.org/x" });
    expect((await validateTtl(ttl)).conforms).toBe(true);
  });

  it("a bookmark with NO url is non-conforming (url is required, minCount 1)", async () => {
    // Hand-craft a typed bookmark with no schema:url — the writer would drop a
    // bad url, so validate raw Turtle to exercise minCount directly.
    const ttl = `
      @prefix book: <https://jeswr.org/ns/bookmark#> .
      @prefix dct:  <http://purl.org/dc/terms/> .
      <${SUBJ}> a book:Bookmark ; dct:title "No url" .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => String(r.path).endsWith("url>"))).toBe(true);
  });

  it("a non-http(s) url is rejected by sh:pattern (e.g. a hostile javascript: scheme)", async () => {
    const ttl = `
      @prefix book:   <https://jeswr.org/ns/bookmark#> .
      @prefix schema: <http://schema.org/> .
      <${SUBJ}> a book:Bookmark ; schema:url <javascript:alert(1)> .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => String(r.path).endsWith("url>"))).toBe(true);
  });

  it("a url written as a literal (not an IRI) is rejected by sh:nodeKind", async () => {
    const ttl = `
      @prefix book:   <https://jeswr.org/ns/bookmark#> .
      @prefix schema: <http://schema.org/> .
      <${SUBJ}> a book:Bookmark ; schema:url "https://example.org/x" .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => String(r.path).endsWith("url>"))).toBe(true);
  });

  it("two schema:url values are non-conforming (maxCount 1)", async () => {
    const ttl = `
      @prefix book:   <https://jeswr.org/ns/bookmark#> .
      @prefix schema: <http://schema.org/> .
      <${SUBJ}> a book:Bookmark ;
        schema:url <https://example.org/a> , <https://example.org/b> .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => String(r.path).endsWith("url>"))).toBe(true);
  });

  it("a non-boolean book:archived is rejected by sh:datatype", async () => {
    const ttl = `
      @prefix book:   <https://jeswr.org/ns/bookmark#> .
      @prefix schema: <http://schema.org/> .
      <${SUBJ}> a book:Bookmark ;
        schema:url <https://example.org/x> ;
        book:archived "yes" .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => r.value === '"yes"')).toBe(true);
  });

  it("rejects a legacy bookmark with no URL and a malformed archived flag", async () => {
    const report = await validateTtl(`<${SUBJ}> a <${LEGACY_BOOK_NS}Bookmark> ;
      <${LEGACY_BOOK_NS}archived> "not a boolean" .`);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => r.path === "<http://schema.org/url>")).toBe(true);
    expect(report.results.some((r) => r.value === '"not a boolean"')).toBe(true);
  });

  describe.each([BOOK, LEGACY_BOOK_NS])("class namespace %s", (classNs) => {
    it.each([BOOK, LEGACY_BOOK_NS])("accepts valid fields in %s", async (fieldNs) => {
      const report = await validateTtl(`<${SUBJ}> a <${classNs}Bookmark> ;
        <http://schema.org/url> <https://example.org/x> ;
        <${fieldNs}notes> "notes" ; <${fieldNs}archived> true .`);
      expect(report.conforms).toBe(true);
    });

    describe.each([BOOK, LEGACY_BOOK_NS])("field namespace %s", (fieldNs) => {
      it.each([
        ["notes", "42"],
        ["archived", '"not a boolean"'],
      ])("rejects malformed %s values even alongside valid canonical fields", async (field, bad) => {
        const report = await validateTtl(`<${SUBJ}> a <${classNs}Bookmark> ;
          <http://schema.org/url> <https://example.org/x> ;
          <${BOOK}notes> "notes" ; <${BOOK}archived> true ; <${fieldNs}${field}> ${bad} .`);
        expect(report.conforms).toBe(false);
        expect(
          report.results.some((r) =>
            r.sourceConstraintComponent.endsWith("DatatypeConstraintComponent"),
          ),
        ).toBe(true);
      });

      it.each([
        ["notes", '"one", "two"'],
        ["archived", "true, false"],
      ])("rejects multiple %s values on one alias", async (field, values) => {
        const report = await validateTtl(`<${SUBJ}> a <${classNs}Bookmark> ;
          <http://schema.org/url> <https://example.org/x> ; <${fieldNs}${field}> ${values} .`);
        expect(report.conforms).toBe(false);
        expect(
          report.results.some((r) =>
            r.sourceConstraintComponent.endsWith("MaxCountConstraintComponent"),
          ),
        ).toBe(true);
      });
    });

    it.each([
      ["notes", '"canonical"', '"legacy"'],
      ["archived", "true", "false"],
    ])("rejects conflicting %s values across aliases", async (field, canonical, legacy) => {
      const report = await validateTtl(`<${SUBJ}> a <${classNs}Bookmark> ;
        <http://schema.org/url> <https://example.org/x> ;
        <${BOOK}${field}> ${canonical} ; <${LEGACY_BOOK_NS}${field}> ${legacy} .`);
      expect(report.conforms).toBe(false);
      expect(
        report.results.some((r) =>
          r.sourceConstraintComponent.endsWith("MaxCountConstraintComponent"),
        ),
      ).toBe(true);
    });

    it("accepts identical values across aliases as one value", async () => {
      const report = await validateTtl(`<${SUBJ}> a <${classNs}Bookmark> ;
        <http://schema.org/url> <https://example.org/x> ;
        <${BOOK}notes> "same" ; <${LEGACY_BOOK_NS}notes> "same" ;
        <${BOOK}archived> true ; <${LEGACY_BOOK_NS}archived> true .`);
      expect(report.conforms).toBe(true);
    });
  });

  it("an IRI-valued tag is rejected (schema:keywords must be a string literal)", async () => {
    const ttl = `
      @prefix book:   <https://jeswr.org/ns/bookmark#> .
      @prefix schema: <http://schema.org/> .
      <${SUBJ}> a book:Bookmark ;
        schema:url <https://example.org/x> ;
        schema:keywords <https://example.org/tag/solid> .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => String(r.path).endsWith("keywords>"))).toBe(true);
  });

  it("many string tags conform (tags are unbounded)", async () => {
    const ttl = await serializeBookmark(RES, {
      url: "https://example.org/x",
      tags: ["a", "b", "c", "d", "e"],
    });
    expect((await validateTtl(ttl)).conforms).toBe(true);
  });
});
