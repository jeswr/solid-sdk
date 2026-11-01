// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 4.8
// AUTHORED-BY Codex GPT-6
/**
 * The interpreter — `defineModel(manifest)` turns a validated shape-manifest into
 * a typed model over `@rdfjs/wrapper`: a `Wrapper` class with per-field accessors,
 * plus `build` / `parse` / `serialize` / `parseDocument`. This is the ONLY code
 * path; a generated `model.js` is a fixed-template shim that inlines a manifest
 * and calls this. Every guard (design §7.3) is applied here, once, so no generated
 * artifact carries any of it.
 *
 * Guard ordering is load-bearing: IRI scheme-filtering + control-char sanitization
 * + fail-closed datatype coercion run at the string→term and term→value
 * boundaries regardless of a value's provenance, so untrusted pod data can never
 * surface an unfiltered term to a caller.
 */

import type { DataFactory, DatasetCore, Term } from "@rdfjs/types";
import {
  type ITermAsValueMapping,
  type ITermFromValueMapping,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  SetFrom,
  TermAs,
  TermFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory as N3DataFactory, Store } from "n3";
import { type DatatypeMapper, iriMapper, literalMapper } from "./datatypes.js";
import {
  httpIriOrUndefined,
  isSafeAbsoluteIri,
  sanitizeText,
  subjectIri,
  tryRead,
} from "./guards.js";
import {
  type CompositeManifestEntity,
  isCompositeEntity,
  type ManifestEntity,
  type ManifestField,
  type ManifestNode,
  type ModelManifest,
  validateManifest,
} from "./manifest.js";
import { serializeTurtle } from "./rdf.js";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDFS_SUBCLASS = "http://www.w3.org/2000/01/rdf-schema#subClassOf";

/** Defense in depth for public type mutations and structural NamedNode writes. */
const safeNamedNodeFrom: ITermFromValueMapping<string> = (value, factory) => {
  if (!isSafeAbsoluteIri(value)) throw new TypeError("NamedNode must be a safe absolute IRI");
  return NamedNodeFrom.string(value, factory);
};

/** A plain, serialisable projection of an entity instance (field name → value). */
export type EntityData = Record<string, unknown>;

/** A wrapper instance exposes per-field accessors plus these structural members. */
export interface EntityWrapper extends TermWrapper {
  /** This subject's IRI. */
  readonly id: string;
  /** The `rdf:type` set, as a live set of IRI strings. */
  readonly types: Set<string>;
  /** Whether a data-graph type reaches any canonical/alias class via subClassOf*. */
  readonly isInstance: boolean;
  /** Stamp this subject with the entity's type IRI(s); returns `this`. */
  mark(): this;
}

export type EntityWrapperConstructor = new (
  term: string | Term,
  dataset: DatasetCore,
  factory: DataFactory,
) => EntityWrapper;

/** The generated operations for a single entity. */
export interface ModelEntity {
  /** The entity name (matches the manifest / generated type). */
  readonly name: string;
  /** The primary `rdf:type` IRI. */
  readonly typeIri: string;
  /** The Wrapper class for direct typed access. */
  readonly Wrapper: EntityWrapperConstructor;
  /** The conventional subject IRI for a document at `resourceUrl`. */
  subject(resourceUrl: string): string;
  /** Build an n3 `Store` from a plain data object (writes through the guards). */
  build(resourceUrl: string, data: EntityData): Store;
  /** Read a data object back from an RDF dataset, or `undefined` if non-conforming. */
  parse(resourceUrl: string, dataset: DatasetCore): EntityData | undefined;
  /** Serialise built RDF to Turtle with the manifest prefixes. */
  serialize(resourceUrl: string, data: EntityData): Promise<string>;
  /** Serialise an existing store to Turtle with the manifest prefixes. */
  storeToTurtle(store: Store): Promise<string>;
  /** Parse a fetched RDF document (any `@jeswr/fetch-rdf` format) into a data object. */
  parseDocument(
    resourceUrl: string,
    body: string,
    contentType?: string | null,
  ): Promise<EntityData | undefined>;
}

/** The interpreted model: one {@link ModelEntity} per manifest entity, by name. */
export interface Model {
  readonly manifest: ModelManifest;
  readonly prefixes: Record<string, string>;
  readonly entities: Record<string, ModelEntity>;
}

export interface DefineModelOptions {
  /** The RDF/JS DataFactory (defaults to n3's). */
  factory?: DataFactory;
  /**
   * Full owning model for generated per-node lenses, validated independently. It adds
   * owning-model context to write-time migration; the primary manifest's preservation
   * checks still run, so it can never weaken a write.
   */
  migrationManifest?: unknown;
}

/** The resolved per-field runtime plan (mapper + subject convention, computed once). */
interface FieldPlan {
  readonly field: ManifestField;
  readonly mapper: DatatypeMapper;
}

function planField(field: ManifestField): FieldPlan {
  const mapper = field.kind === "iri" ? iriMapper() : literalMapper(field.datatype as string);
  return { field, mapper };
}

/** Enum reads compare RDF identity BEFORE conversion can erase lexical spelling. */
function enumTermMatches(doc: TermWrapper, plan: FieldPlan, term: Term): boolean {
  const { field, mapper } = plan;
  if (field.in === undefined) return true;
  return field.in.some(
    (member) =>
      tryRead(() => {
        const canonical = mapper.from(member as never, doc.factory);
        return term.termType === "Literal" && canonical.termType === "Literal"
          ? term.value === canonical.value &&
              term.datatype.value === canonical.datatype.value &&
              term.language === canonical.language
          : term.termType === "NamedNode" &&
              canonical.termType === "NamedNode" &&
              term.value === canonical.value;
      }) === true,
  );
}

function sanitizeLiteral(plan: FieldPlan, value: unknown): unknown {
  return plan.field.kind === "literal" &&
    plan.mapper.jsType === "string" &&
    typeof value === "string" &&
    plan.mapper.lexicalValid === undefined &&
    plan.field.guards?.sanitizeText !== false
    ? sanitizeText(value)
    : value;
}

/** Whether a field is an IRI field carrying the http(s)-only scheme guard. */
function hasIriSchemeGuard(field: ManifestField): boolean {
  return field.kind === "iri" && field.guards?.iriScheme !== undefined;
}

function fieldIri(field: ManifestField, value: unknown): string | undefined {
  const iri = httpIriOrUndefined(value);
  if (iri === undefined || (field.guards?.iriScheme === "https" && !iri.startsWith("https:")))
    return undefined;
  // sh:in names RDF identities. Scheme policy may filter a member, never rewrite
  // it or admit a normalized lookalike that is absent from the enumeration.
  if (field.in !== undefined)
    return typeof value === "string" && field.in.includes(value) ? value : undefined;
  return iri;
}

/** JS projection policy, applied only after the raw RDF term passed its constraints. */
function projectValue(plan: FieldPlan, value: unknown): unknown {
  return hasIriSchemeGuard(plan.field)
    ? fieldIri(plan.field, value)
    : applyDatatypeValidity(plan.mapper, value);
}

