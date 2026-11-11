// AUTHORED-BY Codex GPT-6.1-Sol
import type { Literal, Quad } from "@rdfjs/types";
import { DataFactory, Parser, Writer } from "n3";

type DirectionalLiteral = Literal & { readonly direction?: string };
/** N3 supports RDF 1.2; @types/n3 still describes the RDF 1.1 overload. */
export function validationLiteral(term: Literal, datatype = term.datatype.value): Literal {
  if (!term.language) return DataFactory.literal(term.value, DataFactory.namedNode(datatype));
  const literal = DataFactory.literal as unknown as (
    value: string,
    options: { language: string; direction: string },
  ) => Literal;
  return literal(term.value, {
    language: term.language,
    direction: (term as DirectionalLiteral).direction ?? "",
  });
}

/** Only called after the shared input caps; N3 Writer preserves RDF 1.2 direction. */
export function encodeValidationQuads(quads: readonly Quad[]): string {
  return new Writer({ format: "N-Quads" }).quadsToString(Array.from(quads));
}

export function decodeValidationQuads(nquads: string): Quad[] {
  // An empty prefix preserves identifiers shared between the data and shapes.
  return new Parser({ format: "N-Quads", blankNodePrefix: "" }).parse(nquads);
}
