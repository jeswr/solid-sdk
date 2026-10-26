// AUTHORED-BY Codex GPT-6.1-Sol
import { LEGACY_NAMESPACES, NS } from "@jeswr/suite-vocab";

export { canonicalize, NS } from "@jeswr/suite-vocab";
export const MO = "http://purl.org/ontology/mo/";
export const S = NS.SCHEMA;
export const M = NS.MEDIA;
export const TYPE = `${NS.RDF}type`;

/** Canonical predicates first; aliases never rewrite resource IDs or literal text. */
export function readPredicates(predicate: string): string[] {
  return [
    predicate,
    ...Object.entries(LEGACY_NAMESPACES)
      .filter(([, base]) => predicate.startsWith(base))
      .map(([legacy, base]) => legacy + predicate.slice(base.length)),
  ];
}