/** All term/lexical constraints precede scheme-policy normalization on reads. */
function readTerm(doc: TermWrapper, plan: FieldPlan, term: Term): unknown {
  const { field, mapper } = plan;
  if (!enumTermMatches(doc, plan, term)) return undefined;
  const raw = tryRead(() => mapper.as(new TermWrapper(term, doc.dataset, doc.factory)));
  // IRI lexical safety is projection policy: the bookmark contract permits the
  // scheme filter to remove URL noise. Term kind and SHACL lexical guards still
  // inspect the original spelling; literal datatype checks never repair input.
  const valid =
    field.kind === "iri"
      ? typeof raw === "string"
        ? raw
        : undefined
      : applyDatatypeValidity(mapper, raw);
  const checked = applyScalarGuards(field, valid);
  return projectValue(plan, checked);
}

/**
 * SameValueZero equality (native `Set` semantics: NaN matches NaN; +0 matches -0),
 * extended with `Date` VALUE equality: every read mints a fresh `Date` object, so
 * identity comparison would make `delete(date)` on a dateTime set always miss.
 */
function sameValueZero(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return (
    a === b ||
    (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b))
  );
}

/**
 * Apply the CLOSED, DATA-ONLY value guards (numeric range + string length /
 * non-blank) fail-closed: a value violating a guard is DROPPED (→ `undefined`),
 * never coerced. Numbers are gated by `minInclusive`/`maxInclusive`; strings by
 * `minLength` and the singleton `nonBlank` (whitespace-only) drop. Applied on every
 * read, write, and set-member boundary regardless of the value's provenance.
 */
function applyScalarGuards(field: ManifestField, value: unknown): unknown {
  if (field.in !== undefined && !field.in.some((member) => sameValueZero(member, value)))
    return undefined;
  const g = field.guards;
  if (g === undefined) return value;
  if (typeof value === "number") {
    const hasRange = g.minInclusive !== undefined || g.maxInclusive !== undefined;
    // NaN is unordered — both comparisons are false, so it would slip a range guard;
    // reject it explicitly when any range bound is declared (fail-closed).
    if (hasRange && Number.isNaN(value)) return undefined;
    if (g.minInclusive !== undefined && value < g.minInclusive) return undefined;
    if (g.maxInclusive !== undefined && value > g.maxInclusive) return undefined;
  }
  if (typeof value === "string") {
    if (
      g.iriPattern !== undefined &&
      !value.startsWith("https://") &&
      !(g.iriPattern === "http-https" && value.startsWith("http://"))
    )
      return undefined;
    // minLength counts Unicode CODE POINTS (not UTF-16 code units) to match
    // SHACL/XSD character-length semantics for astral characters.
    if (g.minLength !== undefined && [...value].length < g.minLength) return undefined;
    if (g.nonBlank === true && value.trim() === "") return undefined;
  }
  return value;
}

/**
 * Drop a value that does not conform to its datatype's narrowed value space, fail-
 * closed on every read + write + set-member boundary:
 *   - a NUMERIC field requires a `number` — a non-number (e.g. the STRING `"-1"`) is
 *     dropped, so it can never be serialized as a typed numeric literal
 *     (`"-1"^^xsd:positiveInteger`) — then the datatype's value space is enforced by
 *     its `numericValid` (integer subtypes: safe-integer + sign/range; decimal:
 *     finite; float/double: any number, incl. the permitted NaN/INF/-INF);
 *   - a string outside a `lexicalValid` lexical space (e.g. `xsd:duration`) is dropped.
 */
function applyDatatypeValidity(mapper: DatatypeMapper, value: unknown): unknown {
  if (value === undefined) return undefined;
  if (mapper.jsType === "number") {
    if (typeof value !== "number") return undefined;
    if (mapper.numericValid && !mapper.numericValid(value)) return undefined;
    return value;
  }
  if (mapper.jsType === "string") {
    // A string-mapped field requires a string — a non-string (e.g. `set.add(123)` on
    // an xsd:duration set) is dropped fail-closed rather than reaching the serializer.
    if (typeof value !== "string") return undefined;
    if (mapper.lexicalValid && !mapper.lexicalValid(value)) return undefined;
    return value;
  }
  if (mapper.jsType === "date") {
    // A date field requires a TIME-VALID `Date` — a non-Date, or an `Invalid Date`
    // (whose `toISOString()` would throw the write, and which must never surface on
    // read), is dropped fail-closed like every other malformed value.
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return undefined;
    return value;
  }
  if (mapper.jsType === "boolean" && typeof value !== "boolean") return undefined;
  return value;
}

/**
 * Lazily yield the OBJECT terms of `(subject, predicate, *)` WITHOUT materialising the
 * full match — so a caller can stop early after a bounded number of reads. Prefers n3's
 * lazy `readQuads` generator (which yields on demand and can be abandoned mid-stream);
 * falls back to the RDF/JS `DatasetCore.match` for a non-n3 dataset (correct, if eager).
 * This is the streaming primitive the bounded single-link resolver relies on.
 */
function* matchObjects(dataset: DatasetCore, subject: Term, predicate: Term): Generator<Term> {
  const lazy = (
    dataset as unknown as {
      readQuads?: (s: Term, p: Term, o: Term | null, g: Term | null) => Iterable<{ object: Term }>;
    }
  ).readQuads;
  if (typeof lazy === "function") {
    for (const q of lazy.call(dataset, subject, predicate, null, null)) yield q.object;
    return;
  }
  for (const q of dataset.match(subject, predicate, null, null)) yield q.object;
}

/**
 * Wrap a live set so every `add` AND every read (iteration / has / size / forEach)
 * passes through the datatype + scalar guards fail-closed — a direct
 * `wrapper.field.add("P1W")` (xsd:duration) or `.add(0)` (minInclusive 1) can no
 * longer land an invalid member, and a pre-existing invalid member in untrusted pod
 * data is not surfaced on read. Reads validate raw terms before projection;
 * writes validate the term spelling that will actually be stored.
 * The base writes through @rdfjs/wrapper, while reads isolate malformed raw terms.
 */
