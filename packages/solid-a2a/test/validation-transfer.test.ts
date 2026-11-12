// AUTHORED-BY Codex GPT-6.1-Sol
import type { BlankNode, Literal, Term } from "@rdfjs/types";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { decodeValidationQuads, encodeValidationQuads } from "../src/validationTransfer.js";

describe("validation graph transfer", () => {
  it("round-trips RDF terms with safe blank node labels, named graphs and literal direction", () => {
    const { quad, namedNode, blankNode, literal } = DataFactory;
    const directional = literal as unknown as (
      value: string,
      options: { language: string; direction: string },
    ) => Literal;
    const values = [
      literal('quotes " and newlines\n'),
      literal("bonjour", "fr"),
      literal("42", namedNode("http://www.w3.org/2001/XMLSchema#integer")),
      directional("text", { language: "en", direction: "rtl" }),
      directional("text", { language: "en", direction: "ltr" }),
      blankNode("object"),
      namedNode("urn:object"),
    ];
    const original = values.map((value, index) =>
      quad(blankNode("subject"), namedNode(`urn:p:${index}`), value, namedNode("urn:graph")),
    );
    original.push(quad(namedNode("urn:s"), namedNode("urn:p"), blankNode("object")));
    original.push(
      quad(blankNode("object"), namedNode("urn:p"), blankNode("subject"), blankNode("graph . #")),
    );
    const blankNodes = new Map<string, BlankNode>();
    const encoded = encodeValidationQuads(original, blankNodes);
    expect(encoded).toContain('"text"@en--rtl');
    expect(encoded).toContain("_:b0");
    expect(encoded).not.toContain("_:subject");
    const decoded = decodeValidationQuads(encoded);
    expect(decoded).toHaveLength(original.length);
    const mapped = (term: Term) =>
      term.termType === "BlankNode" ? (blankNodes.get(term.value) as BlankNode) : term;
    for (const [index, q] of original.entries()) {
      for (const position of ["subject", "predicate", "object", "graph"] as const) {
        expect(decoded[index]?.[position].equals(mapped(q[position]))).toBe(true);
      }
    }
    expect(original[0]?.subject.value).toBe("subject");
  });
});
