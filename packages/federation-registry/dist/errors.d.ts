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
export declare function classifyFetchError(err: unknown): "fetch-failed" | "parse-failed";
//# sourceMappingURL=errors.d.ts.map