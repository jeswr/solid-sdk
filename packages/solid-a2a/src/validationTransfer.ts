// AUTHORED-BY Codex GPT-6.1-Sol
import type { Literal, Quad, Term } from "@rdfjs/types";
import { DataFactory } from "n3";

type DirectionalLiteral = Literal & { readonly direction?: string };
interface WireTerm {
  termType: string;
  value: string;
  language?: string;
  direction?: string;
  datatype?: string;
}
type WireQuad = [WireTerm, WireTerm, WireTerm, WireTerm];

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

/** Only called after the shared input caps; never use N3.fromTerm (it loses direction). */
export function encodeValidationQuads(quads: readonly Quad[]): string {
  const encode = (term: Term): WireTerm =>
    term.termType === "Literal"
      ? {
          termType: term.termType,
          value: term.value,
          language: term.language,
          direction: (term as DirectionalLiteral).direction ?? "",
          datatype: term.datatype.value,
        }
      : { termType: term.termType, value: term.value };
  return JSON.stringify(quads.map((q) => [q.subject, q.predicate, q.object, q.graph].map(encode)));
}

export function decodeValidationQuads(json: string): Quad[] {
  const decode = (term: WireTerm): Term => {
    switch (term.termType) {
      case "NamedNode":
        return DataFactory.namedNode(term.value);
      case "BlankNode":
        return DataFactory.blankNode(term.value);
      case "DefaultGraph":
        return DataFactory.defaultGraph();
      case "Literal":
        return validationLiteral({
          ...term,
          datatype: DataFactory.namedNode(term.datatype as string),
        } as unknown as Literal);
      default:
        throw new Error(`Unsupported validation term: ${term.termType}`);
    }
  };
  return (JSON.parse(json) as WireQuad[]).map(([s, p, o, g]) =>
    DataFactory.quad(
      decode(s) as Quad["subject"],
      decode(p) as Quad["predicate"],
      decode(o) as Quad["object"],
      decode(g) as Quad["graph"],
    ),
  );
}
