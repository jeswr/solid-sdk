// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import { Store } from "n3";
import {
  buildObservation,
  type Observation,
  type ObservationInput,
  readObservation,
} from "./model.js";
import { httpIri, isoTime, slug, utcDay } from "./policy.js";
import { RDF_TYPE, SOSA_OBSERVATION } from "./vocab.js";

export const DEFAULT_MAX_OBSERVATIONS = 2000;
export interface ParseOptions {
  /** Counts typed roots before validation, including malformed or off-document roots. */
  maxObservations?: number;
  maxQuads?: number;
  maxBytes?: number;
}
function limit(value: number | undefined, fallback: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > 10000000) {
    throw new RangeError("Document limits must be integers between 1 and 10000000");
  }
  return result;
}
function documentIri(iri: string): string {
  httpIri(iri);
  if (iri.includes("#")) throw new TypeError("Document URL must not contain a fragment");
  return iri;
}
/** Snapshot an RDF/JS dataset once; bound all data, not just matching roots. */
function boundedStore(dataset: DatasetCore, options: ParseOptions): Store {
  const maxQuads = limit(options.maxQuads, 50000);
  const store = new Store();
  let count = 0;
  for (const quad of dataset) {
    if (++count > maxQuads) throw new RangeError("Document quad cap exceeded");
    if (quad.graph.termType !== "DefaultGraph")
      throw new TypeError("Expected a Turtle default graph");
    store.add(quad);
  }
  return store;
}

/** Malformed records are skipped; exceeding any budget rejects the whole document. */
export function parseObservations(
  documentUrl: string,
  dataset: DatasetCore,
  options: ParseOptions = {},
): Observation[] {
  documentIri(documentUrl);
  const maxObservations = limit(options.maxObservations, DEFAULT_MAX_OBSERVATIONS);
  const store = boundedStore(dataset, options);
  const roots = store.getSubjects(RDF_TYPE, SOSA_OBSERVATION, null);
  if (roots.length > maxObservations) throw new RangeError("Observation cap exceeded");
  const observations: Observation[] = [];
  for (const root of roots) {
    if (
      root.termType !== "NamedNode" ||
      (root.value !== documentUrl && !root.value.startsWith(`${documentUrl}#`))
    )
      continue;
    const parsed = readObservation(root.value, store);
    if (parsed) observations.push(parsed);
  }
  return observations;
}

export async function parseObservationsTurtle(
  documentUrl: string,
  body: string,
  options: ParseOptions = {},
): Promise<Observation[]> {
  documentIri(documentUrl);
  const maxBytes = limit(options.maxBytes, 8 * 1024 * 1024);
  const maxQuads = limit(options.maxQuads, 50000);
  limit(options.maxObservations, DEFAULT_MAX_OBSERVATIONS);
  if (body.length > maxBytes || new TextEncoder().encode(body).byteLength > maxBytes) {
    throw new RangeError("Document byte cap exceeded");
  }
  return parseObservations(
    documentUrl,
    await parseRdf(body, "text/turtle", { baseIRI: documentUrl, maxBytes, maxQuads }),
    options,
  );
}

export type DayObservation = Omit<ObservationInput, "sensor"> & { id: string };
/** One sensor, one UTC day, many observation roots; ids must be stable and unique. */
export function buildObservationDay(
  documentUrl: string,
  sensor: string,
  date: string | Date,
  observations: readonly DayObservation[],
  options: ParseOptions = {},
): Store {
  documentIri(documentUrl);
  httpIri(sensor);
  const day = utcDay(date);
  if (observations.length > limit(options.maxObservations, DEFAULT_MAX_OBSERVATIONS)) {
    throw new RangeError("Observation cap exceeded");
  }
  const maxQuads = limit(options.maxQuads, 50000);
  const store = new Store();
  const ids = new Set<string>();
  for (const { id, ...input } of observations) {
    slug(id);
    if (ids.has(id)) throw new TypeError("Duplicate observation id");
    ids.add(id);
    if (isoTime(input.resultTime).slice(0, 10) !== day)
      throw new TypeError("Observation is outside the UTC day");
    // Prefix distinct namespaces for roots/results, so one id cannot alias another result.
    const iri = `${documentUrl}#observation-${id}`;
    const built = buildObservation(iri, { ...input, sensor });
    // Detect cross-observation root/result collisions before merging generated stores.
    for (const subject of built.getSubjects(null, null, null)) {
      if (store.countQuads(subject, null, null, null))
        throw new TypeError("Observation node collision");
    }
    store.addQuads([...built]);
    if (store.size > maxQuads) throw new RangeError("Document quad cap exceeded");
  }
  return store;
}
