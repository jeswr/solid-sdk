import type { MembershipStatusName } from "./vocab.js";
/**
 * A plain-object view of a `fedreg:Membership` — the REGISTRY's assertion that an
 * app is a member of the federation, distinct from the app's self-asserted
 * `fedapp:App`. A consumer treats this as a membership claim only when
 * `assertedBy` names an authority it trusts.
 */
export interface Membership {
    /** The Membership record's IRI / blank-node id. */
    readonly id?: string;
    /** The app this membership concerns — its `client_id` IRI (`fedreg:app`). */
    readonly app: string;
    /** Lifecycle status short name (`fedreg:status`), or `undefined` if absent/unknown. */
    readonly status?: MembershipStatusName;
    /** The raw status IRI as found (present even when not a known coded value). */
    readonly statusIri?: string;
    /** The authority asserting this membership — a WebID / key IRI (`fedreg:assertedBy`). */
    readonly assertedBy?: readonly string[];
    /** When the assertion was made (`fedreg:asserted`, an xsd:dateTime lexical). */
    readonly asserted?: string;
}
/** A plain-object view of a `fedreg:Registry` (a `dcat:Catalog` of memberships). */
export interface Registry {
    /** The registry's IRI. */
    readonly id: string;
    /** The membership records (`fedreg:member`). */
    readonly members: readonly Membership[];
}
/**
 * A plain-object view of a `fedreg:StorageDescription` — a resource server's
 * catalogue entry advertising which client-client spec-versions it accepts and
 * which sectors it supports.
 */
export interface StorageDescription {
    /** The description's IRI (typically the storage root). */
    readonly id: string;
    /**
     * The storage the description is about (`fedreg:storage`). Always populated by
     * the parser: it is the explicit `fedreg:storage` value when present, else it
     * defaults to {@link StorageDescription.id} (the description's own IRI).
     */
    readonly storage: string;
    /** Client-client spec-VERSION IRIs the storage accepts (`fedreg:acceptsSpec`). */
    readonly acceptsSpec: readonly string[];
    /** Data sector IRIs the storage supports (`fedreg:supportsSector`). */
    readonly supportsSector: readonly string[];
}
/** A single validation problem found by {@link verifyMembership} / {@link verifyStorage}. */
export interface RegistryIssue {
    /** Machine-readable code. */
    readonly code: RegistryIssueCode;
    /** Human-readable description. */
    readonly message: string;
    /** The offending subject IRI / blank-node id, where applicable. */
    readonly subject?: string;
    /** The offending value (e.g. an unknown status IRI), where applicable. */
    readonly value?: string;
}
/** The closed set of issue codes the registry verifiers can emit. */
export type RegistryIssueCode = "no-registry" | "multiple-registries" | "no-membership" | "membership-missing-app" | "membership-multiple-apps" | "membership-missing-status" | "membership-multiple-statuses" | "unknown-status" | "membership-missing-asserted-by" | "invalid-term-type" | "no-storage-description" | "storage-missing-accepts-spec" | "fetch-failed" | "parse-failed";
/** The result of verifying a single membership. */
export interface MembershipVerification {
    /** `true` when the membership record is well-formed against the fedreg vocab. */
    readonly valid: boolean;
    /** The parsed membership, when one was found. */
    readonly membership?: Membership;
    /** All problems found. Empty iff `valid`. */
    readonly issues: readonly RegistryIssue[];
}
/** The result of verifying a storage description. */
export interface StorageVerification {
    /** `true` when the storage description is well-formed against the fedreg vocab. */
    readonly valid: boolean;
    /** The parsed storage description, when one was found. */
    readonly storage?: StorageDescription;
    /** All problems found. Empty iff `valid`. */
    readonly issues: readonly RegistryIssue[];
}
//# sourceMappingURL=types.d.ts.map