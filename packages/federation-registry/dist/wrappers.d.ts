import type { DatasetCore, Quad } from "@rdfjs/types";
import { DatasetWrapper, TermWrapper, type TermWrapper as TermWrapperType } from "@rdfjs/wrapper";
/**
 * A typed view of a `fedreg:Membership` node. Each IRI-valued property is exposed
 * as a Set of object TERMS (so the validator can reject non-`NamedNode` objects);
 * `asserted` is a single literal value.
 */
export declare class MembershipNode extends TermWrapper {
    get apps(): Set<TermWrapperType>;
    get statuses(): Set<TermWrapperType>;
    get assertedBy(): Set<TermWrapperType>;
    /** The `fedreg:asserted` lexical value (first one found), or undefined. */
    get asserted(): string | undefined;
}
/** A typed view of a `fedreg:StorageDescription` node. */
export declare class StorageNode extends TermWrapper {
    get acceptsSpec(): Set<TermWrapperType>;
    get supportsSector(): Set<TermWrapperType>;
    get storage(): Set<TermWrapperType>;
}
/** A typed view of a `fedreg:Registry` node. */
export declare class RegistryNode extends TermWrapper {
    /** The `fedreg:Membership` nodes linked via `fedreg:member`. */
    get members(): Set<MembershipNode>;
}
/**
 * A dataset wrapper for a registry / storage document. Finds the typed subjects
 * in the graph.
 */
export declare class RegistryDataset extends DatasetWrapper {
    /** Every `fedreg:Registry` subject. */
    registries(): RegistryNode[];
    /** Every `fedreg:Membership` subject (whether or not linked into a Registry). */
    memberships(): MembershipNode[];
    /** Every `fedreg:StorageDescription` subject. */
    storageDescriptions(): StorageNode[];
    /** A typed view of a single membership subject. */
    membership(id: string): MembershipNode;
}
/**
 * Wrap an `RDF.DatasetCore` (e.g. the `N3.Store` from `fetchRdf`) as a
 * {@link RegistryDataset}. One `n3` `DataFactory` is used throughout so term
 * equality / Set de-duplication hold.
 */
export declare function wrap(dataset: DatasetCore): RegistryDataset;
/** A Membership node opened for writing. */
declare class WritableMembership extends TermWrapper {
    typeMembership(): void;
    addApp(iri: string): void;
    addStatus(iri: string): void;
    addAssertedBy(iri: string): void;
    addAsserted(dateTime: string): void;
}
/** A Registry node opened for writing. */
declare class WritableRegistry extends TermWrapper {
    typeRegistry(): void;
    /**
     * Mint a Membership node (an IRI when `id` is supplied, else a blank node), type
     * it, link it via `fedreg:member`, and return it for writing.
     */
    linkMember(id?: string): WritableMembership;
}
/** A StorageDescription node opened for writing. */
declare class WritableStorage extends TermWrapper {
    typeStorage(): void;
    addStorage(iri: string): void;
    addAcceptsSpec(iri: string): void;
    addSupportsSector(iri: string): void;
}
/**
 * Builder over a fresh `N3.Store` for the registry / storage write path. Returns
 * the store (an `RDF.DatasetCore`) so the caller can serialise it with `n3.Writer`.
 */
export declare class RegistryBuilder {
    private readonly store;
    private readonly factory;
    /** Open a Registry subject (its IRI) for writing. */
    registry(id: string): WritableRegistry;
    /** Open a standalone Membership subject (its IRI) for writing. */
    membership(id: string): WritableMembership;
    /** Open a StorageDescription subject (its IRI) for writing. */
    storage(id: string): WritableStorage;
    /** The accumulated quads. */
    quads(): Quad[];
}
/** Re-export the base type for callers extending the wrappers. */
export type { TermWrapperType };
//# sourceMappingURL=wrappers.d.ts.map