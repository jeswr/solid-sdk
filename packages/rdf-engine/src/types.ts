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

/** Request inputs supported by the authoritative solid-odrl evaluator. */
export interface PolicyContext {
  action: string;
  target: string;
  assignee?: string;
  purpose?: string;
  now?: Date;
}
/** Decision and stable identifiers of matching rules and active unfulfilled duties. */
export interface PolicyResult {
  allow: boolean;
  matched: string[];
  unmet: string[];
}
/** Options passed verbatim to Sparq's form derivation. */
export interface FormOptions {
  mode: "edit" | "view";
  shape?: string;
}

/** Lazy, disposable single-document RDF engine (ADR-007 / T-070). */
export interface RdfEngine {
  ready(): Promise<void>;
  readonly loaded: boolean;
  /** Optional Sparq build features, detected at initialization; null before loading. */
  readonly features: {
    serialize: boolean;
    parseShaclCompact: boolean;
    /** A versioned policy export is available; no WASM policy adapter is enabled yet. */
    policyEvaluate: boolean;
  } | null;
  /** Materialize an RDF/JS DatasetCore with fresh, document-scoped blank-node identities. */
  parse(
    input: string | Uint8Array,
    mediaType: RdfMediaType,
    opts?: ParseOptions,
  ): Promise<DatasetCore>;
  serialize(data: QuadSource, format: RdfMediaType, opts?: SerializeOptions): Promise<string>;
  validate(data: QuadSource, shapes: QuadSource | string): Promise<ValidationReport>;
  canonicalize(data: QuadSource): Promise<string>;
  /** Evaluate the first policy using solid-odrl; unfulfilled duties remain advisory. */
  evaluatePolicy(policy: DatasetCore, ctx: PolicyContext): Promise<PolicyResult>;
  /** Return Sparq's FormDescription JSON without reconstructing its fields. */
  deriveForm(
    data: DatasetCore,
    shapes: DatasetCore,
    focus: string,
    opts: FormOptions,
  ): Promise<unknown>;
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
