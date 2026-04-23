/**
 * fetchRdf — GET an RDF resource and parse the body in one call.
 *
 * Wraps the caller's `fetch` (default `globalThis.fetch`), sets a
 * Solid-appropriate `Accept` header by default, and returns the parsed
 * dataset together with the strong-validator `ETag` and the raw
 * response for callers that need to read further headers.
 *
 * @packageDocumentation
 */

import { parseRdf, extractMediaType } from './parse.js';
import { RdfFetchError } from './errors.js';
import type { FetchRdfOptions, FetchedRdf } from './types.js';

/**
 * Default `Accept` value. Turtle preferred (q=1.0 implicit) with
 * JSON-LD as a fallback, matching Solid Protocol §5.2 (the only two
 * RDF media types Solid servers must support).
 */
export const DEFAULT_ACCEPT = 'text/turtle, application/ld+json;q=0.9';

/**
 * Fetch an RDF resource and parse it.
 *
 * @param url - The resource URL.
 * @param options - Optional. See {@link FetchRdfOptions}.
 * @returns A {@link FetchedRdf} containing the parsed dataset, the
 *   ETag, the (lowercased, parameter-stripped) Content-Type, the final
 *   resolved URL, and the raw `Response`.
 * @throws {@link RdfFetchError} on transport failure, a non-2xx
 *   response, or parse failure. The error's `status`, `url`, and
 *   `contentType` fields are populated where known so callers can
 *   branch without string-matching the message.
 */
export async function fetchRdf(
  url: string,
  options: FetchRdfOptions = {},
): Promise<FetchedRdf> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const accept = options.accept ?? DEFAULT_ACCEPT;

  const headers = new Headers(options.headers);
  // Always force the caller's accept value over anything they passed in
  // headers — `accept` is the canonical knob for this on the public API.
  headers.set('accept', accept);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers,
      ...(options.signal !== undefined && { signal: options.signal }),
    });
  } catch (cause) {
    throw new RdfFetchError(
      `Network error fetching ${url}: ${errorMessage(cause)}`,
      { cause, url },
    );
  }

  if (!response.ok) {
    throw new RdfFetchError(
      `HTTP ${response.status} ${response.statusText || ''} fetching ${url}.`.trim(),
      {
        status: response.status,
        url: response.url || url,
        contentType: response.headers.get('content-type') ?? undefined,
      },
    );
  }

  const rawContentType = response.headers.get('content-type');
  const finalUrl = response.url || url;

  let body: string;
  try {
    body = await response.text();
  } catch (cause) {
    throw new RdfFetchError(
      `Failed to read response body from ${finalUrl}.`,
      {
        cause,
        url: finalUrl,
        ...(rawContentType !== null && { contentType: rawContentType }),
      },
    );
  }

  const dataset = await parseRdf(body, rawContentType, { baseIRI: finalUrl });

  return {
    dataset,
    etag: response.headers.get('etag'),
    contentType: extractMediaType(rawContentType),
    response,
    url: finalUrl,
  };
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
