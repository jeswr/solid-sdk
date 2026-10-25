// AUTHORED-BY Codex GPT-6.1-Sol
import type { Dataset, DatasetCore, Quad } from "@rdfjs/types";

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

/** Lazy, disposable single-document RDF engine (ADR-007 / T-070). */
export interface RdfEngine {
  ready(): Promise<void>;
  readonly loaded: boolean;
  /** Optional Sparq build features, detected at initialization; null before loading. */
  readonly features: { serialize: boolean; parseShaclCompact: boolean } | null;
  parse(input: string | Uint8Array, mediaType: RdfMediaType, opts?: ParseOptions): Promise<Dataset>;
  serialize(data: QuadSource, format: RdfMediaType, opts?: SerializeOptions): Promise<string>;
  validate(data: QuadSource, shapes: QuadSource | string): Promise<ValidationReport>;
  canonicalize(data: QuadSource): Promise<string>;
  /** Create the named-graph lifecycle foundation; query/persistence arrive in T-071. */
  createIndex(): Promise<LocalIndex>;
  dispose(): void;
}

/** LocalIndex graph lifecycle. T-071 adds SPARQL, snapshots, persistence and LRU. */
export interface LocalIndex {
  /** Replace all quads in a graph, assigning the resource IRI as their graph name. */
  put(graphIri: string, data: QuadSource): Promise<void>;
  remove(graphIri: string): Promise<void>;
  has(graphIri: string): boolean;
  /** Number of deduplicated quads across indexed graphs. */
  size(): number;
  dispose(): void;
}

/** Initialization seam; Sparq itself is imported only on the first operation. */
export interface RdfEngineOptions {
  wasmUrl?: string | URL;
  loader?: () => Promise<typeof import("@sparq-org/sparq")>;
}
