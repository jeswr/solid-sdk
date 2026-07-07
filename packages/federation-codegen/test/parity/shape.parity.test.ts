// AUTHORED-BY Claude Opus 4.8
// PARITY: @jeswr/solid-bookmark's src/shape.test.ts, VERBATIM except imports point
// at the generated model's facade + the GENERATED shapes.ttl. Validates that the
// generated model's OUTPUT conforms to the (generated, skolemized) SHACL shape via
// rdf-validate-shacl — the strongest structural parity signal.
import env from "@zazuko/env-node";
import { Parser } from "n3";
import SHACLValidator from "rdf-validate-shacl";
import { describe, expect, it } from "vitest";
import {
  bookmarkOntologyTtl,
  bookmarkShapeTtl,
  bookmarkSubject,
  serializeBookmark,
} from "../../examples/bookmark/facade.js";

const RES = "http://localhost:3000/alice/bookmarks/x";
const SUBJ = bookmarkSubject(RES);

function toDataset(quads: Iterable<Parameters<ReturnType<typeof env.dataset>["add"]>[0]>) {
  const ds = env.dataset();
  for (const q of quads) ds.add(q);
  return ds;
}

const shapes = toDataset(new Parser().parse(bookmarkShapeTtl()));

function validateTtl(ttl: string) {
  const data = toDataset(new Parser({ baseIRI: RES }).parse(ttl));
  return new SHACLValidator(shapes, { factory: env }).validate(data);
}

describe("the shipped .ttl artifacts parse", () => {
  it("bookmark.shacl.ttl (generated) is well-formed Turtle", () => {
    expect(new Parser().parse(bookmarkShapeTtl()).length).toBeGreaterThan(0);
  });

  it("bookmark.ttl (ontology) is well-formed Turtle and declares book:Bookmark", () => {
    const quads = new Parser().parse(bookmarkOntologyTtl());
    expect(quads.length).toBeGreaterThan(0);
    expect(
      quads.some(
        (q) =>
          q.subject.value === "https://w3id.org/jeswr/bookmark#Bookmark" &&
          q.predicate.value === "http://www.w3.org/2000/01/rdf-schema#subClassOf" &&
          q.object.value === "https://w3id.org/jeswr/core#InformationResource",
      ),
    ).toBe(true);
  });
});

describe("SHACL shape (generated shapes.ttl)", () => {
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
    const ttl = `
      @prefix book: <https://w3id.org/jeswr/bookmark#> .
      @prefix dct:  <http://purl.org/dc/terms/> .
      <${SUBJ}> a book:Bookmark ; dct:title "No url" .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => String(r.path?.value).endsWith("url"))).toBe(true);
  });

  it("a non-http(s) url is rejected by sh:pattern (e.g. a hostile javascript: scheme)", async () => {
    const ttl = `
      @prefix book:   <https://w3id.org/jeswr/bookmark#> .
      @prefix schema: <http://schema.org/> .
      <${SUBJ}> a book:Bookmark ; schema:url <javascript:alert(1)> .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => String(r.path?.value).endsWith("url"))).toBe(true);
  });

  it("a url written as a literal (not an IRI) is rejected by sh:nodeKind", async () => {
    const ttl = `
      @prefix book:   <https://w3id.org/jeswr/bookmark#> .
      @prefix schema: <http://schema.org/> .
      <${SUBJ}> a book:Bookmark ; schema:url "https://example.org/x" .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => String(r.path?.value).endsWith("url"))).toBe(true);
  });

  it("two schema:url values are non-conforming (maxCount 1)", async () => {
    const ttl = `
      @prefix book:   <https://w3id.org/jeswr/bookmark#> .
      @prefix schema: <http://schema.org/> .
      <${SUBJ}> a book:Bookmark ;
        schema:url <https://example.org/a> , <https://example.org/b> .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => String(r.path?.value).endsWith("url"))).toBe(true);
  });

  it("a non-boolean book:archived is rejected by sh:datatype", async () => {
    const ttl = `
      @prefix book:   <https://w3id.org/jeswr/bookmark#> .
      @prefix schema: <http://schema.org/> .
      <${SUBJ}> a book:Bookmark ;
        schema:url <https://example.org/x> ;
        book:archived "yes" .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => String(r.path?.value).endsWith("archived"))).toBe(true);
  });

  it("an IRI-valued tag is rejected (schema:keywords must be a string literal)", async () => {
    const ttl = `
      @prefix book:   <https://w3id.org/jeswr/bookmark#> .
      @prefix schema: <http://schema.org/> .
      <${SUBJ}> a book:Bookmark ;
        schema:url <https://example.org/x> ;
        schema:keywords <https://example.org/tag/solid> .
    `;
    const report = await validateTtl(ttl);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => String(r.path?.value).endsWith("keywords"))).toBe(true);
  });

  it("many string tags conform (tags are unbounded)", async () => {
    const ttl = await serializeBookmark(RES, {
      url: "https://example.org/x",
      tags: ["a", "b", "c", "d", "e"],
    });
    expect((await validateTtl(ttl)).conforms).toBe(true);
  });
});
