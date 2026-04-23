/**
 * Public type definitions for `@jeswr/fetch-rdf`.
 *
 * @packageDocumentation
 */

import type { DatasetCore } from '@rdfjs/types';

/** Options for {@link parseRdf}. */
export interface ParseRdfOptions {
  /**
   * Base IRI for resolving relative references in the body. In practice
   * this is the resource URL itself. Optional — the underlying parsers
   * accept `undefined` (no relative-IRI resolution).
   */
  baseIRI?: string;
}

/** Options for {@link fetchRdf}. */
export interface FetchRdfOptions {
  /**
   * The fetch implementation to use. Defaults to `globalThis.fetch` so
   * unauthenticated callers Just Work. Pass an authenticated fetch
   * (e.g. from `@uvdsl/solid-oidc-client-browser`) for protected
   * resources.
   */
  fetch?: typeof fetch;
  /**
   * The `Accept` header value to send. Defaults to
   * `"text/turtle, application/ld+json;q=0.9"` — Turtle preferred,
   * JSON-LD fallback, mirroring real-world Solid server content
   * negotiation (Solid Protocol §5.2 only mandates these two).
   */
  accept?: string;
  /**
   * Additional request headers to merge in. `Accept` is set via
   * {@link FetchRdfOptions.accept}; any `accept` here is overridden.
   */
  headers?: HeadersInit;
  /**
   * Request signal for cancellation.
   */
  signal?: AbortSignal;
}

/** Result of a successful {@link fetchRdf} call. */
export interface FetchedRdf {
  /** Parsed RDF as an in-memory dataset. */
  dataset: DatasetCore;
  /**
   * Strong validator from the response, if the server provided one.
   * Useful for `If-Match` / `If-None-Match` on subsequent writes.
   */
  etag: string | null;
  /**
   * The media type extracted from the response `Content-Type` header
   * (parameters stripped, lowercased). `null` only if the response had
   * no Content-Type (in which case parsing assumed `text/turtle`).
   */
  contentType: string | null;
  /** The raw `Response` for callers that want to read further headers. */
  response: Response;
  /** The final URL the request resolved to (after redirects). */
  url: string;
}
