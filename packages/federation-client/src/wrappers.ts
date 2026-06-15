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

/** Map an RDF/JS term to its lexical value (the `termAs` for IRI sets). */
function termValue(term: { value: string }): string {
  return term.value;
}

/**
 * A typed view of an `fedapp:SectorUse` node. Reads `fedapp:sector` (the single
 * sector — exposed as a Set so a malformed multi-sector node is observable
 * rather than silently truncated), `fedapp:access`, `fedapp:consumes`,
 * `fedapp:produces`.
 */
export class SectorUseNode extends TermWrapper {
  get sectors(): Set<string> {
    return SetFrom.subjectPredicate(this, FEDAPP_SECTOR, termValue, NamedNodeFrom.string);
  }

  get access(): Set<string> {
    return SetFrom.subjectPredicate(this, FEDAPP_ACCESS, termValue, NamedNodeFrom.string);
  }

  get consumes(): Set<string> {
    return SetFrom.subjectPredicate(this, FEDAPP_CONSUMES, termValue, NamedNodeFrom.string);
  }

  get produces(): Set<string> {
    return SetFrom.subjectPredicate(this, FEDAPP_PRODUCES, termValue, NamedNodeFrom.string);
  }
}

/**
 * A typed view of an `fedapp:App` node. Exposes the flat-form properties
 * (sector/access/consumes/produces/declaresShape attached directly) plus the
 * nested `fedapp:sectorUse` blocks.
 */
export class AppNode extends TermWrapper {
  get sectors(): Set<string> {
    return SetFrom.subjectPredicate(this, FEDAPP_SECTOR, termValue, NamedNodeFrom.string);
  }

  get access(): Set<string> {
    return SetFrom.subjectPredicate(this, FEDAPP_ACCESS, termValue, NamedNodeFrom.string);
  }

  get consumes(): Set<string> {
    return SetFrom.subjectPredicate(this, FEDAPP_CONSUMES, termValue, NamedNodeFrom.string);
  }

  get produces(): Set<string> {
    return SetFrom.subjectPredicate(this, FEDAPP_PRODUCES, termValue, NamedNodeFrom.string);
  }

  get declaresShape(): Set<string> {
    return SetFrom.subjectPredicate(this, FEDAPP_DECLARES_SHAPE, termValue, NamedNodeFrom.string);
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
 */
function addIriTriple(node: TermWrapper, predicate: string, objectIri: string): void {
  const factory = node.factory;
  const subject = node as unknown as Term;
  const p = NamedNodeFrom.string(predicate, factory);
  const o = NamedNodeFrom.string(objectIri, factory);
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
    const node = new WritableApp(id, this.store as unknown as DatasetCore, this.factory);
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
