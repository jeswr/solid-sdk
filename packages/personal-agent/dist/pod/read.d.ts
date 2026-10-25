import type { DatasetCore } from "@rdfjs/types";
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
export declare function readGraph(fetchFn: PodFetch, url: string): Promise<FetchedGraph>;
/**
 * List a container's immediate child resource URLs (via `ldp:contains`), filtered
 * strictly to targets WITHIN the container (a listing that points elsewhere is
 * dropped — fail-closed) and excluding the container itself. A 404 → `[]`.
 */
export declare function listContainer(fetchFn: PodFetch, container: string): Promise<string[]>;
//# sourceMappingURL=read.d.ts.map