// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import type { DataFactory as DataFactoryType, DatasetCore, Quad } from "@rdfjs/types";
import { LiteralFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { serialize } from "../src/index.js";
import { addHttpIriTriple, addIriTriple, addLiteralTriple, objectTerms } from "../src/wrapper.js";

const SUBJECT = "https://example.org/s";
const P = "https://example.org/p";
const Q = "https://example.org/q";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const factory = DataFactory as unknown as DataFactoryType;

function fixture() {
  const store = new Store();
  const node = new TermWrapper(SUBJECT, store as unknown as DatasetCore, factory);
  return { node, store };
}

async function roundTrip(store: Store): Promise<Quad[]> {
  const turtle = await serialize([...store]);
  return [...(await parseRdf(turtle, "text/turtle"))] as Quad[];
}

describe("objectTerms", () => {
  it("returns an empty detached set for no predicates", () => {
    const { node, store } = fixture();
    addIriTriple(node, P, "urn:present");
    const terms = objectTerms(node);
    expect([...terms]).toEqual([]);
    terms.add(new TermWrapper("urn:detached", node.dataset, factory));
    expect(store.size).toBe(1);
  });

  it("returns an empty set for missing predicates", () => {
    const { node } = fixture();
    expect([...objectTerms(node, P)]).toEqual([]);
    expect([...objectTerms(node, P, Q)]).toEqual([]);
  });

  it("preserves literal, IRI and blank-node types with the same lexical value", () => {
    const { node } = fixture();
    addIriTriple(node, P, "urn:object");
    addLiteralTriple(node, P, "urn:object");
    objectTerms(node, P).add(
      new TermWrapper(DataFactory.blankNode("blank"), node.dataset, factory),
    );
    const terms = [...objectTerms(node, P)];
    expect(terms.map((term) => [term.termType, term.value])).toEqual([
      ["NamedNode", "urn:object"],
      ["Literal", "urn:object"],
      ["BlankNode", "blank"],
    ]);
    expect(terms.every((term) => term.dataset === node.dataset && term.factory === factory)).toBe(
      true,
    );
  });

  it("unions in predicate order and de-duplicates by RDF equality", () => {
    const { node } = fixture();
    addIriTriple(node, P, "urn:first");
    addIriTriple(node, P, "urn:shared");
    addIriTriple(node, Q, "urn:shared");
    addIriTriple(node, Q, "urn:second");
    addLiteralTriple(node, Q, "urn:shared");
    expect([...objectTerms(node, P, Q, P)].map((term) => [term.termType, term.value])).toEqual([
      ["NamedNode", "urn:first"],
      ["NamedNode", "urn:shared"],
      ["NamedNode", "urn:second"],
      ["Literal", "urn:shared"],
    ]);
    expect([...objectTerms(node, Q, P)].map((term) => term.value)).toEqual([
      "urn:shared",
      "urn:second",
      "urn:shared",
      "urn:first",
    ]);
  });

  it("uses datatype and language in term equality", () => {
    const { node } = fixture();
    addLiteralTriple(node, P, "1");
    addLiteralTriple(node, Q, "1");
    addLiteralTriple(node, Q, "1", `${XSD}integer`);
    for (const language of ["en", "fr"]) {
      objectTerms(node, Q).add(
        new TermWrapper(DataFactory.literal("1", language), node.dataset, factory),
      );
    }
    const terms = [...objectTerms(node, P, Q)];
    expect(terms.map((term) => [term.datatype.value, term.language])).toEqual([
      [`${XSD}string`, ""],
      [`${XSD}integer`, ""],
      ["http://www.w3.org/1999/02/22-rdf-syntax-ns#langString", "en"],
      ["http://www.w3.org/1999/02/22-rdf-syntax-ns#langString", "fr"],
    ]);
  });

  it("keeps a single predicate live for reads, add, delete and clear", () => {
    const { node, store } = fixture();
    const terms = objectTerms(node, P);
    addIriTriple(node, P, "urn:first");
    addIriTriple(node, Q, "urn:unrelated");
    const same = new TermWrapper("urn:first", node.dataset, factory);
    expect(terms.has(same)).toBe(true);
    expect(terms.size).toBe(1);
    expect(terms.delete(same)).toBe(true);
    expect(terms.delete(same)).toBe(false);
    const second = new TermWrapper("urn:second", node.dataset, factory);
    expect(terms.add(second)).toBe(terms);
    expect([...objectTerms(node, P)].map((term) => term.value)).toEqual(["urn:second"]);
    terms.clear();
    expect(terms.size).toBe(0);
    expect([...store].map((quad) => quad.predicate.value)).toEqual([Q]);
  });

  it("returns a detached snapshot for multiple predicates", () => {
    const { node, store } = fixture();
    addIriTriple(node, P, "urn:first");
    const terms = objectTerms(node, P, Q);
    addIriTriple(node, Q, "urn:later");
    expect([...terms].map((term) => term.value)).toEqual(["urn:first"]);
    terms.clear();
    expect(store.size).toBe(2);
  });
});

const forbiddenCharacters = [
  ...'< >"{}|^`\\',
  ...Array.from({ length: 32 }, (_, code) => String.fromCharCode(code)),
];

describe.each([
  ["addIriTriple", addIriTriple],
  ["addHttpIriTriple", addHttpIriTriple],
] as const)("%s", (_name, add) => {
  it.each(
    forbiddenCharacters,
  )("escapes embedded IRIREF character %j before writing", async (ch) => {
    const { node, store } = fixture();
    add(node, P, `https://Example.ORG:443/a${ch}b`);
    const escaped = `https://Example.ORG:443/a%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}b`;
    expect(store.size).toBe(1);
    expect([...store][0]?.object.value).toBe(escaped);
    const parsed = await roundTrip(store);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.object.value).toBe(escaped);
  });

  it("neutralises a triple injection payload", async () => {
    const { node, store } = fixture();
    add(node, P, 'https://evil/> . <https://evil/s> <https://evil/p> "injected" . #');
    const parsed = await roundTrip(store);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.subject.value).toBe(SUBJECT);
    expect(parsed[0]?.predicate.value).toBe(P);
    expect(parsed[0]?.object.termType).toBe("NamedNode");
  });

  it("preserves lexical identity without normalising or double encoding", () => {
    const { node, store } = fixture();
    const iri = "https://Example.ORG:443/a/../b%20c";
    add(node, P, iri);
    expect([...store][0]?.object.value).toBe(iri);
  });

  it("supports blank-node subjects and the supplied factory", () => {
    const { node, store } = fixture();
    const blank = new TermWrapper(DataFactory.blankNode("subject"), node.dataset, factory);
    add(blank, P, "https://example.org/object");
    expect([...store][0]?.subject.termType).toBe("BlankNode");
    expect([...store][0]?.subject.value).toBe("subject");
  });
});

