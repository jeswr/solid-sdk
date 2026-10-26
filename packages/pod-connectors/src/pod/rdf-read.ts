/**
 * Connector RDF reads with forced revalidation and no remote context requests.
 *
 * Solid servers (CSS included — verified against v7) send `ETag` and
 * `Last-Modified` but NO `Cache-Control`, so browsers apply HEURISTIC
 * freshness (≈10% of the document's age) and may answer a GET straight from
 * cache without revalidating. For a pod manager that is a correctness bug,
 * observed in e2e: right after a demo import bootstraps the type index and
 * links it from the profile, the My-data page re-read the PROFILE from the
 * browser cache (pre-import copy, no index link) and showed "No media items
 * yet" for data that was sitting in the pod. The same staleness class hands
 * read-modify-write paths (type-index, ACLs) an out-of-date ETag, turning
 * into spurious `412`s on `If-Match` writes.
 *
 * The request header `Cache-Control: no-cache` keeps the HTTP cache but
 * forces conditional revalidation — the server answers `304` when nothing
 * changed, so freshness costs one cheap conditional GET. (`no-store` would
 * disable caching outright; revalidation is enough.)
 *
 * @see https://developer.mozilla.org/docs/Web/HTTP/Caching#heuristic_caching
 */
import { type FetchedRdf, fetchRdf } from "@jeswr/fetch-rdf";
import { RemoteContextRefusedError } from "../core/errors.js";

/** Request headers that force conditional revalidation through HTTP caches. */
export const REVALIDATE_HEADERS = { "cache-control": "no-cache" } as const;

/**
 * Fetch + parse a pod RDF document, always revalidating any cached copy.
 * JSON-LD supports inline contexts only: this package bundles no context URLs.
 *
 * Same contract as `fetchRdf` (errors propagate as `RdfFetchError`; keep the
 * returned `etag` for conditional writes).
 *
 * @param fetchImpl - host's scoped Pod transport; legacy callers may use global fetch
 *   for the document request. Context loading never uses a network transport.
 */
export async function freshRdf(
  url: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<FetchedRdf> {
  // The JSON-LD parser wraps loader errors. Retain the typed refusal so callers
  // can distinguish context policy failures from other fetch/parse failures.
  let refusal: RemoteContextRefusedError | undefined;
  try {
    return await fetchRdf(url, {
      fetch: fetchImpl,
      headers: REVALIDATE_HEADERS,
      documentLoader: {
        async load(contextUrl: string): Promise<never> {
          refusal = new RemoteContextRefusedError(contextUrl);
          throw refusal;
        },
      },
    });
  } catch (cause) {
    if (refusal) throw refusal;
    throw cause;
  }
}
