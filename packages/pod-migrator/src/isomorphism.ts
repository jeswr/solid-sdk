// AUTHORED-BY Codex GPT-6
import type { Quad, Term } from "@rdfjs/types";
import { DataFactory, type Store } from "n3";

const terms = (quad: Quad) => [quad.subject, quad.predicate, quad.object, quad.graph];

/** A bijection over blank nodes, preserving every quad position. Refuse costly proofs. */
export function isomorphic(left: Store, right: Store): boolean {
  if (left.size !== right.size) return false;
  // Store.equals uses term identity, which is a sufficient fast path but cannot
  // establish isomorphism when parsers choose different blank-node identifiers.
  if (left.equals(right)) return true;
  const quads = [...left];
  const allTerms = quads.flatMap(terms);
  const otherTerms = [...right].flatMap(terms);
  if ([...allTerms, ...otherTerms].some((term) => term.termType === "Quad"))
    throw new TypeError("RDF isomorphism proof does not support quoted triples");
  const blankNodes = (input: Term[]) => [
    ...new Set(input.filter((term) => term.termType === "BlankNode").map((term) => term.value)),
  ];
  const from = blankNodes(allTerms);
  const to = blankNodes(otherTerms);
  if (from.length !== to.length) return false;
  if (from.length > 64) throw new TypeError("RDF isomorphism proof exceeds blank-node limit");
  const mapping = new Map<string, string>();
  const used = new Set<string>();
  let work = 0;
  const step = () => {
    if (++work > 100_000) throw new TypeError("RDF isomorphism proof exceeds work limit");
  };
  const compatible = () =>
    quads.every((quad) => {
      step();
      const positions = terms(quad);
      if (positions.some((term) => term.termType === "BlankNode" && !mapping.has(term.value)))
        return true;
      const mapped = positions.map((term) =>
        term.termType === "BlankNode"
          ? DataFactory.blankNode(mapping.get(term.value) as string)
          : term,
      );
      return right.has(
        DataFactory.quad(
          mapped[0] as Quad["subject"],
          mapped[1] as Quad["predicate"],
          mapped[2] as Quad["object"],
          mapped[3] as Quad["graph"],
        ),
      );
    });
  const search = (index: number): boolean => {
    if (index === from.length) return true;
    const node = from[index] as string;
    for (const candidate of to) {
      step();
      if (used.has(candidate)) continue;
      mapping.set(node, candidate);
      used.add(candidate);
      if (compatible() && search(index + 1)) return true;
      used.delete(candidate);
      mapping.delete(node);
    }
    return false;
  };
  return compatible() && search(0);
}
