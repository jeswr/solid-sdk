// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { DatasetCore, Quad } from "@rdfjs/types";

/** Supported single-document RDF syntaxes. Remote JSON-LD contexts are not supported. */
export type RdfMediaType =
  | "text/turtle"
  | "application/trig"
  | "application/n-triples"
  | "application/n-quads"
  | "application/ld+json";

/** A dataset or any iterable of RDF/JS quads. */
export type QuadSource = DatasetCore | Iterable<Quad>;
/** Document parsing options. */
export interface ParseOptions {
  baseIri?: string;
}
/** Document serialization options. */
export interface SerializeOptions {
  prefixes?: Record<string, string>;
  pretty?: boolean;
}
export type { ValidationReport, ValidationResult } from "@sparq-org/sparq";

import type { ValidationReport } from "@sparq-org/sparq";

/** Lazy, disposable RDF engine and local named-graph indexes (ADR-007). */
export interface RdfEngine {
  ready(): Promise<void>;
  readonly loaded: boolean;
  /** Optional Sparq build features, detected at initialization; null before loading. */
  readonly features: { serialize: boolean; parseShaclCompact: boolean } | null;
  /** Materialize an RDF/JS DatasetCore with fresh, document-scoped blank-node identities. */
  parse(
    input: string | Uint8Array,
    mediaType: RdfMediaType,
    opts?: ParseOptions,
  ): Promise<DatasetCore>;
  serialize(data: QuadSource, format: RdfMediaType, opts?: SerializeOptions): Promise<string>;
  validate(data: QuadSource, shapes: QuadSource | string): Promise<ValidationReport>;
  canonicalize(data: QuadSource): Promise<string>;
  /** Create an owned local named-graph SPARQL index. */
  createIndex(opts?: IndexOptions): Promise<LocalIndex>;
  dispose(): void;
}

/** RDF/JS solution rows, with string or Variable lookup. */
export type { Bindings } from "@rdfjs/types";

import type { Bindings } from "@rdfjs/types";

/** Single-use pull stream. Exhaustion, return(), or dispose() releases its cursor. */
export interface ResultStream<T> extends AsyncIterableIterator<T> {
  dispose(): void;
}

/** Optional compressed-snapshot storage. Mutations await save; initialization awaits load. */
export interface IndexPersistence {
  load(): Promise<Uint8Array | null>;
  save(bytes: Uint8Array): Promise<void>;
}

/** Local index memory and persistence settings. */
export interface IndexOptions {
  /** Maximum deduplicated quads, default 2,000,000. Oversized single graphs are rejected. */
  maxQuads?: number;
  persist?: IndexPersistence;
}

/** One resource per named graph, with graph-level LRU eviction. */
export interface LocalIndex {
  /** Replace all quads in a graph, assigning the resource IRI as their graph name. */
  put(graphIri: string, data: QuadSource): Promise<void>;
  remove(graphIri: string): Promise<void>;
  has(graphIri: string): boolean;
  /** Number of deduplicated quads across indexed graphs. */
  size(): number;
  /** Resource IRIs, ordered least to most recently put or successfully checked with has(). */
  list(): string[];
  select(sparql: string): Promise<Bindings[]>;
  selectStream(sparql: string): Promise<ResultStream<Bindings>>;
  ask(sparql: string): Promise<boolean>;
  construct(sparql: string): Promise<Quad[]>;
  /** N-Quads compressed as a single gzip member. Empty graphs have no N-Quads representation. */
  snapshot(): Promise<Uint8Array>;
  /** Replace the index from gzip or zstd N-Quads; apply the configured cap in graph order. */
  restore(bytes: Uint8Array): Promise<void>;
  dispose(): void;
}

/** Initialization seam; Sparq itself is imported only on the first operation. */
export interface RdfEngineOptions {
  wasmUrl?: string | URL;
  loader?: () => Promise<typeof import("@sparq-org/sparq")>;
}
