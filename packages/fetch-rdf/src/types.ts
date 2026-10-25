/**
 * Public type definitions for `@jeswr/fetch-rdf`.
 *
 * @packageDocumentation
 */

import type { Store } from 'n3';

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
   * Additional request headers to merge in. The `Accept` header is
   * always overridden with the Solid-default
   * `"text/turtle, application/ld+json;q=0.9"`.
   */
  headers?: HeadersInit;
  /**
   * Request signal for cancellation.
   */
  signal?: AbortSignal;
}

/**
 * Result of a successful {@link fetchRdf} call. Everything else the
 * caller might want — ETag, Content-Type, Link headers — is on
 * {@link FetchedRdf.headers}, so we don't surface a parallel set of
 * named fields that can drift out of sync.
 */
export interface FetchedRdf {
  /** Parsed RDF as an in-memory N3 {@link Store}. */
  dataset: Store;
  /** Response headers for callers that need ETag, Link, etc. */
  headers: Headers;
}
