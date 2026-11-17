// AUTHORED-BY Codex GPT-6.1-Sol
import type { BlankNode, Literal, Quad, Term } from "@rdfjs/types";
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

/** Only called after shared syntax/cost checks. Share the map across both graphs. */
export function encodeValidationQuads(
  quads: readonly Quad[],
  blankNodes = new Map<string, BlankNode>(),
): string {
  const copy = (term: Term): Term => {
    switch (term.termType) {
      case "BlankNode": {
        let safe = blankNodes.get(term.value);
        if (!safe) {
          safe = DataFactory.blankNode(`b${blankNodes.size}`);
          blankNodes.set(term.value, safe);
        }
        return safe;
      }
      case "NamedNode":
        return DataFactory.namedNode(term.value);
      case "Literal":
        return validationLiteral(term);
      case "DefaultGraph":
        return DataFactory.defaultGraph();
      default:
        throw new Error("Unsupported validation term");
    }
  };
  // Copy rather than fromQuad/fromTerm, which discard RDF 1.2 direction.
  const safe = quads.map((q) =>
    DataFactory.quad(
      copy(q.subject) as Quad["subject"],
      copy(q.predicate) as Quad["predicate"],
      copy(q.object) as Quad["object"],
      copy(q.graph) as Quad["graph"],
    ),
  );
  return new Writer({ format: "N-Quads" }).quadsToString(safe);
}

export function decodeValidationQuads(nquads: string): Quad[] {
  // An empty prefix preserves identifiers shared between the data and shapes.
  return new Parser({ format: "N-Quads", blankNodePrefix: "" }).parse(nquads);
}
