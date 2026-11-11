// AUTHORED-BY Codex GPT-6.1-Sol
import type { Literal } from "@rdfjs/types";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { decodeValidationQuads, encodeValidationQuads } from "../src/validationTransfer.js";

describe("validation graph transfer", () => {
  it("round-trips RDF terms, blank node identifiers, named graphs and literal direction", () => {
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
    const encoded = encodeValidationQuads(original);
    expect(encoded).toContain('"text"@en--rtl');
    expect(encoded).toContain("_:subject");
    const decoded = decodeValidationQuads(encoded);
    expect(decoded).toHaveLength(original.length);
    for (let index = 0; index < original.length; index += 1) {
      expect(decoded[index]?.equals(original[index])).toBe(true);
    }
  });
});
