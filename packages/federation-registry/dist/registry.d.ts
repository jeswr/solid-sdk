import type { DatasetCore, Quad } from "@rdfjs/types";
import type { MembershipVerification, Registry, RegistryIssue } from "./types.js";
import { type MembershipStatusName } from "./vocab.js";
/** A membership to author into a registry. */
export interface MembershipInput {
    /**
     * The membership record's IRI. Optional — when omitted a blank node is minted
     * (fine for a single document, but a stable IRI is preferable so the record can
     * be addressed / updated independently).
     */
    readonly id?: string;
    /** The app this membership concerns — its `client_id` IRI. */
    readonly app: string;
    /** Lifecycle status (default `Active`). */
    readonly status?: MembershipStatusName;
    /** The authority/authorities asserting this membership (WebID / key IRIs). */
    readonly assertedBy: string | readonly string[];
    /** When the assertion was made (`xsd:dateTime` lexical; default: now). */
    readonly asserted?: string;
}
/** Input to {@link buildRegistry}. */
export interface RegistryInput {
    /** The registry's IRI. */
    readonly id: string;
    /** The memberships to list. */
    readonly members: readonly MembershipInput[];
}
/** The output of {@link buildRegistry} / {@link buildMembership}. */
export interface BuiltGraph {
    /** The constructed quads. */
    readonly quads: readonly Quad[];
    /** Serialise to Turtle (default) or another n3 format. */
    toString(format?: string): Promise<string>;
}
/**
 * Build a `fedreg:Registry` document listing the given memberships. This is the
 * registry operator's authoring path — each membership is the registry's OWN
 * assertion (it carries `fedreg:assertedBy`), so a consumer can trust the listing
 * as a membership claim rather than a bag of self-asserted app documents.
 */
export declare function buildRegistry(input: RegistryInput): BuiltGraph;
/**
 * Build a single standalone `fedreg:Membership` document (a registry that
 * addresses each membership as its own resource). `input.id` is required here (a
 * standalone record needs an IRI to be dereferenceable).
 */
export declare function buildMembership(input: MembershipInput & {
    id: string;
}): BuiltGraph;
/** The result of {@link parseRegistry}. */
export interface ParsedRegistry {
    /** The parsed registry view (id + members), when a `fedreg:Registry` was found. */
    readonly registry?: Registry;
    /** Per-membership verification results, in document order. */
    readonly members: readonly MembershipVerification[];
    /** Whether every membership verified clean AND a registry node was found. */
    readonly valid: boolean;
    /** Document-level issues (no registry / multiple registries / fetch / parse). */
    readonly issues: readonly RegistryIssue[];
}
/** Options for the fetch-backed entry points. */
export interface FetchOptions {
    /** A `fetch` implementation (e.g. an authenticated Solid fetch). */
    readonly fetch?: typeof globalThis.fetch;
    /** Verify a body already in hand instead of fetching. */
    readonly body?: string;
    /** Content-Type for {@link FetchOptions.body} (default `text/turtle`). */
    readonly bodyContentType?: string;
    /** Base IRI to resolve relative IRIs when parsing a body (default the input). */
    readonly baseIRI?: string;
}
/**
 * Fetch (or accept) a `fedreg:Registry` document, parse it, and verify each
 * membership. Returns the registry view plus per-membership verification.
 */
export declare function parseRegistry(input: string, options?: FetchOptions): Promise<ParsedRegistry>;
/** Verify an already-parsed dataset as a registry document. */
export declare function parseRegistryDataset(dataset: DatasetCore, expectedId?: string): ParsedRegistry;
/**
 * Discover the memberships in a registry document — a convenience over
 * {@link parseRegistry} returning just the per-membership verifications. Useful
 * for "which apps are members of this federation?".
 */
export declare function listMembers(input: string, options?: FetchOptions): Promise<MembershipVerification[]>;
/**
 * Verify a single membership record document (or body). Returns the parsed
 * membership + issues. When the document is a registry, the FIRST membership is
 * verified; use {@link parseRegistry} / {@link listMembers} for multi-member docs.
 */
export declare function verifyMembership(input: string, options?: FetchOptions): Promise<MembershipVerification>;
/**
 * Project + verify a single membership node from an already-parsed dataset (no
 * fetch). Exposed for callers who hold the dataset (e.g. a custom walk).
 */
export declare function verifyMembershipDataset(dataset: DatasetCore): MembershipVerification;
//# sourceMappingURL=registry.d.ts.map