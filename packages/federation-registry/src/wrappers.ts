// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Typed @rdfjs/wrapper accessors over a fedreg: registry / membership / storage
// graph. This is the ONLY place RDF terms are read/written for the federation
// registry vocab: the SDK surface (build/parse/verify) goes through these
// wrappers, never through hand-built quads (the suite house rule). Reading uses
// SetFrom.subjectPredicate (term-type-preserving); writing uses NamedNodeFrom +
// LiteralFrom + the dataset add, all from @rdfjs/wrapper.

import type { DataFactory as DataFactoryType, DatasetCore, Quad, Term } from "@rdfjs/types";
import {
  BlankNodeFrom,
  DatasetWrapper,
  LiteralFrom,
  NamedNodeFrom,
  SetFrom,
  TermAs,
  TermFrom,
  TermWrapper,
  type TermWrapper as TermWrapperType,
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import {
  FEDREG_ACCEPTS_SPEC,
  FEDREG_APP,
  FEDREG_ASSERTED,
  FEDREG_ASSERTED_BY,
  FEDREG_MEMBER,
  FEDREG_MEMBERSHIP,
  FEDREG_REGISTRY,
  FEDREG_STATUS,
  FEDREG_STORAGE,
  FEDREG_STORAGE_DESCRIPTION,
  FEDREG_SUPPORTS_SECTOR,
  RDF_TYPE,
} from "./vocab.js";

const XSD_DATETIME = "http://www.w3.org/2001/XMLSchema#dateTime";

/**
 * Read a property's objects as a Set of the OBJECT TERMS themselves (not their
 * lexical `.value`) so the term TYPE survives the read. For an IRI-valued property
 * this lets the validation layer inspect `.termType` and reject a literal / blank
 * node where an IRI is required (a malformed graph a lexical-only read would
 * silently accept); for the literal-valued `fedreg:asserted` it simply yields the
 * literal term. Mirrors the term-type-preserving pattern in @jeswr/federation-client.
 */
function objectTerms(node: TermWrapper, predicate: string): Set<TermWrapperType> {
  return SetFrom.subjectPredicate(node, predicate, TermAs.instance(TermWrapper), TermFrom.instance);
}

/**
 * A typed view of a `fedreg:Membership` node. Each IRI-valued property is exposed
 * as a Set of object TERMS (so the validator can reject non-`NamedNode` objects);
 * `asserted` is a single literal value.
 */
export class MembershipNode extends TermWrapper {
  get apps(): Set<TermWrapperType> {
    return objectTerms(this, FEDREG_APP);
  }

  get statuses(): Set<TermWrapperType> {
    return objectTerms(this, FEDREG_STATUS);
  }

  get assertedBy(): Set<TermWrapperType> {
    return objectTerms(this, FEDREG_ASSERTED_BY);
  }

  /** The `fedreg:asserted` lexical value (first one found), or undefined. */
  get asserted(): string | undefined {
    for (const term of objectTerms(this, FEDREG_ASSERTED)) {
      return term.value;
    }
    return undefined;
  }
}

/** A typed view of a `fedreg:StorageDescription` node. */
export class StorageNode extends TermWrapper {
  get acceptsSpec(): Set<TermWrapperType> {
    return objectTerms(this, FEDREG_ACCEPTS_SPEC);
  }

  get supportsSector(): Set<TermWrapperType> {
    return objectTerms(this, FEDREG_SUPPORTS_SECTOR);
  }

  get storage(): Set<TermWrapperType> {
    return objectTerms(this, FEDREG_STORAGE);
  }
}

/** A typed view of a `fedreg:Registry` node. */
export class RegistryNode extends TermWrapper {
  /** The `fedreg:Membership` nodes linked via `fedreg:member`. */
  get members(): Set<MembershipNode> {
    return SetFrom.subjectPredicate(
      this,
      FEDREG_MEMBER,
      TermAs.instance(MembershipNode),
      TermFrom.instance,
    );
  }
}

/**
 * A dataset wrapper for a registry / storage document. Finds the typed subjects
 * in the graph.
 */
export class RegistryDataset extends DatasetWrapper {
  /** Every `fedreg:Registry` subject. */
  registries(): RegistryNode[] {
    return [...this.instancesOf(FEDREG_REGISTRY, RegistryNode)];
  }

  /** Every `fedreg:Membership` subject (whether or not linked into a Registry). */
  memberships(): MembershipNode[] {
    return [...this.instancesOf(FEDREG_MEMBERSHIP, MembershipNode)];
  }

  /** Every `fedreg:StorageDescription` subject. */
  storageDescriptions(): StorageNode[] {
    return [...this.instancesOf(FEDREG_STORAGE_DESCRIPTION, StorageNode)];
  }

  /** A typed view of a single membership subject. */
  membership(id: string): MembershipNode {
    return new MembershipNode(id, this, this.factory);
  }
}

/**
 * Wrap an `RDF.DatasetCore` (e.g. the `N3.Store` from `fetchRdf`) as a
 * {@link RegistryDataset}. One `n3` `DataFactory` is used throughout so term
 * equality / Set de-duplication hold.
 */
export function wrap(dataset: DatasetCore): RegistryDataset {
  return new RegistryDataset(dataset, DataFactory as unknown as DataFactoryType);
}

// --- the write path (build) ----------------------------------------------

/** Add a `(subject, predicate-IRI, object-IRI)` triple through the factory. */
function addIriTriple(node: TermWrapper, predicate: string, objectIri: string): void {
  const factory = node.factory;
  const subject = node as unknown as Term;
  const p = NamedNodeFrom.string(predicate, factory);
  const o = NamedNodeFrom.string(objectIri, factory);
  node.dataset.add(factory.quad(subject as never, p as never, o as never));
}

/** Add a `(subject, predicate-IRI, typed-literal)` triple through the factory. */
function addLiteralTriple(
  node: TermWrapper,
  predicate: string,
  value: string,
  datatype: string,
): void {
  const factory = node.factory;
  const subject = node as unknown as Term;
  const p = NamedNodeFrom.string(predicate, factory);
  // LiteralFrom.datatypeTuple builds a typed literal (lexical + datatype IRI) via
  // the factory — never a hand-built term.
  const o = LiteralFrom.datatypeTuple([datatype, value], factory);
  node.dataset.add(factory.quad(subject as never, p as never, o as never));
}

/** A Membership node opened for writing. */
class WritableMembership extends TermWrapper {
  typeMembership(): void {
    addIriTriple(this, RDF_TYPE, FEDREG_MEMBERSHIP);
  }

  addApp(iri: string): void {
    addIriTriple(this, FEDREG_APP, iri);
  }

  addStatus(iri: string): void {
    addIriTriple(this, FEDREG_STATUS, iri);
  }

  addAssertedBy(iri: string): void {
    addIriTriple(this, FEDREG_ASSERTED_BY, iri);
  }

  addAsserted(dateTime: string): void {
    addLiteralTriple(this, FEDREG_ASSERTED, dateTime, XSD_DATETIME);
  }
}

/** A Registry node opened for writing. */
class WritableRegistry extends TermWrapper {
  typeRegistry(): void {
    addIriTriple(this, RDF_TYPE, FEDREG_REGISTRY);
  }

  /**
   * Mint a Membership node (an IRI when `id` is supplied, else a blank node), type
   * it, link it via `fedreg:member`, and return it for writing.
   */
  linkMember(id?: string): WritableMembership {
    const factory = this.factory;
    const subjectTerm: Term = id
      ? (NamedNodeFrom.string(id, factory) as Term)
      : (BlankNodeFrom.string(undefined, factory) as Term);
    const self = this as unknown as Term;
    const p = NamedNodeFrom.string(FEDREG_MEMBER, factory);
    this.dataset.add(factory.quad(self as never, p as never, subjectTerm as never));
    const node = new WritableMembership(subjectTerm, this.dataset, factory);
    node.typeMembership();
    return node;
  }
}

/** A StorageDescription node opened for writing. */
class WritableStorage extends TermWrapper {
  typeStorage(): void {
    addIriTriple(this, RDF_TYPE, FEDREG_STORAGE_DESCRIPTION);
  }

  addStorage(iri: string): void {
    addIriTriple(this, FEDREG_STORAGE, iri);
  }

  addAcceptsSpec(iri: string): void {
    addIriTriple(this, FEDREG_ACCEPTS_SPEC, iri);
  }

  addSupportsSector(iri: string): void {
    addIriTriple(this, FEDREG_SUPPORTS_SECTOR, iri);
  }
}

/**
 * Builder over a fresh `N3.Store` for the registry / storage write path. Returns
 * the store (an `RDF.DatasetCore`) so the caller can serialise it with `n3.Writer`.
 */
export class RegistryBuilder {
  private readonly store = new Store();
  private readonly factory = DataFactory as unknown as DataFactoryType;

  /** Open a Registry subject (its IRI) for writing. */
  registry(id: string): WritableRegistry {
    const node = new WritableRegistry(id, this.store as unknown as DatasetCore, this.factory);
    node.typeRegistry();
    return node;
  }

  /** Open a standalone Membership subject (its IRI) for writing. */
  membership(id: string): WritableMembership {
    const node = new WritableMembership(id, this.store as unknown as DatasetCore, this.factory);
    node.typeMembership();
    return node;
  }

  /** Open a StorageDescription subject (its IRI) for writing. */
  storage(id: string): WritableStorage {
    const node = new WritableStorage(id, this.store as unknown as DatasetCore, this.factory);
    node.typeStorage();
    return node;
  }

  /** The accumulated quads. */
  quads(): Quad[] {
    return [...this.store] as Quad[];
  }
}

/** Re-export the base type for callers extending the wrappers. */
export type { TermWrapperType };