function makeGuardedSet(
  doc: TermWrapper,
  predicate: string,
  base: Set<unknown>,
  field: ManifestField,
  mapper: DatatypeMapper,
): Set<unknown> {
  const plan = { field, mapper };
  const guard = (value: unknown): unknown => {
    // For an IRI-scheme field, CANONICALISE first (strip padding, normalise) so the
    // scalar guards (e.g. minLength) evaluate the STORED canonical form, not the raw
    // padded input — otherwise a padded IRI could pass minLength then be stored short.
    const v = projectValue(plan, value);
    return applyScalarGuards(field, v);
  };
  // Read members from the RAW dataset, mapping each object term inside `tryRead` so a
  // malformed member (e.g. a hostile literal on a numeric predicate that would make
  // the @rdfjs/wrapper mapper throw) is DROPPED fail-closed rather than aborting the
  // whole read (iteration / size / parse). Only guard-passing members surface, deduped.
  const validMembers = (): unknown[] => {
    const out: unknown[] = [];
    const seen = new Set<string>();
    const push = (g: unknown) => {
      if (g === undefined) return;
      // Dedup by VALUE. `String(date)` drops milliseconds (two distinct instants in
      // the same second would wrongly dedup), so a Date keys by its ISO instant.
      const key = g instanceof Date ? g.toISOString() : String(g);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(g);
    };
    const pred = doc.factory.namedNode(predicate);
    for (const q of doc.dataset.match(doc as unknown as Term, pred, null, null)) {
      push(readTerm(doc, plan, q.object));
    }
    return out;
  };
  const guarded: Set<unknown> = {
    add(value: unknown) {
      const g = guard(value);
      if (g !== undefined) base.add(g);
      return guarded;
    },
    delete(value: unknown) {
      // Query the projected value; shape constraints apply to stored RDF terms,
      // whose lexical length may differ from this normalized JS value.
      const g = projectValue(plan, value);
      if (g === undefined) return false;
      // Remove every stored member whose GUARDED (canonical) form matches — a
      // non-canonical equivalent (`<http://x.org>` vs `http://x.org/`, `"01"^^integer`
      // vs `1`, `"0.00000010"^^decimal` vs `1e-7`) is still deleted. `base.delete(g)`
      // would serialise only the CANONICAL literal and miss the stored quad, so the
      // raw dataset quads are scanned + compared by SameValueZero and deleted directly.
      let deleted = false;
      const pred = doc.factory.namedNode(predicate);
      for (const q of [...doc.dataset.match(doc as unknown as Term, pred, null, null)]) {
        const gm = readTerm(doc, plan, q.object);
        if (gm !== undefined && sameValueZero(gm, g)) {
          doc.dataset.delete(q);
          deleted = true;
        }
      }
      return deleted;
    },
    has(value: unknown) {
      const g = projectValue(plan, value);
      // Membership by the SAME equality `delete` uses ({@link sameValueZero}: a NaN
      // member matches `has(NaN)` like a native `Set`, and a `Date` compares by
      // INSTANT) — every read mints a fresh `Date` object, so `Array.includes`
      // (object identity for Dates) would report `false` for the very member that
      // `delete(sameInstant)` removes, making has/delete inconsistent.
      return g !== undefined && validMembers().some((m) => sameValueZero(m, g));
    },
    clear() {
      base.clear();
    },
    forEach(callback: (v: unknown, v2: unknown, s: Set<unknown>) => void, thisArg?: unknown) {
      for (const v of validMembers()) callback.call(thisArg, v, v, guarded);
    },
    *keys() {
      yield* validMembers();
    },
    *values() {
      yield* validMembers();
    },
    *entries() {
      for (const value of validMembers()) yield [value, value] as [unknown, unknown];
    },
    *[Symbol.iterator]() {
      yield* validMembers();
    },
    get size() {
      return validMembers().length;
    },
    [Symbol.toStringTag]: "Set",
  } as Set<unknown>;
  return guarded;
}

/** Select the guarded RAW singleton using the documented canonical-first policy. */
function readSingleTerm(doc: TermWrapper, plan: FieldPlan): { term?: Term; present: boolean } {
  const { field } = plan;
  let present = false;
  for (const predicate of [field.predicate, ...(field.aliasPredicates ?? [])]) {
    // Migration reads deliberately resolve canonical first. Check DISTINCT raw
    // terms per predicate before mapping; ambiguity never falls back to aliases.
    let object: Term | undefined;
    for (const candidate of matchObjects(
      doc.dataset,
      doc as unknown as Term,
      doc.factory.namedNode(predicate),
    )) {
      if (object !== undefined && !object.equals(candidate)) return { present: true };
      object = candidate;
    }
    if (object === undefined) continue;
    present = true;
    if (field.maxCount === 0) return { present };
    // Undefined alone triggers fallback: false, zero and the empty string win.
    if (readTerm(doc, plan, object) !== undefined) return { term: object, present };
  }
  return { present };
}

/** Read a single (non-set) field's value, applying read-side guards, fail-closed. */
function readSingle(doc: TermWrapper, plan: FieldPlan): unknown {
  const { field } = plan;
  const { term, present } = readSingleTerm(doc, plan);
  if (term !== undefined) return readTerm(doc, plan, term);
  // A present but malformed value must never be masked by a configured default.
  return !present &&
    !field.guards?.requiredFailClosed &&
    field.maxCount !== 0 &&
    field.default !== undefined
    ? applyScalarGuards(field, projectValue(plan, field.default))
    : undefined;
}

/** Live set for a set field (mutations write through @rdfjs/wrapper's SetFrom). */
function predicateSet(doc: TermWrapper, plan: FieldPlan): Set<unknown> {
  const { field, mapper } = plan;
  if (!isSafeAbsoluteIri(field.predicate)) throw new TypeError("unsafe field predicate");
  const base = SetFrom.subjectPredicate(
    doc,
    field.predicate,
    mapper.as as ITermAsValueMapping<unknown>,
    mapper.from as unknown as ITermFromValueMapping<unknown>,
  );
  // Every set uses the raw-term, per-member tryRead path, including strings and booleans.
  return makeGuardedSet(doc, field.predicate, base as Set<unknown>, field, mapper);
}

/** Delete raw alias quads too, including malformed values a mapper would drop. */
function clearAliases(doc: TermWrapper, field: ManifestField): void {
  for (const alias of field.aliasPredicates ?? []) {
    const predicate = doc.factory.namedNode(alias);
    for (const quad of doc.dataset.match(doc as unknown as Term, predicate, null, null)) {
      doc.dataset.delete(quad);
    }
  }
}

/** Keep raw identities, even when several terms project to the same JS value. */
function retainedSetTerms(doc: TermWrapper, plan: FieldPlan): Term[] {
  const terms: Term[] = [];
  for (const predicate of [plan.field.predicate, ...(plan.field.aliasPredicates ?? [])]) {
    for (const term of matchObjects(
      doc.dataset,
      doc as unknown as Term,
      doc.factory.namedNode(predicate),
    )) {
      if (readTerm(doc, plan, term) !== undefined) terms.push(term);
    }
  }
  return terms;
}

/** Move retained terms through identity mappers, never through the JS writer. */
function replaceFieldTerms(doc: TermWrapper, plan: FieldPlan, terms: Term[]): void {
  if (!isSafeAbsoluteIri(plan.field.predicate)) throw new TypeError("unsafe field predicate");
  const canonical = SetFrom.subjectPredicate(
    doc,
    plan.field.predicate,
    TermAs.term,
    TermFrom.itself,
  );
  clearAliases(doc, plan.field);
  canonical.clear();
  for (const term of terms) {
    // Revalidate the original term, not its normalized/deduplicated projection.
    if (readTerm(doc, plan, term) !== undefined) canonical.add(term);
  }
}

/** A live union of guarded predicate sets; every mutation migrates retained values. */
function fieldSet(
  doc: TermWrapper,
  plan: FieldPlan,
  beforeWrite: () => void = () => {},
): Set<unknown> {
  const canonical = predicateSet(doc, plan);
  const aliases = plan.field.aliasPredicates ?? [];
  if (aliases.length === 0) return canonical;
  const sets = [
    canonical,
    ...aliases.map((predicate) =>
      predicateSet(doc, {
        ...plan,
        field: { ...plan.field, predicate },
      }),
    ),
  ];
  const members = (): unknown[] => {
    const out: unknown[] = [];
    for (const set of sets)
      for (const value of set) {
        if (!out.some((other) => sameValueZero(other, value))) out.push(value);
      }
    return out;
  };
  const union: Set<unknown> = {
    add(value) {
      beforeWrite();
      // Only the explicitly supplied API value goes through the JS write path.
      writeFlatField(
        doc,
        { ...plan, field: { ...plan.field, aliasPredicates: undefined } },
        { [plan.field.name]: [value] },
      );
      return union;
    },
    delete(value) {
      beforeWrite();
      return canonical.delete(value);
    },
    clear() {
      beforeWrite();
      canonical.clear();
    },
    has(value) {
      return sets.some((set) => set.has(value));
    },
    forEach(callback, thisArg?) {
      for (const value of members()) callback.call(thisArg, value, value, union);
    },
    *keys() {
      yield* members();
    },
    *values() {
      yield* members();
    },
    *entries() {
      for (const value of members()) yield [value, value] as [unknown, unknown];
    },
    *[Symbol.iterator]() {
      yield* members();
    },
    get size() {
      return members().length;
    },
    [Symbol.toStringTag]: "Set",
  } as Set<unknown>;
  return union;
}

