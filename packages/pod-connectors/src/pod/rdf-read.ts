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
// AUTHORED-BY Codex GPT-6
import {
  DEFAULT_ACCEPT,
  extractMediaType,
  type FetchedRdf,
  parseRdf,
  RdfFetchError,
} from "@jeswr/fetch-rdf";
import { JsonLdParser } from "jsonld-streaming-parser";
import { Store } from "n3";
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
  // fetch-rdf 0.1 has no documentLoader option. Retain its transport/error contract,
  // using its canonical parser for every format except JSON-LD, which needs a loader.
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: new Headers({ ...REVALIDATE_HEADERS, accept: DEFAULT_ACCEPT }),
    });
  } catch (cause) {
    throw new RdfFetchError(`Network error fetching ${url}.`, { cause, url });
  }
  const finalUrl = response.url || url;
  const rawContentType = response.headers.get("content-type");
  if (!response.ok) {
    throw new RdfFetchError(`HTTP ${response.status} fetching ${url}.`, {
      status: response.status,
      url: finalUrl,
      contentType: rawContentType ?? undefined,
    });
  }
  let body: string;
  try {
    body = await response.text();
  } catch (cause) {
    throw new RdfFetchError(`Failed to read response body from ${finalUrl}.`, {
      cause,
      url: finalUrl,
      contentType: rawContentType ?? undefined,
    });
  }
  const contentType = extractMediaType(rawContentType);
  const dataset =
    contentType === "application/ld+json"
      ? await parseLocalJsonLd(body, finalUrl, rawContentType ?? contentType)
      : await parseRdf(body, rawContentType, { baseIRI: finalUrl });
  return { dataset, etag: response.headers.get("etag"), contentType, response, url: finalUrl };
}

/** No bundled context documents exist; refuse every URL without a fetch fallback. */
async function parseLocalJsonLd(
  body: string,
  baseIRI: string,
  contentType: string,
): Promise<Store> {
  // The context parser wraps loader errors and drops their identity. Keep the typed
  // refusal per parse so callers can distinguish policy failures from malformed RDF.
  let refusal: RemoteContextRefusedError | undefined;
  const parser = new JsonLdParser({
    baseIRI,
    documentLoader: {
      async load(url: string): Promise<never> {
        refusal = new RemoteContextRefusedError(url);
        throw refusal;
      },
    },
  });
  const dataset = new Store();
  try {
    await new Promise<void>((resolve, reject) => {
      parser.on("data", (quad) => dataset.addQuad(quad));
      parser.on("error", reject);
      parser.on("end", resolve);
      parser.write(body);
      parser.end();
    });
  } catch (cause) {
    if (refusal) throw refusal;
    throw new RdfFetchError(`Failed to parse ${contentType} body at ${baseIRI}.`, {
      cause,
      url: baseIRI,
      contentType,
    });
  }
  return dataset;
}
