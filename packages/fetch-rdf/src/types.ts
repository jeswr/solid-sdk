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
import type { SUPPORTED_RDF_MEDIA_TYPES } from "./media-types.js";

/** JSON-LD context loader, compatible with the streaming parser's loader seam. */
export interface DocumentLoader {
  load(
    url: string,
    options?: { signal?: AbortSignal; maxBytes?: number },
  ): ReturnType<NonNullable<IJsonLdParserOptions["documentLoader"]>["load"]>;
}

/** RDF syntaxes accepted by the optional parser seam. */
export type RdfMediaType = (typeof SUPPORTED_RDF_MEDIA_TYPES)[number];

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
  /** Maximum input UTF-8 bytes, including an engine buffer. Default: 16 MiB. */
  maxBytes?: number;
  /** Maximum constructed quads (duplicates count). Default: 1,000,000. */
  maxQuads?: number;
  /** Maximum characters per expanded term value, including datatype IRIs. Default: 1 MiB. */
  maxTermLength?: number;
  /** Maximum constructed term characters and term characters across quads, each counted independently. Default: 64 MiB. */
  maxTotalTermLength?: number;
  /** Maximum context load attempts per parse after in-flight coalescing, including nested loads. Default: 32. */
  maxContextRequests?: number;
  /** Maximum simultaneous context loads per parse. Default: 4; must be positive. */
  maxContextConcurrency?: number;
  /** Cancel parsing, body reads and context loads together. Rejects with AbortError. */
  signal?: AbortSignal;
  /** Opt-in parser. Buffered input is budget-validated before engine parsing. */
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
export interface FetchRdfOptions extends Omit<ParseRdfOptions, "baseIRI"> {
  /**
   * The fetch implementation to use. Defaults to `globalThis.fetch` so
   * transport remains caller-controlled. Inject an authenticated fetch for protected
   * resources and a guarded fetch for untrusted URLs on a server.
   */
  fetch?: typeof fetch;
  /**
   * Additional request headers to merge in. The `Accept` header is
   * always overridden with the Solid-default
   * `"text/turtle, application/ld+json;q=0.9"`. Other caller headers enable manual
   * redirects: same-origin hops retain them; cross-origin hops retain only Accept.
   */
  headers?: HeadersInit;
  /**
   * Cancel the request, parsing and context loading. Rejects with AbortError.
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
