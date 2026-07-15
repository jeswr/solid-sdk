// AUTHORED-BY GPT-5.6 Sol via codex

import type { BlankNode, DatasetCore, Literal, NamedNode, Quad, Term } from "@rdfjs/types";

/** A caller-supplied independent SHACL validation seam. */
export interface ShaclValidator {
  validate(data: DatasetCore, shapes: DatasetCore): Promise<{ conforms: boolean; report: string }>;
}

/** One shape and the number of top-level instances to generate. */
export interface TargetSpec {
  shape: NamedNode;
  count: number;
}

/** Exact persona pins for one shape-instance coordinate. */
export interface ShapeOverride {
  shape: NamedNode;
  index?: number;
  id?: { fragment: string } | { external: NamedNode };
  values?: Readonly<Record<string, Term | readonly Term[]>>;
}

/** Parsed constraints exposed to deterministic tier-seven plugins. */
export interface PropertyConstraints {
  path: NamedNode;
  propertyShape: Term;
  datatype?: NamedNode;
  node?: NamedNode;
  class?: NamedNode;
  hasValue: readonly Term[];
  in: readonly Term[];
  /** Whether sh:in was present; distinguishes an absent enumeration from the empty list. */
  inSpecified: boolean;
  minCount: number;
  maxCount?: number;
  minInclusive?: Literal;
  maxInclusive?: Literal;
  minExclusive?: Literal;
  maxExclusive?: Literal;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  language?: "en";
  uniqueLang: boolean;
  order?: number;
}

/** Coordinate-keyed deterministic pseudo-random stream. */
export interface SubStream {
  int(minInclusive: number, maxInclusive: number): number;
  pick<T>(items: readonly T[]): T;
  fork(key: string): SubStream;
}

/** Context passed to an optional value-quality plugin. */
export interface GenerationContext {
  shape: NamedNode;
  index: number;
  focus: NamedNode | BlankNode;
  property: PropertyConstraints;
  random: SubStream;
  now?: Date;
  ontology?: DatasetCore;
}

/** A deterministic tier-seven value-quality plugin. */
export interface ValueGenerator {
  generate(context: GenerationContext): readonly Term[] | undefined;
}

/** Shared options for checked and unchecked generation. */
export interface SyntheticRdfUncheckedOptions {
  shapes: DatasetCore;
  ontology?: DatasetCore;
  seed: string;
  now?: Date;
  targets?: readonly TargetSpec[];
  overrides?: readonly ShapeOverride[];
  base?: string;
  mintIri?: (shape: NamedNode, index: number, base: string) => NamedNode;
  plugins?: readonly ValueGenerator[];
  maxDepth?: number;
  allowedExternalIris?: ReadonlySet<string>;
}

/** Options for generation followed by independent SHACL validation. */
export interface SyntheticRdfOptions extends SyntheticRdfUncheckedOptions {
  validator: ShaclValidator;
}

/** One generated top-level instance and its complete nested subtree. */
export interface GeneratedInstance {
  shape: NamedNode;
  index: number;
  focus: NamedNode | BlankNode;
  quads: readonly Quad[];
}

export interface TurtleOptions {
  prefixes?: Readonly<Record<string, string>>;
  baseIri?: string;
}

/** Generated RDF/JS data with a canonical synchronous Turtle view. */
export interface SyntheticRdfResult {
  dataset: DatasetCore;
  instances: readonly GeneratedInstance[];
  toTurtle(options?: TurtleOptions): string;
}