/** Write a single (non-set) field's value, applying write-side guards, fail-closed. */
function writeSingle(doc: TermWrapper, plan: FieldPlan, value: unknown): void {
  const { field, mapper } = plan;
  if (!isSafeAbsoluteIri(field.predicate)) throw new TypeError("unsafe field predicate");
  clearAliases(doc, field);
  let v = value;
  if (field.kind === "iri") {
    // An IRI value must be a string; the scheme filter (when present) also
    // canonicalises. A non-string is dropped fail-closed BEFORE the scalar guards, so
    // it can never reach NamedNodeFrom.string or slip a minLength/nonBlank guard.
    if (hasIriSchemeGuard(field)) v = fieldIri(field, v);
    else v = applyDatatypeValidity(mapper, v);
    v = applyScalarGuards(field, v); // scalar guards (e.g. minLength) apply to IRI writes too
    OptionalAs.object(
      doc,
      field.predicate,
      v as never,
      safeNamedNodeFrom as (value: never, f: DataFactory) => Term,
    );
    return;
  }
  // Literal field: sanitize a string value; DROP a non-string value fail-closed
  // (a mistyped value must never be coerced into garbage or throw the write). A
  // NARROWED-lexical datatype (e.g. xsd:duration) is NOT sanitized — sanitising first
  // would silently REPAIR an invalid value (`"PT30M\u0000"` → `"PT30M"`); it is
  // validated RAW by applyDatatypeValidity below, so an invalid input drops fail-closed.
  if (v !== undefined && mapper.jsType === "string") {
    v = typeof v === "string" ? sanitizeLiteral(plan, v) : undefined;
  }
  // Lexical validity (e.g. xsd:duration) + numeric-range / string-length guards.
  v = applyDatatypeValidity(mapper, v);
  v = applyScalarGuards(field, v);
  OptionalAs.object(
    doc,
    field.predicate,
    v as never,
    mapper.from as unknown as (value: never, f: DataFactory) => Term,
  );
}

/**
 * Build a Wrapper class that stamps `typeIris` (via `mark`) and installs a per-field
 * accessor for each plan (a live set for a set field; a guarded getter/setter for a
 * single field). Shared by the flat entity and by every composite node — so a node's
 * flat fields go through the exact same audited read/write path as a flat entity's.
 */
function makeWrapperClass(
  owner: ShapeOwner,
  plans: FieldPlan[],
  context: MigrationContext,
): EntityWrapperConstructor {
  const { typeIris, aliasTypeIris = [] } = owner;
  const beforeWrite = (doc: TermWrapper, field?: ManifestField) =>
    migrateBeforeWrite(doc, context, { owner, iri: doc.value, field });
  class Wrapper extends TermWrapper {
    constructor(term: string | Term, dataset: DatasetCore, factory: DataFactory) {
      // A model Wrapper represents a named subject, never a literal or blank node.
      if (typeof term !== "string" && term.termType !== "NamedNode") {
        throw new TypeError("model subject must be a NamedNode");
      }
      subjectIri(typeof term === "string" ? term : term.value);
      super(typeof term === "string" ? factory.namedNode(term) : term, dataset, factory);
    }
    get id(): string {
      return this.value;
    }
    get types(): Set<string> {
      return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, safeNamedNodeFrom);
    }
    get isInstance(): boolean {
      return hasDatasetClass(this, this.value, [...typeIris, ...aliasTypeIris]);
    }
    mark(): this {
      beforeWrite(this);
      const types = this.types;
      for (const t of typeIris) types.add(t);
      return this;
    }
  }

  for (const plan of plans) {
    const { field } = plan;
    if (field.collection === "set") {
      Object.defineProperty(Wrapper.prototype, field.name, {
        get(this: TermWrapper) {
          return fieldSet(this, plan, () => beforeWrite(this, field));
        },
        enumerable: false,
        configurable: true,
      });
    } else {
      Object.defineProperty(Wrapper.prototype, field.name, {
        get(this: TermWrapper) {
          return readSingle(this, plan);
        },
        set(this: TermWrapper, value: unknown) {
          beforeWrite(this, field);
          writeSingle(this, plan, value);
        },
        enumerable: false,
        configurable: true,
      });
    }
  }

  return Wrapper as unknown as EntityWrapperConstructor;
}

/**
 * Write one flat field's value from `data` onto `doc` (the build per-field logic: set
 * members through the guarded set; a single value through {@link writeSingle}, applying
 * emptyStringDrop / defaultNow / materializeDefault). Shared by the flat + composite paths.
 */
function writeFlatField(doc: TermWrapper, plan: FieldPlan, data: EntityData): void {
  const { field } = plan;
  const raw = data[field.name];
  if (field.collection === "set") {
    const set = fieldSet(doc, plan);
    const members = Array.isArray(raw) ? raw : [];
    for (const member of members) {
      let m = sanitizeLiteral(plan, member);
      if (field.guards?.trim && typeof m === "string") m = m.trim();
      if (field.guards?.dropBlank && (m === "" || m === undefined || m === null)) continue;
      // Datatype validity + numeric-range / string-length guards + IRI canonicalisation
      // are ALL applied by the guarded set's `add` (in the correct order), so a raw
      // member is handed straight to it.
      set.add(m);
    }
    return;
  }
  let v = sanitizeLiteral(plan, raw);
  // emptyStringDrop drops ONLY an empty string (not a valid falsy 0 / false).
  if (field.kind === "literal" && field.guards?.emptyStringDrop && v === "") v = undefined;
  if (v === undefined && field.defaultNow) v = new Date();
  if (v === undefined && field.materializeDefault && field.default !== undefined) {
    v = field.default;
  }
  writeSingle(doc, plan, v);
}

/** Count distinct raw identities, before deduplication of the guarded JS projection. */
function setTermsConform(doc: TermWrapper, plan: FieldPlan): boolean {
  const { field } = plan;
  const seen = new Set<string>();
  let validCount = 0;
  for (const predicate of [field.predicate, ...(field.aliasPredicates ?? [])]) {
    for (const term of matchObjects(
      doc.dataset,
      doc as unknown as Term,
      doc.factory.namedNode(predicate),
    )) {
      const key =
        term.termType === "Literal"
          ? JSON.stringify([term.termType, term.value, term.language, term.datatype.value])
          : JSON.stringify([term.termType, term.value]);
      if (seen.has(key)) continue;
      seen.add(key);
      if (field.maxCount !== undefined && seen.size > field.maxCount) return false;
      if (readTerm(doc, plan, term) === undefined) {
        // A surviving member must never mask another raw member's Violation.
        if (field.guards?.requiredFailClosed) return false;
      } else {
        // Optional sets retain their filtering policy, but even their minimum
        // counts RDF identities, not the subsequently deduplicated JS values.
        validCount++;
      }
    }
  }
  const min = Math.max(field.minCount ?? 0, field.guards?.requiredFailClosed ? 1 : 0);
  return validCount >= min;
}

