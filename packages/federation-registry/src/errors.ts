// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Error classification shared by the registry + storage fetch paths. The point of
// the distinction is that a caller can branch on the issue code: a `fetch-failed`
// (HTTP / network / transport) may be retried, whereas a `parse-failed` (the bytes
// came back but aren't valid RDF) will not improve on retry.

import { RdfFetchError } from "@jeswr/fetch-rdf";

/**
 * Classify an error thrown by `fetchRdf` (the URL path) into a `fetch-failed`
 * (transport: HTTP non-2xx, DNS, connection) or `parse-failed` (the fetched body
 * came back but failed to parse as RDF).
 *
 * `@jeswr/fetch-rdf` raises `RdfFetchError` for all three: an HTTP error carries a
 * `status`; a parse-of-response failure carries the response `contentType` (but no
 * `status`); a network/transport error carries neither. So: a fetched-body PARSE
 * failure (has `contentType`, no `status`) ⇒ `parse-failed`; everything else from
 * the fetch path (HTTP status, or a bare network error) ⇒ `fetch-failed`. This
 * stops a network failure being mislabelled `parse-failed` merely for lacking an
 * HTTP status.
 */
export function classifyFetchError(err: unknown): "fetch-failed" | "parse-failed" {
  if (err instanceof RdfFetchError && !err.status && err.contentType !== undefined) {
    return "parse-failed";
  }
  return "fetch-failed";
}
