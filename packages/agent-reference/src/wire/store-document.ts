// AUTHORED-BY Codex GPT-6.2 Sol
import type { DatasetCore, Quad } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import jsonld from "jsonld";
import { Store } from "n3";
import { AWP, ODRL, PROV, SCHEMA } from "../profile/vocabulary.js";
import { ODRL_CONTEXT, VC_CONTEXT } from "./contexts.js";
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
  return projected;
}

export interface LinkedStoreView {
  readonly what: string;
  readonly context: string | readonly string[];
  readonly jsonld: string;
  readonly turtle: string;
}

export async function linkedView(
  dataset: DatasetCore,
  root: string,
  what: string,
): Promise<LinkedStoreView> {
  const projected = storeProjection(dataset, root);
  if (!projected.size) throw new TypeError("Store view root is absent");
  const uses = (prefix: string) =>
    [...projected].some(
      ({ predicate, object }) =>
        predicate.value.startsWith(prefix) ||
        (object.termType === "NamedNode" && object.value.startsWith(prefix)),
    );
  const contexts = [
    ...(uses(prefixes.odrl) ? [ODRL_CONTEXT] : []),
    ...(uses(prefixes.vc) ? [VC_CONTEXT] : []),
    STORE_CONTEXT,
  ];
  const context = contexts.length === 1 ? STORE_CONTEXT : contexts;
  const expanded = await jsonld.fromRDF(writeNQuads(projected), { format: "application/n-quads" });
  const compacted = await jsonld.compact(
    expanded,
    context as unknown as NonNullable<Parameters<typeof jsonld.compact>[1]>,
    { documentLoader: storeJsonLdLoader },
  );
  const turtle = await serialize([...projected], { format: "text/turtle", prefixes });
  return { what, context, jsonld: JSON.stringify(compacted), turtle };
}