/** sh:node conformance checks EVERY raw value, even on optional fields. */
function flatTermsConform(doc: TermWrapper, plan: FieldPlan): boolean {
  const seen = new Set<string>();
  const { field } = plan;
  for (const predicate of [field.predicate, ...(field.aliasPredicates ?? [])]) {
    for (const term of matchObjects(
      doc.dataset,
      doc as unknown as Term,
      doc.factory.namedNode(predicate),
    )) {
      const key =
        term.termType === "Literal"
          ? JSON.stringify([term.termType, term.value, term.language, term.datatype.value])
          : JSON.stringify([term.termType, term.value]);
      if (seen.has(key)) continue;
      seen.add(key);
      if (field.maxCount !== undefined && seen.size > field.maxCount) return false;
      if (readTerm(doc, plan, term) === undefined) return false;
    }
  }
  return seen.size >= Math.max(field.minCount ?? 0, field.guards?.requiredFailClosed ? 1 : 0);
}

/**
 * Read one flat field from `doc` into `data` (the parse per-field logic). Returns
 * `"reject"` on a required failure, or on any violated constraint in strict nested
 * validation. Root optional fields retain their drop/filter policy. Projection is
 * shared so a migration backstop observes exactly the same values as public parses.
 */
function readFlatFieldInto(
  doc: TermWrapper,
  plan: FieldPlan,
  data: EntityData,
  strict = false,
): "ok" | "reject" {
  if (strict && !flatTermsConform(doc, plan)) return "reject";
  const { field } = plan;
  if (field.collection === "set") {
    if (!setTermsConform(doc, plan)) return field.guards?.requiredFailClosed ? "reject" : "ok";
    const members = [...fieldSet(doc, plan)];
    const arr = field.guards?.sortOnRead
      ? members.slice().sort((a, b) => String(a).localeCompare(String(b)))
      : members;
    if (arr.length > 0) data[field.name] = arr;
    return "ok";
  }
  const value = readSingle(doc, plan);
  if (value === undefined) {
    if (field.guards?.requiredFailClosed) return "reject";
    return "ok";
  }
  data[field.name] = value;
  return "ok";
}

/** The single write-IRI-link primitive — routes through @rdfjs/wrapper (never a hand-built triple). */
function writeIriLink(doc: TermWrapper, predicate: string, targetIri: string): void {
  if (!isSafeAbsoluteIri(predicate)) throw new TypeError("unsafe link predicate");
  OptionalAs.object(
    doc,
    predicate,
    targetIri as never,
    safeNamedNodeFrom as (value: never, f: DataFactory) => Term,
  );
}

/** A write-time migration must preserve every previously recognised projection. */
export class MigrationError extends Error {
  override readonly name = "MigrationError";
}

interface MigrationBudget {
  reads: number;
}
function migrationRead(budget: MigrationBudget): void {
  if (++budget.reads > MAX_CLASS_READS)
    throw new MigrationError("alias migration exceeds the 10,000-read validation budget");
}

