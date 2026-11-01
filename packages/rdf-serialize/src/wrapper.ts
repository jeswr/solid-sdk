// AUTHORED-BY Codex GPT-6
import { LiteralFrom, NamedNodeFrom, SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { escapeIri, safeHttpIri } from "./iri.js";

/**
 * Read object terms without losing their RDF term types.
 *
 * Predicates must be trusted vocabulary IRIs. One predicate returns the live
 * wrapper set: reads reflect dataset changes, and add/delete/clear update the
 * dataset. Multiple predicates return a detached snapshot, unioned in argument
 * order and de-duplicated by RDF term equality, preserving first-seen order.
 * No predicates returns an empty detached set.
 */
export function objectTerms(node: TermWrapper, ...predicates: string[]): Set<TermWrapper> {
  if (predicates.length === 1) {
    return SetFrom.subjectPredicate(
      node,
      predicates[0] as string,
      TermAs.instance(TermWrapper),
      TermFrom.instance,
    );
  }
  const values: TermWrapper[] = [];
  for (const predicate of new Set(predicates)) {
    for (const term of objectTerms(node, predicate)) {
      if (!values.some((value) => value.equals(TermFrom.instance(term, node.factory)))) {
        values.push(term);
      }
    }
  }
  return new Set(values);
}

/**
 * Add one object-IRI triple through the node's factory and dataset.
 *
 * The predicate must be a trusted vocabulary IRI and the subject must already
 * be safe. The object passes through {@link escapeIri}, with no scheme validation
 * or URL normalisation. Callers enforce any additional field-specific policy.
 */
export function addIriTriple(node: TermWrapper, predicate: string, objectIri: string): void {
  const factory = node.factory;
  const p = NamedNodeFrom.string(predicate, factory);
  const o = NamedNodeFrom.string(escapeIri(objectIri), factory);
  node.dataset.add(factory.quad(node as never, p as never, o as never));
}

/**
 * Add an HTTP(S) object-IRI triple through {@link safeHttpIri}.
 *
 * Returns false and adds nothing when the object is unsafe; otherwise returns
 * true after adding the escaped lexical IRI. The predicate must be a trusted
 * vocabulary IRI and the subject must already be safe.
 */
export function addHttpIriTriple(node: TermWrapper, predicate: string, objectIri: string): boolean {
  const safeObject = safeHttpIri(objectIri);
  if (safeObject === undefined) return false;
  addIriTriple(node, predicate, safeObject);
  return true;
}

/**
 * Add a literal triple through the node's factory and dataset.
 *
 * Defaults to an xsd:string literal. An explicit datatype uses
 * `LiteralFrom.datatypeTuple` without coercing the lexical value. The predicate
 * and optional datatype must be trusted vocabulary IRIs; the subject must
 * already be safe. Literal escaping is the RDF writer's responsibility.
 */
export function addLiteralTriple(
  node: TermWrapper,
  predicate: string,
  value: string,
  datatype?: string,
): void {
  const factory = node.factory;
  const p = NamedNodeFrom.string(predicate, factory);
  const o =
    datatype === undefined
      ? LiteralFrom.string(value, factory)
      : LiteralFrom.datatypeTuple([datatype, value], factory);
  node.dataset.add(factory.quad(node as never, p as never, o as never));
}
