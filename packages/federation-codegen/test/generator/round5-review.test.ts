// AUTHORED-BY Codex GPT-6
import type { Quad, Term } from "@rdfjs/types";
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { AdmissionError, parseShapes } from "../../src/index.js";
import { serializeCanonicalTurtle } from "../../src/rdf.js";

const EX = "https://ex.test/";
const { namedNode, literal, blankNode, quad } = DataFactory;
const HEADER = `@prefix ex: <${EX}> . @prefix sh: <http://www.w3.org/ns/shacl#> . @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .`;
const shape = (constraint: string, datatype = "decimal") => `${HEADER}
ex:S a sh:NodeShape; sh:targetClass ex:Thing; sh:property [ sh:path ex:p; sh:datatype xsd:${datatype}; ${constraint} ] .`;
const badTerms: [string, Term][] = [
  ["Variable", DataFactory.variable("x")],
  ["quoted Quad", quad(namedNode(`${EX}s`), namedNode(`${EX}p`), literal("nested"))],
  ...["a.", "-a", "a b", "a; <urn:p> <urn:o> . #"].map((s): [string, Term] => [
    `blank ${JSON.stringify(s)}`,
    blankNode(s),
  ]),
  ...[
    "en_US",
    "en-",
    "1en",
    "en\n",
    "en; <urn:p> <urn:o> . #",
    "abcdefghi",
    "en-a",
    "en-a-foo-a-bar",
  ].map((s): [string, Term] => [`language ${JSON.stringify(s)}`, literal("text", s)]),
];
describe.each(["Turtle", "N-Triples"] as const)("R5.1 generator %s output integrity", (format) => {
  it.each(badTerms)("rejects a store containing %s", (_kind, term) => {
    const store = new Store([
      quad(namedNode(`${EX}s`), namedNode(`${EX}p`), term as Quad["object"]),
    ]);
    expect(() => serializeCanonicalTurtle(store, {}, format)).toThrow(TypeError);
  });
  it("rejects an empty blank-node label before N3 can replace it", () => {
    const empty = Object.assign(blankNode("temporary"), { id: "_:" });
    expect(() =>
      serializeCanonicalTurtle([quad(namedNode(`${EX}s`), namedNode(`${EX}p`), empty)], {}, format),
    ).toThrow(TypeError);
  });
  it("rejects unknown RDF term kinds", () => {
    const term = { termType: "Other", value: "x" } as unknown as Quad["object"];
    expect(() =>
      serializeCanonicalTurtle([quad(namedNode(`${EX}s`), namedNode(`${EX}p`), term)], {}, format),
    ).toThrow(TypeError);
  });
  it("checks the reparsed quad set before returning any output", () => {
    const spy = vi.spyOn(Parser.prototype, "parse").mockImplementation(() => []);
    try {
      expect(() =>
        serializeCanonicalTurtle(
          [quad(blankNode("a"), namedNode(`${EX}p`), literal("text"))],
          {},
          format,
        ),
      ).toThrow(TypeError);
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
  });
  it("rejects syntactically valid injected output from a forged N3 blank-node id", () => {
    const forged = Object.assign(blankNode("safe"), {
      id: "_:safe . <urn:evil> <urn:p> <urn:o> . #",
    });
    Object.defineProperty(forged, "value", { value: "safe" });
    expect(() =>
      serializeCanonicalTurtle(
        [quad(namedNode(`${EX}s`), namedNode(`${EX}p`), forged)],
        {},
        format,
      ),
    ).toThrow(/round-trip integrity/);
  });
  it("rejects a valid language tag whose datatype would change during serialization", () => {
    const inconsistent = literal("text", "en");
    Object.defineProperty(inconsistent, "datatype", {
      value: namedNode("http://www.w3.org/2001/XMLSchema#string"),
    });
    expect(() =>
      serializeCanonicalTurtle(
        [quad(namedNode(`${EX}s`), namedNode(`${EX}p`), inconsistent)],
        {},
        format,
      ),
    ).toThrow(/round-trip integrity/);
  });
  it("round-trips shared and cyclic blank nodes as a quad set", () => {
    const a = blankNode("0.é");
    const b = blankNode("_b");
    const qs = [quad(a, namedNode(`${EX}p`), b), quad(b, namedNode(`${EX}p`), a)];
    expect(
      new Store(new Parser().parse(serializeCanonicalTurtle([...qs, ...qs], {}, format))).size,
    ).toBe(2);
  });
});

describe("R5.2 numeric schema admission preserves exact decimals", () => {
  for (const parameter of ["minInclusive", "maxInclusive", "minExclusive", "maxExclusive"]) {
    it.each([
      "1.0000000000000001",
      "0.99999999999999999",
      "9007199254740993",
    ])(`rejects lossy ${parameter} %s before projection`, (lex) => {
      expect(() => parseShapes(shape(`sh:${parameter} "${lex}"^^xsd:decimal`), EX)).toThrow(
        AdmissionError,
      );
    });
  }
  it.each(["decimal", "integer"])("rejects lossy %s enum members before projection", (type) => {
    const lex = type === "decimal" ? "1.0000000000000001" : "9007199254740993";
    expect(() => parseShapes(shape(`sh:in ( "${lex}"^^xsd:${type} )`, type), EX)).toThrow(
      AdmissionError,
    );
  });
  it("accepts redundant zeros in exactly representable bounds", () => {
    expect(
      parseShapes(
        shape('sh:minInclusive "+01.000"^^xsd:decimal; sh:in ("1"^^xsd:decimal "2"^^xsd:decimal)'),
        EX,
      ).nodeShapes[0]?.properties[0]?.minInclusive,
    ).toBe(1);
  });
});

// Projection to ManifestScalar cannot preserve a noncanonical enum RDF term.
it.each([
  ["integer", "01"],
  ["decimal", "1.0"],
  ["boolean", "1"],
])("R5.3 rejects noncanonical xsd:%s enum lexical %s at admission", (type, lex) => {
  expect(() => parseShapes(shape(`sh:in ( "${lex}"^^xsd:${type} )`, type), EX)).toThrow(
    AdmissionError,
  );
});
