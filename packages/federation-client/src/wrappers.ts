// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Typed @rdfjs/wrapper accessors over an fedapp:App registration graph. This is
// the ONLY place RDF terms are read/written for the federation vocab: the SDK
// surface (verify/list/selfDescribe) goes through these wrappers, never through
// hand-built quads (the house rule). Reading uses SetFrom.subjectPredicate;
// writing uses RequiredAs.object + the dataset add, all from @rdfjs/wrapper.

import type { DataFactory as DataFactoryType, DatasetCore, Quad, Term } from "@rdfjs/types";
import {
  BlankNodeFrom,
  DatasetWrapper,
  NamedNodeFrom,
  SetFrom,
  TermAs,
  TermFrom,
  TermWrapper,
  type TermWrapper as TermWrapperType,
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { escapeIri, safeIri } from "./iri.js";
import {
  FEDAPP_ACCESS,
  FEDAPP_APP,
  FEDAPP_CONSUMES,
  FEDAPP_DECLARES_SHAPE,
  FEDAPP_PRODUCES,
  FEDAPP_SECTOR,
  FEDAPP_SECTOR_USE,
  FEDAPP_SECTOR_USE_CLASS,
  RDF_TYPE,
} from "./vocab.js";

/**
 * Read an IRI-valued property as a Set of the OBJECT TERMS themselves (not their
 * lexical `.value`) — so the term type survives the read. An IRI-valued property
 * (access mode, sector, consumes/produces/declaresShape link) is only valid when
 * its object is a `NamedNode`; a string LITERAL or a BLANK NODE in that position
 * is malformed. Reading `.value` alone discarded that distinction, so a literal
 * `"http://www.w3.org/ns/auth/acl#Read"` would pass as a valid IRI value. By
 * projecting the term (via `TermAs.instance(TermWrapper)` + `TermFrom.instance`,
 * the same term-type-preserving pattern `sectorUses` already uses) the validation
 * layer can inspect `.termType` and reject non-`NamedNode` objects with a coded
 * issue. The factory is shared so term identity / Set de-duplication hold.
 */
function iriTerms(node: TermWrapper, predicate: string): Set<TermWrapperType> {
  return SetFrom.subjectPredicate(node, predicate, TermAs.instance(TermWrapper), TermFrom.instance);
}

/**
 * A typed view of an `fedapp:SectorUse` node. Reads `fedapp:sector` (the single
 * sector — exposed as a Set so a malformed multi-sector node is observable
 * rather than silently truncated), `fedapp:access`, `fedapp:consumes`,
 * `fedapp:produces`. Each is exposed as a Set of the OBJECT TERMS so the
 * validation layer can reject non-`NamedNode` objects (see {@link iriTerms}).
 */
export class SectorUseNode extends TermWrapper {
  get sectors(): Set<TermWrapperType> {
    return iriTerms(this, FEDAPP_SECTOR);
  }

  get access(): Set<TermWrapperType> {
    return iriTerms(this, FEDAPP_ACCESS);
  }

  get consumes(): Set<TermWrapperType> {
    return iriTerms(this, FEDAPP_CONSUMES);
  }

  get produces(): Set<TermWrapperType> {
    return iriTerms(this, FEDAPP_PRODUCES);
  }
}

/**
 * A typed view of an `fedapp:App` node. Exposes the flat-form properties
 * (sector/access/consumes/produces/declaresShape attached directly) plus the
 * nested `fedapp:sectorUse` blocks.
 */
export class AppNode extends TermWrapper {
  get sectors(): Set<TermWrapperType> {
    return iriTerms(this, FEDAPP_SECTOR);
  }

  get access(): Set<TermWrapperType> {
    return iriTerms(this, FEDAPP_ACCESS);
  }

  get consumes(): Set<TermWrapperType> {
    return iriTerms(this, FEDAPP_CONSUMES);
  }

  get produces(): Set<TermWrapperType> {
    return iriTerms(this, FEDAPP_PRODUCES);
  }

  get declaresShape(): Set<TermWrapperType> {
    return iriTerms(this, FEDAPP_DECLARES_SHAPE);
  }

  /**
   * The `fedapp:SectorUse` nodes linked via `fedapp:sectorUse`, projected
   * directly to typed wrappers. Using `TermAs.instance` (rather than reading the
   * id as a string and re-wrapping) preserves the object's term type — the
   * SectorUse nodes are typically blank nodes, which a string round-trip through
   * `NamedNodeFrom.string` would silently mis-wrap as IRIs.
   */
  get sectorUses(): Set<SectorUseNode> {
    return SetFrom.subjectPredicate(
      this,
      FEDAPP_SECTOR_USE,
      TermAs.instance(SectorUseNode),
      TermFrom.instance,
    );
  }
}

/**
 * A dataset wrapper for an app-registration document. Finds all `fedapp:App`
 * subjects in the graph.
 */
export class FederationDataset extends DatasetWrapper {
  /** Every `fedapp:App` subject in the dataset. */
  apps(): AppNode[] {
    return [...this.instancesOf(FEDAPP_APP, AppNode)];
  }

  /** A typed view of a single app subject. */
  app(id: string): AppNode {
    return new AppNode(id, this, this.factory);
  }
}

/**
 * Wrap an `RDF.DatasetCore` (e.g. the `N3.Store` from `fetchRdf`) as a
 * {@link FederationDataset}. The `n3` `DataFactory` is used throughout — one
 * factory everywhere keeps term equality intact.
 */
export function wrap(dataset: DatasetCore): FederationDataset {
  return new FederationDataset(dataset, DataFactory as unknown as DataFactoryType);
}

// --- the write path (selfDescribe) ---------------------------------------

/**
 * Add a single `(subject, predicate-IRI, object-IRI)` triple to a node's
 * dataset through the factory (the wrapper's sanctioned write surface) — never
 * a hand-built triple constructed from outside the wrapper.
 *
 * SECURITY: this is the single OBJECT-IRI chokepoint for the write path. Every
 * object IRI in a federation graph (sector / access-mode / consumes / produces /
 * declaresShape / rdf:type) is a generic, trust-bearing RDF IRI, so the object is
 * routed through {@link safeIri} (SCHEME-AGNOSTIC): `n3.Writer` does not escape
 * IRIs, so an unescaped `>`/space in an untrusted object would break out of `<…>`
 * and inject triples. `safeIri` requires an ABSOLUTE IRI (any scheme — an
 * `http(s)` Solid resource OR a `urn:`/`did:`/other shape/sector IRI) and
 * percent-encodes only the injection-critical chars, preserving the caller's
 * exact lexical IRI (no canonicalisation → RDF IRI identity holds). A schemeless
 * value is DROPPED (not a valid absolute NamedNode object). The trusted vocab
 * constants (predicates, `rdf:type` values, `acl:` modes) are all absolute IRIs
 * and pass through unchanged.
 */
function addIriTriple(node: TermWrapper, predicate: string, objectIri: string): void {
  const safeObject = safeIri(objectIri);
  if (safeObject === undefined) {
    return;
  }
  const factory = node.factory;
  const subject = node as unknown as Term;
  const p = NamedNodeFrom.string(predicate, factory);
  const o = NamedNodeFrom.string(safeObject, factory);
  node.dataset.add(factory.quad(subject as never, p as never, o as never));
}

/** A SectorUse node opened for writing. */
class WritableSectorUse extends TermWrapper {
  typeSectorUse(): void {
    addIriTriple(this, RDF_TYPE, FEDAPP_SECTOR_USE_CLASS);
  }

  addSector(iri: string): void {
    addIriTriple(this, FEDAPP_SECTOR, iri);
  }

  addAccess(iri: string): void {
    addIriTriple(this, FEDAPP_ACCESS, iri);
  }

  addConsumes(iri: string): void {
    addIriTriple(this, FEDAPP_CONSUMES, iri);
  }

  addProduces(iri: string): void {
    addIriTriple(this, FEDAPP_PRODUCES, iri);
  }
}

/**
 * An app-registration node opened for WRITING. Each `add*` projects a domain
 * value onto the underlying RDF through the factory + dataset (the wrapper's
 * sanctioned write surface) — never a hand-built triple from outside.
 */
class WritableApp extends TermWrapper {
  typeApp(): void {
    addIriTriple(this, RDF_TYPE, FEDAPP_APP);
  }

  addSector(iri: string): void {
    addIriTriple(this, FEDAPP_SECTOR, iri);
  }

  addAccess(iri: string): void {
    addIriTriple(this, FEDAPP_ACCESS, iri);
  }

  addConsumes(iri: string): void {
    addIriTriple(this, FEDAPP_CONSUMES, iri);
  }

  addProduces(iri: string): void {
    addIriTriple(this, FEDAPP_PRODUCES, iri);
  }

  addDeclaresShape(iri: string): void {
    addIriTriple(this, FEDAPP_DECLARES_SHAPE, iri);
  }

  /**
   * Link a fresh blank-node SectorUse node and return it, typed
   * `fedapp:SectorUse`. The blank node is minted on the factory so subject
   * identity is preserved across the link triple and the node's own triples.
   */
  linkSectorUse(): WritableSectorUse {
    const factory = this.factory;
    const blank = BlankNodeFrom.string(undefined, factory) as Term;
    const subject = this as unknown as Term;
    const p = NamedNodeFrom.string(FEDAPP_SECTOR_USE, factory);
    this.dataset.add(factory.quad(subject as never, p as never, blank as never));
    const node = new WritableSectorUse(blank, this.dataset, factory);
    node.typeSectorUse();
    return node;
  }
}

/**
 * Builder over a fresh `N3.Store` for `selfDescribe`. Returns the store (an
 * `RDF.DatasetCore`) so the caller can serialise it with `n3.Writer`.
 */
export class FederationBuilder {
  private readonly store = new Store();
  private readonly factory = DataFactory as unknown as DataFactoryType;

  /** Open the app subject (`id` is its client_id IRI) for writing. */
  app(id: string): WritableApp {
    // SECURITY: the app subject is minted straight from the client_id string via
    // `factory.namedNode` (the TermWrapper string constructor) and later emitted
    // by `n3.Writer`, which does not escape IRIs. A client_id is normally http(s)
    // but MAY legitimately be another absolute IRI, so escape (scheme-agnostic)
    // rather than validate-and-drop: {@link escapeIri} percent-encodes only the
    // Turtle IRIREF-forbidden characters, so the subject cannot break out of its
    // `<…>` while a legitimate non-http id still round-trips.
    const node = new WritableApp(escapeIri(id), this.store as unknown as DatasetCore, this.factory);
    node.typeApp();
    return node;
  }

  /** The accumulated quads. */
  quads(): Quad[] {
    return [...this.store] as Quad[];
  }
}

/** Re-export the base type for callers extending the wrappers. */
export type { TermWrapperType };
