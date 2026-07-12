import type { DatasetCore, Quad } from "@rdfjs/types";
import { DatasetWrapper, TermWrapper, type TermWrapper as TermWrapperType } from "@rdfjs/wrapper";
/**
 * A typed view of an `fedapp:SectorUse` node. Reads `fedapp:sector` (the single
 * sector — exposed as a Set so a malformed multi-sector node is observable
 * rather than silently truncated), `fedapp:access`, `fedapp:consumes`,
 * `fedapp:produces`. Each is exposed as a Set of the OBJECT TERMS so the
 * validation layer can reject non-`NamedNode` objects (see {@link iriTerms}).
 */
export declare class SectorUseNode extends TermWrapper {
    get sectors(): Set<TermWrapperType>;
    get access(): Set<TermWrapperType>;
    get consumes(): Set<TermWrapperType>;
    get produces(): Set<TermWrapperType>;
}
/**
 * A typed view of an `fedapp:App` node. Exposes the flat-form properties
 * (sector/access/consumes/produces/declaresShape attached directly) plus the
 * nested `fedapp:sectorUse` blocks.
 */
export declare class AppNode extends TermWrapper {
    get sectors(): Set<TermWrapperType>;
    get access(): Set<TermWrapperType>;
    get consumes(): Set<TermWrapperType>;
    get produces(): Set<TermWrapperType>;
    get declaresShape(): Set<TermWrapperType>;
    /**
     * The `fedapp:SectorUse` nodes linked via `fedapp:sectorUse`, projected
     * directly to typed wrappers. Using `TermAs.instance` (rather than reading the
     * id as a string and re-wrapping) preserves the object's term type — the
     * SectorUse nodes are typically blank nodes, which a string round-trip through
     * `NamedNodeFrom.string` would silently mis-wrap as IRIs.
     */
    get sectorUses(): Set<SectorUseNode>;
}
/**
 * A dataset wrapper for an app-registration document. Finds all `fedapp:App`
 * subjects in the graph.
 */
export declare class FederationDataset extends DatasetWrapper {
    /** Every `fedapp:App` subject in the dataset. */
    apps(): AppNode[];
    /** A typed view of a single app subject. */
    app(id: string): AppNode;
}
/**
 * Wrap an `RDF.DatasetCore` (e.g. the `N3.Store` from `fetchRdf`) as a
 * {@link FederationDataset}. The `n3` `DataFactory` is used throughout — one
 * factory everywhere keeps term equality intact.
 */
export declare function wrap(dataset: DatasetCore): FederationDataset;
/** A SectorUse node opened for writing. */
declare class WritableSectorUse extends TermWrapper {
    typeSectorUse(): void;
    addSector(iri: string): void;
    addAccess(iri: string): void;
    addConsumes(iri: string): void;
    addProduces(iri: string): void;
}
/**
 * An app-registration node opened for WRITING. Each `add*` projects a domain
 * value onto the underlying RDF through the factory + dataset (the wrapper's
 * sanctioned write surface) — never a hand-built triple from outside.
 */
declare class WritableApp extends TermWrapper {
    typeApp(): void;
    addSector(iri: string): void;
    addAccess(iri: string): void;
    addConsumes(iri: string): void;
    addProduces(iri: string): void;
    addDeclaresShape(iri: string): void;
    /**
     * Link a fresh blank-node SectorUse node and return it, typed
     * `fedapp:SectorUse`. The blank node is minted on the factory so subject
     * identity is preserved across the link triple and the node's own triples.
     */
    linkSectorUse(): WritableSectorUse;
}
/**
 * Builder over a fresh `N3.Store` for `selfDescribe`. Returns the store (an
 * `RDF.DatasetCore`) so the caller can serialise it with `n3.Writer`.
 */
export declare class FederationBuilder {
    private readonly store;
    private readonly factory;
    /** Open the app subject (`id` is its client_id IRI) for writing. */
    app(id: string): WritableApp;
    /** The accumulated quads. */
    quads(): Quad[];
}
/** Re-export the base type for callers extending the wrappers. */
export type { TermWrapperType };
//# sourceMappingURL=wrappers.d.ts.map