/** Count raw field reads as well as shape visits and class traversal during re-parsing. */
function migrationDataset(store: Store, budget: MigrationBudget): DatasetCore {
  return new Proxy(store, {
    get(target, key) {
      if (key === "readQuads")
        return function* (...args: Parameters<Store["readQuads"]>) {
          for (const quad of target.readQuads(...args)) {
            migrationRead(budget);
            yield quad;
          }
        };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

type ShapeOwner = ManifestEntity | ManifestNode;
interface MigrationRequest {
  owner: ShapeOwner;
  iri: string;
  /** A field write migrates this field; mark migrates only explicit type aliases. */
  field?: ManifestField;
}

/**
 * The manifests a write's migration is checked against. `manifest` owns the migration
 * (the full owning model for generated node views); `checkAlso` adds the preservation
 * checks of every other manifest the wrappers were defined from, so an override can only
 * ADD owning context and can never drop a check the primary manifest would run.
 */
interface MigrationContext {
  manifest: ModelManifest;
  checkAlso: readonly ModelManifest[];
}

/** Commit only a checked migration; a failed check cannot change the live dataset. */
function migrateBeforeWrite(
  doc: TermWrapper,
  context: MigrationContext,
  request: MigrationRequest,
): void {
  const output = canonicalizeAliases(doc.dataset, context, doc.factory, request);
  // Snapshot both sides before mutating: a DatasetCore's match() may be live.
  const current = [...doc.dataset.match()];
  for (const quad of current) if (!output.has(quad)) doc.dataset.delete(quad);
  for (const quad of [...output]) if (!doc.dataset.has(quad)) doc.dataset.add(quad);
}

interface MigrationCheck {
  node: ShapeOwner;
  iri: string;
  byName: ReadonlyMap<string, ManifestNode>;
  strict: boolean;
  recognised: boolean;
  before: EntityData | undefined;
}

/** Establish ALL ownership and projections against the original, unmodified graph. */
function aliasFocusNodes(
  store: Store,
  manifest: ModelManifest,
  factory: DataFactory,
  budget: MigrationBudget,
  request?: MigrationRequest,
) {
  const scopes = new Map<ShapeOwner, Set<string>>();
  const checks = new Map<ShapeOwner, Map<string, MigrationCheck>>();
  const linkClasses: { iri: string; hasClass: string }[] = [];
  const readStore = migrationDataset(store, budget);
  const candidates = new Set<string>();
  for (const quad of store.readQuads(null, RDF_TYPE, null, null)) {
    migrationRead(budget);
    if (quad.subject.termType === "NamedNode" && isSafeAbsoluteIri(quad.subject.value))
      candidates.add(quad.subject.value);
  }
  for (const entity of manifest.entities) {
    const byName = new Map(
      (isCompositeEntity(entity) ? entity.nodes : []).map((node) => [node.name, node]),
    );
    const root = isCompositeEntity(entity) ? byName.get(entity.root) : entity;
    if (!root) continue;
    const remember = (node: ShapeOwner, iri: string, recognised: boolean): void => {
      let subjects = checks.get(node);
      if (!subjects) {
        subjects = new Map();
        checks.set(node, subjects);
      }
      const existing = subjects.get(iri);
      if (existing) {
        existing.recognised ||= recognised;
        return;
      }
      migrationRead(budget);
      const strict = node !== root;
      subjects.set(iri, {
        node,
        iri,
        byName,
        strict,
        recognised,
        before: parseShapeAt(node, iri, readStore, factory, byName, strict, {
          visits: 0,
          migration: budget,
        }),
      });
    };
    const visit = (node: ShapeOwner, iri: string): void => {
      let subjects = scopes.get(node);
      if (!subjects) {
        subjects = new Set();
        scopes.set(node, subjects);
      }
      if (subjects.has(iri)) return;
      subjects.add(iri);
      remember(node, iri, false);
      const doc = new TermWrapper(factory.namedNode(iri), store, factory);
      for (const field of node.fields) {
        if (field.kind !== "nested") continue;
        const child = byName.get(field.node as string);
        const link = resolveNestedTarget(doc, field.predicate);
        if (
          child &&
          !link.reject &&
          link.target !== undefined &&
          (field.hasClass === undefined ||
            hasDatasetClass(doc, link.target, [field.hasClass], budget))
        ) {
          if (field.hasClass !== undefined)
            linkClasses.push({ iri: link.target, hasClass: field.hasClass });
          visit(child, link.target);
        }
      }
    };
    // Snapshot every node shape that recognises a typed subject, even when that
    // node is not reachable from a composite root and will not itself migrate.
    for (const node of isCompositeEntity(entity) ? entity.nodes : [entity]) {
      for (const iri of candidates) {
        migrationRead(budget);
        const doc = new TermWrapper(factory.namedNode(iri), store, factory);
        if (hasDatasetClass(doc, iri, [...node.typeIris, ...(node.aliasTypeIris ?? [])], budget)) {
          remember(node, iri, true);
          if (node === root) visit(root, iri);
        }
      }
    }
  }
  const allChecks = [...checks.values()].flatMap((subjects) => [...subjects.values()]);
  // Direct wrappers may write an untyped or unreached focus. Include that focus
  // without discarding any checks or link-class proofs from the full owning model.
  if (request) {
    const subjects = scopes.get(request.owner) ?? new Set<string>();
    subjects.add(request.iri);
    scopes.set(request.owner, subjects);
    // Synthesize the focus check only in the manifest that OWNS the writing wrapper's
    // shape: every scan shares one budget, so a second (override) scan re-checking the
    // same projection would only double-count reads and reject legitimate large writes.
    const owns = manifest.entities.some((entity) =>
      isCompositeEntity(entity)
        ? entity.nodes.includes(request.owner as ManifestNode)
        : entity === request.owner,
    );
    if (owns && !checks.get(request.owner)?.has(request.iri)) {
      const composite = manifest.entities.find(
        (entity) =>
          isCompositeEntity(entity) && entity.nodes.includes(request.owner as ManifestNode),
      );
      const byName = new Map(
        composite && isCompositeEntity(composite)
          ? composite.nodes.map((node) => [node.name, node])
          : [],
      );
      allChecks.push({
        node: request.owner,
        iri: request.iri,
        byName,
        strict: false,
        recognised: false,
        before: parseShapeAt(request.owner, request.iri, readStore, factory, byName, false, {
          visits: 0,
          migration: budget,
        }),
      });
    }
  }
  return { scopes, checks: allChecks, linkClasses };
}

function sameProjection(a: EntityData | undefined, b: EntityData | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => {
      if (!Object.hasOwn(b, key)) return false;
      const left = a[key],
        right = b[key];
      return Array.isArray(left) && Array.isArray(right)
        ? left.length === right.length &&
            left.every((value) => right.some((other) => sameValueZero(value, other)))
        : sameValueZero(left, right);
    })
  );
}

/** Canonicalise aliases only at their owning shapes' focus nodes, in a COPY. */
function canonicalizeAliases(
  dataset: DatasetCore,
  context: MigrationContext,
  factory: DataFactory,
  request?: MigrationRequest,
): Store {
  const { manifest } = context;
  const store = new Store([...dataset.match()]);
  const budget: MigrationBudget = { reads: 0 };
  const { scopes, checks, linkClasses } = aliasFocusNodes(
    store,
    manifest,
    factory,
    budget,
    request,
  );
  // Every other defining manifest's checks run too, under the same shared budget and
  // with the same write focus: the wrappers' owners belong to the PRIMARY manifest, so
  // only its scan can resolve an untyped, unreached composite focus.
  for (const other of context.checkAlso)
    checks.push(...aliasFocusNodes(store, other, factory, budget, request).checks);
  const selectedScopes = request ? new Map([[request.owner, new Set([request.iri])]]) : scopes;
  const output = new Store([...store]);
  const migratingTypes = new Set<string>();
  for (const [node, subjects] of selectedScopes)
    for (const iri of subjects) {
      if (
        !request?.field &&
        node.aliasTypeIris?.some((alias) => store.countQuads(iri, RDF_TYPE, alias, null))
      )
        migratingTypes.add(iri);
    }
  // Preserve actual DATA-graph class proofs before alias rdf:type deletion.
  for (const { iri, hasClass } of linkClasses) {
    if (!migratingTypes.has(iri)) continue;
    const doc = new TermWrapper(factory.namedNode(iri), output, factory);
    SetFrom.subjectPredicate(doc, RDF_TYPE, NamedNodeAs.string, safeNamedNodeFrom).add(hasClass);
  }
  for (const [node, subjects] of selectedScopes) {
    for (const field of node.fields) {
      if (request && field !== request.field) continue;
      if (!field.aliasPredicates?.length) continue;
      const plan = planField(field);
      for (const subject of subjects) {
        if (!field.aliasPredicates.some((alias) => output.countQuads(subject, alias, null, null))) {
          continue;
        }
        const doc = new TermWrapper(factory.namedNode(subject), output, factory);
        const terms =
          field.collection === "set"
            ? retainedSetTerms(doc, plan)
            : (() => {
                const { term } = readSingleTerm(doc, plan);
                return term === undefined ? [] : [term];
              })();
        replaceFieldTerms(doc, plan, terms);
      }
    }
    for (const alias of request?.field ? [] : (node.aliasTypeIris ?? [])) {
      for (const subject of subjects) {
        const doc = new TermWrapper(factory.namedNode(subject), output, factory);
        const types = SetFrom.subjectPredicate(
          doc,
          RDF_TYPE,
          NamedNodeAs.string,
          safeNamedNodeFrom,
        );
        if (types.delete(alias)) {
          for (const type of node.typeIris) types.add(type);
        }
      }
    }
  }
  const readOutput = migrationDataset(output, budget);
  for (const check of checks) {
    migrationRead(budget);
    const doc = new TermWrapper(factory.namedNode(check.iri), output, factory);
    if (
      check.recognised &&
      !hasDatasetClass(
        doc,
        check.iri,
        [...check.node.typeIris, ...(check.node.aliasTypeIris ?? [])],
        budget,
      )
    ) {
      throw new MigrationError(
        `alias migration changed type recognition for ${check.node.name} at ${check.iri}`,
      );
    }
    const after = parseShapeAt(
      check.node,
      check.iri,
      readOutput,
      factory,
      check.byName,
      check.strict,
      {
        visits: 0,
        migration: budget,
      },
    );
    if (!sameProjection(check.before, after))
      throw new MigrationError(
        `alias migration changed the parsed result for ${check.node.name} at ${check.iri}`,
      );
  }
  return output;
}

/** Assemble the shared serialize / storeToTurtle / parseDocument members over build + parse. */
function assembleEntity(
  core: {
    name: string;
    typeIri: string;
    Wrapper: EntityWrapperConstructor;
    subject: (resourceUrl: string) => string;
    build: (resourceUrl: string, data: EntityData) => Store;
    parse: (resourceUrl: string, dataset: DatasetCore) => EntityData | undefined;
  },
  context: MigrationContext,
  factory: DataFactory,
): ModelEntity {
  const { manifest } = context;
  const storeToTurtle = (store: Store): Promise<string> => {
    const aliases = manifest.entities
      .flatMap<ManifestEntity | ManifestNode>((entity) =>
        isCompositeEntity(entity) ? entity.nodes : [entity],
      )
      .flatMap((node) => [
        ...(node.aliasTypeIris ?? []),
        ...node.fields.flatMap((field) => field.aliasPredicates ?? []),
      ]);
    return serializeTurtle(
      canonicalizeAliases(store, context, factory),
      manifest.prefixes,
      aliases,
    );
  };
  const serialize = (resourceUrl: string, data: EntityData): Promise<string> =>
    storeToTurtle(core.build(resourceUrl, data));
  const parseDocument = async (
    resourceUrl: string,
    body: string,
    contentType: string | null = "text/turtle",
  ): Promise<EntityData | undefined> => {
    if (!isSafeAbsoluteIri(resourceUrl)) return undefined;
    const resolvedContentType = contentType ?? "text/turtle";
    const { parseRdf } = await import("@jeswr/fetch-rdf");
    const dataset = await parseRdf(body, resolvedContentType, { baseIRI: resourceUrl });
    return core.parse(resourceUrl, dataset);
  };
  return { ...core, serialize, storeToTurtle, parseDocument };
}

function makeEntity(
  entity: ManifestEntity,
  factory: DataFactory,
  migrationManifest: MigrationContext,
): ModelEntity {
  const plans = entity.fields.map(planField);
  const Wrapper = makeWrapperClass(entity, plans, migrationManifest);

  const subject = (resourceUrl: string): string =>
    subjectIri(resourceUrl, entity.subject.convention === "hash-it" ? "it" : undefined);

  const build = (resourceUrl: string, data: EntityData): Store => {
    const store = new Store();
    const doc = new Wrapper(subject(resourceUrl), store, factory);
    doc.mark();
    for (const plan of plans) {
      migrateBeforeWrite(doc, migrationManifest, {
        owner: entity,
        iri: doc.value,
        field: plan.field,
      });
      writeFlatField(doc, plan, data);
    }
    return store;
  };

  const parse = (resourceUrl: string, dataset: DatasetCore): EntityData | undefined => {
    if (!isSafeAbsoluteIri(resourceUrl)) return undefined;
    const iri = entity.subject.convention === "hash-it" ? `${resourceUrl}#it` : resourceUrl;
    if (!isSafeAbsoluteIri(iri)) return undefined;
    const doc = new Wrapper(subject(resourceUrl), dataset, factory);
    if (!doc.isInstance) return undefined;
    return parseShapeAt(entity, iri, dataset, factory);
  };

  return assembleEntity(
    { name: entity.name, typeIri: entity.typeIris[0] as string, Wrapper, subject, build, parse },
    migrationManifest,
    factory,
  );
}

/** The resolved per-node runtime of a composite entity (mirrors a flat entity's plan). */
interface NodeRuntime {
  readonly node: ManifestNode;
  readonly Wrapper: EntityWrapperConstructor;
  /** Plans for the node's FLAT (non-nested) fields. */
  readonly plans: FieldPlan[];
  /** The node's outgoing `nested` link fields. */
  readonly nested: ManifestField[];
}

/**
 * A global fail-closed budget on sub-node parse ATTEMPTS per composite parse — a defensive
 * backstop against a pathological manifest tree. A single-valued nested link resolves to
 * at most one target (ambiguity is rejected up-front), so the graph-walk is linear in the
 * tree; a legitimate document visits O(nodes) sub-nodes. This ceiling is far above any real
 * composite, and exceeding it fails the parse closed (returns undefined) rather than looping.
 */
const MAX_NODE_VISITS = 10000;

/**
 * A per-link READ budget — the number of raw object terms the single-link resolver will
 * examine on one predicate before failing closed. A legitimate maxCount-1 link has one
 * object; this bound stops a hostile document from forcing a large scan/allocation with a
 * fan-out of duplicate / non-http / distinct objects on one predicate (the streaming
 * resolver stops at the second distinct target or this many reads, whichever comes first).
 */
const MAX_LINK_READS = 32;

/** Bound dataset type/subclass traversal, including duplicate quads across graphs. */
const MAX_CLASS_READS = 10000;

/** SHACL class membership is rdf:type followed by rdfs:subClassOf* in the data. */
function hasDatasetClass(
  doc: TermWrapper,
  subject: string,
  required: readonly string[],
  budget?: MigrationBudget,
): boolean {
  const accepted = new Set(required);
  const pending: Term[] = [];
  const seen = new Set<string>();
  let reads = 0;
  const enqueue = (term: Term): boolean => {
    if (term.termType !== "NamedNode" && term.termType !== "BlankNode") return false;
    if (term.termType === "NamedNode" && accepted.has(term.value)) return true;
    const key = JSON.stringify([term.termType, term.value]);
    if (!seen.has(key)) {
      seen.add(key);
      pending.push(term);
    }
    return false;
  };
  for (const type of matchObjects(
    doc.dataset,
    doc.factory.namedNode(subject),
    doc.factory.namedNode(RDF_TYPE),
  )) {
    if (budget) migrationRead(budget);
    if (++reads > MAX_CLASS_READS) return false;
    if (enqueue(type)) return true;
  }
  const subClassOf = doc.factory.namedNode(RDFS_SUBCLASS);
  while (pending.length) {
    const type = pending.pop() as Term;
    for (const parent of matchObjects(doc.dataset, type, subClassOf)) {
      if (budget) migrationRead(budget);
      if (++reads > MAX_CLASS_READS) return false;
      if (enqueue(parent)) return true;
    }
  }
  return false;
}

interface NestedTargetResolution {
  /**
   * The link failed to resolve — ambiguous (>1 distinct target) or over the read budget.
   * The DISPOSITION is graded at the call site (SHACL G1 grading): a Violation-graded
   * (`requiredFailClosed`) link rejects the whole composite; an optional (Warning/Info)
   * link drops its field and admits.
   */
  readonly reject: boolean;
  /** The exact lexical http(s) target, when resolved and unambiguous (else undefined). */
  readonly target?: string;
  readonly present?: boolean;
}

/**
 * Resolve the SINGLE target of a `nested` (maxCount-1) link FAIL-CLOSED, streaming the raw
 * object terms with EARLY exit — never materialising the full candidate list. A non-http(s)
 * / unsafe IRI rejects the link. All raw term kinds count towards ambiguity. The instant a
 * SECOND distinct RDF target is seen the link is rejected; and if the raw object
 * reads exceed {@link MAX_LINK_READS} before resolving, the link is rejected (a hostile
 * fan-out on one predicate must not force unbounded work). Safe lexical IRIs are followed
 * exactly, preserving the linked RDF subject without URL canonicalisation. How a rejected link
 * affects the composite is decided by the CALLER per the link's grade (see
 * {@link NestedTargetResolution.reject}) — the resolver only reports the link failure.
 */
function resolveNestedTarget(doc: TermWrapper, predicate: string): NestedTargetResolution {
  const pred = doc.factory.namedNode(predicate);
  let target: string | undefined;
  let raw: Term | undefined;
  let reads = 0;
  for (const object of matchObjects(doc.dataset, doc as unknown as Term, pred)) {
    if (++reads > MAX_LINK_READS) return { reject: true };
    if (raw !== undefined && !raw.equals(object)) return { reject: true };
    raw = object;
    if (object.termType !== "NamedNode") continue;
    // Validate the lexical IRI without URL.href rewriting RDF subject identity.
    if (!isSafeAbsoluteIri(object.value) || !/^https?:\/\//i.test(object.value)) {
      return { reject: true };
    }
    if (target === undefined) target = object.value;
  }
  return { reject: false, target, present: raw !== undefined };
}

/** Parse at an ACTUAL focus IRI; only nested focus nodes use strict conformance. */
function parseShapeAt(
  node: ManifestEntity | ManifestNode,
  iri: string,
  dataset: DatasetCore,
  factory: DataFactory,
  byName: ReadonlyMap<string, ManifestNode> = new Map(),
  strict = false,
  budget: { visits: number; migration?: MigrationBudget } = { visits: 0 },
): EntityData | undefined {
  if (budget.migration) migrationRead(budget.migration);
  if (++budget.visits > MAX_NODE_VISITS || !isSafeAbsoluteIri(iri)) return undefined;
  const doc = new TermWrapper(factory.namedNode(iri), dataset, factory);
  const data: EntityData = {};
  for (const field of node.fields) {
    if (field.kind !== "nested") {
      if (readFlatFieldInto(doc, planField(field), data, strict) === "reject") return undefined;
      continue;
    }
    const child = byName.get(field.node as string);
    if (!child) return undefined;
    const required = field.guards?.requiredFailClosed === true;
    const link = resolveNestedTarget(doc, field.predicate);
    if (link.reject) {
      if (required || strict) return undefined;
      continue;
    }
    const childData =
      link.target !== undefined &&
      (field.hasClass === undefined ||
        hasDatasetClass(doc, link.target, [field.hasClass], budget.migration))
        ? parseShapeAt(child, link.target, dataset, factory, byName, true, budget)
        : undefined;
    if (budget.visits > MAX_NODE_VISITS) return undefined;
    if (childData === undefined) {
      // An optional edge may degrade at the root. Inside sh:node a present
      // violation makes THIS child non-conforming; its incoming edge grades it.
      if (required || (strict && (link.present || (field.minCount ?? 0) > 0))) return undefined;
      continue;
    }
    Object.assign(data, childData);
  }
  return data;
}

function makeCompositeEntity(
  entity: CompositeManifestEntity,
  factory: DataFactory,
  migrationManifest: MigrationContext,
): ModelEntity {
  const runtimes = new Map<string, NodeRuntime>();
  for (const node of entity.nodes) {
    const plans = node.fields.filter((f) => f.kind !== "nested").map(planField);
    const nested = node.fields.filter((f) => f.kind === "nested");
    runtimes.set(node.name, {
      node,
      Wrapper: makeWrapperClass(node, plans, migrationManifest),
      plans,
      nested,
    });
  }
  const rootRt = runtimes.get(entity.root);
  // The validator guarantees the root resolves; this is a defence-in-depth assertion.
  if (!rootRt) throw new Error(`composite root "${entity.root}" has no node runtime`);

  const nodeIri = (rt: NodeRuntime, resourceUrl: string): string =>
    subjectIri(resourceUrl, rt.node.fragment);

  const subject = (resourceUrl: string): string => nodeIri(rootRt, resourceUrl);

  // Whether a node's subtree carries CONTENT on build — either supplied `data` OR a
  // build-time default that `writeFlatField` materialises even when the value is absent
  // (`defaultNow`, `materializeDefault` with a default). A node is materialised only when
  // its subtree has content, so an absent OPTIONAL sub-node leaves no bare typed shell —
  // but a node whose fields are wholly DEFAULTED still materialises (matching the flat
  // build path, so a required defaulted sub-node is never silently omitted).
  const subtreeHasData = (rt: NodeRuntime, data: EntityData): boolean => {
    for (const plan of rt.plans) {
      const { field } = plan;
      const v = data[field.name];
      if (v !== undefined && !(Array.isArray(v) && v.length === 0)) return true;
      if (field.defaultNow) return true;
      if (field.materializeDefault && field.default !== undefined) return true;
    }
    for (const nf of rt.nested) {
      const child = runtimes.get(nf.node as string);
      if (child && subtreeHasData(child, data)) return true;
    }
    return false;
  };

  const build = (resourceUrl: string, data: EntityData): Store => {
    const store = new Store();
    const buildNode = (rt: NodeRuntime, force: boolean): string | undefined => {
      if (!force && !subtreeHasData(rt, data)) return undefined;
      const iri = nodeIri(rt, resourceUrl);
      const doc = new rt.Wrapper(iri, store, factory);
      doc.mark();
      for (const plan of rt.plans) {
        migrateBeforeWrite(doc, migrationManifest, {
          owner: rt.node,
          iri: doc.value,
          field: plan.field,
        });
        writeFlatField(doc, plan, data);
      }
      for (const nf of rt.nested) {
        const child = runtimes.get(nf.node as string);
        if (!child) continue;
        const childIri = buildNode(child, false);
        if (childIri !== undefined) {
          // Assert the shape's explicit class on writes; build-time ontology
          // ancestry is not available to a validator of the resulting document.
          if (nf.hasClass !== undefined) {
            new child.Wrapper(childIri, store, factory).types.add(nf.hasClass);
          }
          writeIriLink(doc, nf.predicate, childIri);
        }
      }
      return iri;
    };
    buildNode(rootRt, true);
    return store;
  };

  const parse = (resourceUrl: string, dataset: DatasetCore): EntityData | undefined => {
    if (!isSafeAbsoluteIri(resourceUrl)) return undefined;
    const rootIri = `${resourceUrl}#${rootRt.node.fragment}`;
    if (!isSafeAbsoluteIri(rootIri)) return undefined;
    // Target classes select root resources; sh:node applies child property constraints
    // without making the child shape's target classes an additional constraint.
    if (!new rootRt.Wrapper(rootIri, dataset, factory).isInstance) return undefined;
    return parseShapeAt(
      rootRt.node,
      rootIri,
      dataset,
      factory,
      new Map(entity.nodes.map((node) => [node.name, node])),
    );
  };

  return assembleEntity(
    {
      name: entity.name,
      typeIri: rootRt.node.typeIris[0] as string,
      Wrapper: rootRt.Wrapper,
      subject,
      build,
      parse,
    },
    migrationManifest,
    factory,
  );
}

/**
 * Interpret a shape-manifest into a typed {@link Model}. The manifest is validated
 * FAIL-CLOSED first ({@link validateManifest}); an invalid manifest throws before
 * any accessor is installed.
 */
export function defineModel(input: unknown, options: DefineModelOptions = {}): Model {
  const manifest = validateManifest(input);
  const factory = options.factory ?? (N3DataFactory as unknown as DataFactory);
  // An override supplies the owning model's migration context; the primary manifest's
  // own preservation checks always still run, so the option can never weaken a write.
  const migrationManifest: MigrationContext =
    options.migrationManifest === undefined
      ? { manifest, checkAlso: [] }
      : { manifest: validateManifest(options.migrationManifest), checkAlso: [manifest] };
  const entities: Record<string, ModelEntity> = {};
  for (const entity of manifest.entities) {
    entities[entity.name] = isCompositeEntity(entity)
      ? makeCompositeEntity(entity, factory, migrationManifest)
      : makeEntity(entity, factory, migrationManifest);
  }
  return { manifest, prefixes: { ...manifest.prefixes }, entities };
}
