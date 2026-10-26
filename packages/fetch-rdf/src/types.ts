// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/**
 * Public type definitions for `@jeswr/fetch-rdf`.
 *
 * @packageDocumentation
 */

import type { DatasetCore } from "@rdfjs/types";
import type { IJsonLdParserOptions } from "jsonld-streaming-parser";
import type { Store } from "n3";

/** JSON-LD context loader, compatible with the streaming parser's loader seam. */
export type DocumentLoader = NonNullable<IJsonLdParserOptions["documentLoader"]>;

/** RDF syntaxes accepted by the optional parser seam. */
export type RdfMediaType =
  | "text/turtle"
  | "application/n-triples"
  | "application/n-quads"
  | "application/trig"
  | "application/ld+json";

/** Structural parser seam, satisfied by RdfEngine without depending on its package. */
export interface RdfParser {
  parse(
    input: string,
    mediaType: RdfMediaType,
    options?: { baseIri?: string },
  ): Promise<DatasetCore>;
}

/** Options for {@link parseRdf}. */
export interface ParseRdfOptions {
  /** Opt-in parser. Stream bodies are buffered; the engine owns syntax support. */
  engine?: RdfParser;
  /**
   * Base IRI for resolving relative references in the body. In practice
   * this is the resource URL itself. Optional — the underlying parsers
   * accept `undefined` (no relative-IRI resolution).
   */
  baseIRI?: string;
  /** Default-parser remote-context policy. Ignored with engine. Omit to refuse remote contexts. */
  documentLoader?: DocumentLoader;
}

/** Options for {@link fetchRdf}. */
export interface FetchRdfOptions {
  /** Opt-in parser; omitted by default to retain streaming N3/JSON-LD parsing. */
  engine?: RdfParser;
  /** Default-parser JSON-LD context loader. Ignored with engine. Omit to refuse remote contexts. */
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
 * The default dataset type is Store; engine callers receive FetchedRdf<DatasetCore>.
 */
export interface FetchedRdf<D extends DatasetCore = Store> {
  /** Parsed RDF; an N3 Store by default, or the engine's DatasetCore. */
  dataset: D;
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
