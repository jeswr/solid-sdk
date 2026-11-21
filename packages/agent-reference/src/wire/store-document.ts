// AUTHORED-BY Codex GPT-6.2 Sol
import type { DatasetCore, Quad } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import jsonld from "jsonld";
import { DataFactory, Store } from "n3";
import { scopedId } from "../model/named-values.js";
import { AWP, ODRL, PROV, SCHEMA } from "../profile/vocabulary.js";
import { ODRL_CONTEXT } from "./contexts.js";
import { STORE_CONTEXT, storeJsonLdLoader } from "./store-contexts.js";
import { writeNQuads } from "./store-quads.js";

const prefixes = {
  awp: AWP,
  prov: PROV,
  odrl: ODRL,
  vc: "https://www.w3.org/2018/credentials#",
  sec: "https://w3id.org/security#",
  schema: SCHEMA,
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  xsd: "http://www.w3.org/2001/XMLSchema#",
};

/** Include all quads reachable from the root, independent of their source graph. */
export function storeProjection(dataset: DatasetCore, root: string): Store {
  const subjects = new Map<string, Quad[]>();
  for (const quad of dataset) {
    if (quad.subject.termType !== "NamedNode") continue;
    const quads = subjects.get(quad.subject.value);
    if (quads) quads.push(quad);
    else subjects.set(quad.subject.value, [quad]);
  }
  const projected = new Store();
  const seen = new Set([root]);
  const pending = [root];
  for (const id of pending) {
    for (const { subject, predicate, object } of subjects.get(id) ?? []) {
      projected.addQuad(subject, predicate, object);
      if (
        object.termType === "NamedNode" &&
        subjects.has(object.value) &&
        !seen.has(object.value)
      ) {
        seen.add(object.value);
        pending.push(object.value);
      }
    }
  }
  // Some held rule ids append a second '#' to a vocabulary IRI. Escape it in the
  // display graph so strict JSON-LD readers retain the node and its links.
  const terms = new Set<string>();
  for (const { subject, predicate, object } of projected) {
    terms.add(subject.value);
    terms.add(predicate.value);
    if (object.termType === "NamedNode") terms.add(object.value);
  }
  const aliases = new Map<string, string>();
  for (const iri of [...terms].sort()) {
    const fragment = iri.indexOf("#");
    if (fragment < 0 || !iri.includes("#", fragment + 1)) continue;
    const escaped = iri.slice(0, fragment + 1) + iri.slice(fragment + 1).replaceAll("#", "%23");
    let id = escaped;
    while (terms.has(id)) id = scopedId(id, iri);
    terms.add(id);
    aliases.set(iri, id);
  }
  if (!aliases.size) return projected;
  type NamedNode = Extract<Quad["subject"], { termType: "NamedNode" }>;
  const rename = (term: NamedNode): NamedNode => {
    const id = aliases.get(term.value);
    return id === undefined ? term : DataFactory.namedNode(id);
  };
  const display = new Store();
  for (const { subject, predicate, object } of projected)
    display.addQuad(
      subject.termType === "NamedNode" ? rename(subject) : subject,
      predicate.termType === "NamedNode" ? rename(predicate) : predicate,
      object.termType === "NamedNode" ? rename(object) : object,
    );
  return display;
}

export interface LinkedStoreView<Kind extends string = string> {
  readonly what: Kind;
  readonly context: string | readonly string[];
  readonly jsonld: string;
  readonly turtle: string;
}

export async function linkedView<Kind extends string>(
  dataset: DatasetCore,
  root: string,
  what: Kind,
): Promise<LinkedStoreView<Kind>> {
  return linkedViewOfProjection(storeProjection(dataset, root), what);
}

export async function linkedViewOfProjection<Kind extends string>(
  projected: Store,
  what: Kind,
): Promise<LinkedStoreView<Kind>> {
  if (!projected.size) throw new TypeError("Store view root is absent");
  const uses = (prefix: string) =>
    [...projected].some(
      ({ predicate, object }) =>
        predicate.value.startsWith(prefix) ||
        (object.termType === "NamedNode" && object.value.startsWith(prefix)),
    );
  // The store context already aliases credential terms such as issuer. Adding the
  // VC context can redefine protected terms such as kid. Other terms keep their IRIs.
  const context = uses(prefixes.odrl) ? [ODRL_CONTEXT, STORE_CONTEXT] : STORE_CONTEXT;
  const expanded = await jsonld.fromRDF(writeNQuads(projected), { format: "application/n-quads" });
  const compacted = await jsonld.compact(
    expanded,
    context as unknown as NonNullable<Parameters<typeof jsonld.compact>[1]>,
    { documentLoader: storeJsonLdLoader },
  );
  const turtle = await serialize([...projected], { format: "text/turtle", prefixes });
  return { what, context, jsonld: JSON.stringify({ ...compacted, "@context": context }), turtle };
}
