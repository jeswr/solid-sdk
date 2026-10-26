// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The pod READ primitives — GET + parse an owner-private RDF resource, and list a
 * container's children. Parsing goes through `@jeswr/fetch-rdf` (`parseRdf` under the
 * hood — never a bespoke parser) and container listing through `@solid/object`'s
 * typed `ContainerDataset` (never hand-parsed `ldp:contains`). Reads use the caller's
 * injected authed `fetch` (the pod is the owner's trusted origin). A container that
 * does not exist yet (404) lists as empty rather than throwing.
 */
import { isWithinBase } from "@jeswr/agentic-legacy-bridge";
import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import { ContainerDataset } from "@solid/object";
import { DataFactory } from "n3";
import type { PodFetch } from "../config.js";

/** A fetched-and-parsed RDF resource, with its strong validator for a later CAS write. */
export interface FetchedGraph {
  /** The parsed dataset (RDF/JS `DatasetCore` — query it via `.match()` / `src/pod/rdf-query`). */
  readonly store: DatasetCore;
  /** The strong ETag validator (`null` on servers that send none). */
  readonly etag: string | null;
  /** The final resource URL after redirects. */
  readonly url: string;
}

/** GET + parse an RDF resource. Throws `RdfFetchError` on a non-2xx / parse failure. */
export async function readGraph(fetchFn: PodFetch, url: string): Promise<FetchedGraph> {
  const { dataset, etag, url: finalUrl } = await fetchRdf(url, { fetch: fetchFn });
  return { store: dataset, etag, url: finalUrl };
}

/**
 * List a container's immediate child resource URLs (via `ldp:contains`), filtered
 * strictly to targets WITHIN the container (a listing that points elsewhere is
 * dropped — fail-closed) and excluding the container itself. A 404 → `[]`.
 */
export async function listContainer(fetchFn: PodFetch, container: string): Promise<string[]> {
  let store: DatasetCore;
  try {
    ({ store } = await readGraph(fetchFn, container));
  } catch (err) {
    if (err instanceof RdfFetchError && err.status === 404) return [];
    throw err;
  }
  const containerNode = new ContainerDataset(store, DataFactory).container;
  if (!containerNode) return [];
  const children: string[] = [];
  for (const resource of containerNode.contains) {
    const id = resource.id;
    if (typeof id !== "string") continue;
    if (id === container) continue;
    if (!isWithinBase(id, container)) continue;
    children.push(id);
  }
  return children;
}