describe("addIriTriple", () => {
  it.each([
    "urn:uuid:a",
    "did:example:123",
    "mailto:a@b.org",
    "javascript:alert(1)",
    "data:text/plain,hi",
  ])("escapes without restricting the scheme: %s", (iri) => {
    const { node, store } = fixture();
    expect(addIriTriple(node, P, iri)).toBeUndefined();
    expect([...store][0]?.object.value).toBe(iri);
  });
});

describe("addHttpIriTriple", () => {
  it.each([
    "javascript:alert(1)",
    "data:text/plain,hi",
    "urn:uuid:a",
    "did:example:123",
    "",
    "/relative",
    "https:example.org",
    "https:///path",
    "https://?x",
    " https://example.org/",
    "https://example.org/ ",
    "\u0000https://example.org/",
    "https://example.org/\n",
  ])("returns false and leaves existing quads untouched for %j", (iri) => {
    const { node, store } = fixture();
    addLiteralTriple(node, Q, "keep");
    const before = [...store];
    expect(addHttpIriTriple(node, P, iri)).toBe(false);
    expect([...store]).toEqual(before);
  });

  it.each(["http://example.org/o", "https://example.org/o"])("returns true for %s", (iri) => {
    const { node, store } = fixture();
    expect(addHttpIriTriple(node, P, iri)).toBe(true);
    expect([...store][0]?.object.value).toBe(iri);
  });
});

describe("addLiteralTriple", () => {
  it.each([
    undefined,
    `${XSD}dateTime`,
  ])("writes a factory literal with datatype %s", async (datatype) => {
    const { node, store } = fixture();
    const value = '2026-11-01T00:00:00Z " \\ > {} | ^ ` \n\r\t\u0000';
    expect(addLiteralTriple(node, P, value, datatype)).toBeUndefined();
    const expected =
      datatype === undefined
        ? LiteralFrom.string(value, factory)
        : LiteralFrom.datatypeTuple([datatype, value], factory);
    const object = [...store][0]?.object;
    expect(object?.equals(expected)).toBe(true);
    expect(object?.termType).toBe("Literal");
    expect((object as { datatype: { value: string } }).datatype.value).toBe(
      datatype ?? `${XSD}string`,
    );
    const parsed = await roundTrip(store);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.object.equals(expected)).toBe(true);
  });

  it("preserves an empty plain string", () => {
    const { node } = fixture();
    addLiteralTriple(node, P, "");
    expect([...objectTerms(node, P)].map((term) => [term.value, term.datatype.value])).toEqual([
      ["", `${XSD}string`],
    ]);
  });
});
