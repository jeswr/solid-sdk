/**
 * Public type definitions for `@jeswr/fetch-rdf`.
 *
 * @packageDocumentation
 */

import type { IJsonLdParserOptions } from "jsonld-streaming-parser";
import type { Store } from "n3";

/** JSON-LD context loader, compatible with the streaming parser's loader seam. */
export type DocumentLoader = NonNullable<IJsonLdParserOptions["documentLoader"]>;

/** Options for {@link parseRdf}. */
export interface ParseRdfOptions {
  /**
   * Base IRI for resolving relative references in the body. In practice
   * this is the resource URL itself. Optional — the underlying parsers
   * accept `undefined` (no relative-IRI resolution).
   */
  baseIRI?: string;
  /** Explicit remote-context policy. Omit to refuse all remote contexts. */
  documentLoader?: DocumentLoader;
}

/** Options for {@link fetchRdf}. */
export interface FetchRdfOptions {
  /** Explicit JSON-LD context loader. Omit to refuse all remote contexts. */
  documentLoader?: DocumentLoader;
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
 * Result of a successful {@link fetchRdf} call, including legacy metadata.
 */
export interface FetchedRdf {
  /** Parsed RDF as an in-memory N3 {@link Store}. */
  dataset: Store;
  /** Response headers for callers that need ETag, Link, etc. */
  headers: Headers;
  /** Response validator, preserved verbatim; null when absent. */
  etag: string | null;
  /** Final response URL after redirects, falling back to the requested URL. */
  url: string;
  /** Lowercase media type without parameters; null when the header is absent. */
  contentType: string | null;
  /** Original response (its body has been consumed). */
  response: Response;
}
