import type { DatasetCore, Quad } from "@rdfjs/types";
import type { StorageDescription, StorageVerification } from "./types.js";
/** Input to {@link describeStorage}. */
export interface StorageInput {
    /** The description's IRI (typically the storage root). */
    readonly id: string;
    /** The storage the description is about (`fedreg:storage`); defaults to `id`. */
    readonly storage?: string;
    /** Client-client spec-VERSION IRIs the storage accepts (`fedreg:acceptsSpec`). */
    readonly acceptsSpec: readonly string[];
    /** Data sector IRIs the storage supports (`fedreg:supportsSector`). */
    readonly supportsSector?: readonly string[];
}
/** The output of {@link describeStorage}. */
export interface BuiltStorage {
    /** The constructed quads (a `fedreg:StorageDescription` graph). */
    readonly quads: readonly Quad[];
    /** Serialise to Turtle (default) or another n3 format. */
    toString(format?: string): Promise<string>;
}
/**
 * Build a `fedreg:StorageDescription` — a resource server's federation catalogue
 * entry. This is the storage operator's authoring path; the served document is
 * what an app reads to discover the spec-versions the storage accepts.
 */
export declare function describeStorage(input: StorageInput): BuiltStorage;
/** Options for the fetch-backed storage entry points. */
export interface StorageFetchOptions {
    /** A `fetch` implementation (e.g. an authenticated Solid fetch). */
    readonly fetch?: typeof globalThis.fetch;
    /** Parse a body already in hand instead of fetching. */
    readonly body?: string;
    /** Content-Type for {@link StorageFetchOptions.body} (default `text/turtle`). */
    readonly bodyContentType?: string;
    /** Base IRI to resolve relative IRIs when parsing a body (default the input). */
    readonly baseIRI?: string;
}
/**
 * Fetch (or accept) a `fedreg:StorageDescription` document and verify it. When the
 * document holds more than one description, the FIRST is returned (a storage
 * catalogue document is expected to describe one storage).
 */
export declare function parseStorage(input: string, options?: StorageFetchOptions): Promise<StorageVerification>;
/** Verify an already-parsed dataset as a storage description. */
export declare function parseStorageDataset(dataset: DatasetCore, expectedId?: string): StorageVerification;
/**
 * Does a storage accept a given client-client spec-version?  The core
 * migration-coordination query: an app calls this against a storage's
 * {@link StorageDescription} (parsed via {@link parseStorage}) before writing
 * data validated against `specVersionIri`. During a dual-read window a storage
 * advertises BOTH the old and the new version, so this returns `true` for either —
 * letting the app and the storage migrate on independent clocks.
 *
 * Comparison is exact-IRI: spec versions are immutable, persistent IRIs (e.g. a
 * canonical model version), so an app must advertise (and check) the EXACT version
 * it writes against — never a prefix/loose match that could silently accept an
 * incompatible version.
 */
export declare function acceptsSpec(storage: Pick<StorageDescription, "acceptsSpec">, specVersionIri: string): boolean;
/**
 * The subset of `wanted` spec-versions a storage does NOT accept — the gap an app
 * must close (or wait for the storage to migrate) before it can write all of them.
 * Empty ⇒ the storage accepts every wanted version.
 */
export declare function unsupportedSpecs(storage: Pick<StorageDescription, "acceptsSpec">, wanted: readonly string[]): string[];
//# sourceMappingURL=storage.d.ts.map