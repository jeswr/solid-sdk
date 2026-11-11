// AUTHORED-BY Codex GPT-6
/**
 * `@jeswr/fetch-rdf` — canonical fetch + parse helpers for Solid RDF.
 *
 * {@link parseRdf} dispatches a body
 * (string or stream) on its `Content-Type` (Turtle / N-Triples /
 * N-Quads / TriG via `n3`; JSON-LD via `jsonld-streaming-parser`),
 * streaming chunks straight into an `N3.Store`. {@link fetchRdf}
 * orchestrates an HTTP GET + parse and returns the dataset alongside
 * the response headers.
 * {@link parseRdfSync} preserves synchronous buffered N3-family read contracts.
 *
 * @packageDocumentation
 */

/**
 * The RDF/JS types of the parsed dataset, re-exported so that layered consumers (e.g.
 * `@jeswr/storage-client`) can name them in public declarations without depending on
 * `@rdfjs/types` themselves.
 */
export type { DatasetCore, Quad, Term } from "@rdfjs/types";
export { createFetchDocumentLoader } from "./document-loader.js";
export type { RdfFetchErrorOptions } from "./errors.js";
export { RdfFetchError } from "./errors.js";
export { fetchRdf } from "./fetch.js";
export type { RdfBody } from "./parse.js";
export { extractMediaType, parseRdf, parseRdfSync, SUPPORTED_RDF_MEDIA_TYPES } from "./parse.js";
export type {
  DocumentLoader,
  FetchedRdf,
  FetchRdfOptions,
  ParseRdfOptions,
  ParseRdfSyncOptions,
  RdfMediaType,
  RdfParser,
} from "./types.js";
