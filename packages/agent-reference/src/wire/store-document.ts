// AUTHORED-BY Codex GPT-6.2 Sol
// AUTHORED-BY Codex GPT-6
import type { DatasetCore, Quad } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import jsonld from "jsonld";
import { DataFactory, Store } from "n3";
import { XSD } from "../model/named-values.js";
import { RDF_TYPE } from "../model/store/common.js";
import { AWP, ODRL, PROV, SCHEMA } from "../profile/vocabulary.js";
import { ODRL_CONTEXT } from "./contexts.js";
import { STORE_CONTEXT, storeJsonLdLoader } from "./store-contexts.js";
import { readNQuads, writeNQuads } from "./store-quads.js";

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

type NamedNode = Extract<Quad["subject"], { termType: "NamedNode" }>;

// Strict JSON-LD readers reject a second '#'. Escaping '%' in every fragment
// makes the mapping reversible even when two identifiers occur in different views.
function displayIri(term: NamedNode): NamedNode {
  const split = term.value.indexOf("#");
  if (split === -1) return term;
  const fragment = term.value.slice(split + 1);
  const escaped = fragment.replaceAll("%", "%25").replaceAll("#", "%23");
  return escaped === fragment
    ? term
    : DataFactory.namedNode(term.value.slice(0, split + 1) + escaped);
}

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
      projected.addQuad(
        subject.termType === "NamedNode" ? displayIri(subject) : subject,
        predicate.termType === "NamedNode" ? displayIri(predicate) : predicate,
        object.termType === "NamedNode" ? displayIri(object) : object,
      );
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
  return projected;
}

/** Expand one graph while preserving every literal's lexical form. */
function expandedNodes(quads: readonly Quad[]): jsonld.NodeObject[] {
  const nodes = new Map<
    string,
    Record<string, (string | jsonld.NodeObject | jsonld.ValueObject)[]>
  >();
  // fromRDF turns rdf:JSON literals into @json values, which a reader would canonicalize again.
  for (const { subject, predicate, object } of quads) {
    const node = nodes.get(subject.value) ?? {};
    nodes.set(subject.value, node);
    const isType = predicate.value === RDF_TYPE && object.termType === "NamedNode";
    const property = isType ? "@type" : predicate.value;
    const values = node[property] ?? [];
    node[property] = values;
    if (object.termType === "NamedNode") {
      values.push(isType ? object.value : { "@id": object.value });
    } else if (object.termType === "Literal") {
      values.push({
        "@value": object.value,
        ...(object.language
          ? { "@language": object.language }
          : object.datatype.value === `${XSD}string`
            ? {}
            : { "@type": object.datatype.value }),
      });
    }
  }
  return Array.from(nodes, ([id, node]) => ({ "@id": id, ...node }));
}

function expandedStore(quads: readonly Quad[]): jsonld.NodeObject[] {
  const graphs = new Map<string, Quad[]>();
  for (const quad of quads) {
    const graph = graphs.get(quad.graph.value);
    if (graph) graph.push(quad);
    else graphs.set(quad.graph.value, [quad]);
  }
  return Array.from(graphs, ([id, quads]) => {
    const nodes = expandedNodes(quads);
    return id ? [{ "@id": id, "@graph": nodes }] : nodes;
  }).flat();
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
  // Both renderings use the recorder fingerprint's canonical quad order.
  const quads = [...readNQuads(writeNQuads(projected))];
  const uses = (prefix: string) =>
    quads.some(
      ({ predicate, object }) =>
        predicate.value.startsWith(prefix) ||
        (object.termType === "NamedNode" && object.value.startsWith(prefix)),
    );
  // The store context already aliases credential terms such as issuer. Adding the
  // VC context can redefine protected terms such as kid. Other terms keep their IRIs.
  const context = uses(prefixes.odrl) ? [ODRL_CONTEXT, STORE_CONTEXT] : STORE_CONTEXT;
  const compacted = await jsonld.compact(
    expandedStore(quads),
    context as unknown as NonNullable<Parameters<typeof jsonld.compact>[1]>,
    { documentLoader: storeJsonLdLoader },
  );
  const format = quads.some(({ graph }) => graph.termType === "NamedNode")
    ? "application/trig"
    : "text/turtle";
  const turtle = await serialize(quads, { format, prefixes });
  return { what, context, jsonld: JSON.stringify({ ...compacted, "@context": context }), turtle };
}
