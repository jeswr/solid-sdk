/** The fedreg: namespace IRI (Catalogue / Registry). */
export declare const FEDREG: "https://w3id.org/jeswr/fedreg#";
/** The fedapp: namespace IRI (app self-registration). */
export declare const FEDAPP: "https://w3id.org/jeswr/fed#";
/** The DCAT `dcat:` namespace IRI (catalogue spine). */
export declare const DCAT: "http://www.w3.org/ns/dcat#";
/** `rdf:type`. */
export declare const RDF_TYPE: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
/** The sector base IRI (`https://w3id.org/jeswr/sectors/`). */
export declare const SECTOR_BASE: "https://w3id.org/jeswr/sectors/";
/** Classes. */
export declare const FEDREG_REGISTRY: "https://w3id.org/jeswr/fedreg#Registry";
export declare const FEDREG_MEMBERSHIP: "https://w3id.org/jeswr/fedreg#Membership";
export declare const FEDREG_MEMBERSHIP_STATUS: "https://w3id.org/jeswr/fedreg#MembershipStatus";
export declare const FEDREG_STORAGE_DESCRIPTION: "https://w3id.org/jeswr/fedreg#StorageDescription";
/** Registry / Membership properties. */
export declare const FEDREG_MEMBER: "https://w3id.org/jeswr/fedreg#member";
export declare const FEDREG_APP: "https://w3id.org/jeswr/fedreg#app";
export declare const FEDREG_STATUS: "https://w3id.org/jeswr/fedreg#status";
export declare const FEDREG_ASSERTED_BY: "https://w3id.org/jeswr/fedreg#assertedBy";
export declare const FEDREG_ASSERTED: "https://w3id.org/jeswr/fedreg#asserted";
/** DCAT property a fedreg:member refines (a consumer may also reach records here). */
export declare const DCAT_RECORD: "http://www.w3.org/ns/dcat#record";
/** StorageDescription properties. */
export declare const FEDREG_ACCEPTS_SPEC: "https://w3id.org/jeswr/fedreg#acceptsSpec";
export declare const FEDREG_SUPPORTS_SECTOR: "https://w3id.org/jeswr/fedreg#supportsSector";
export declare const FEDREG_STORAGE: "https://w3id.org/jeswr/fedreg#storage";
/**
 * The four membership-status coded values (instances of `fedreg:MembershipStatus`).
 * The lifecycle is Proposed → Active → Suspended → Revoked; Suspended/Revoked are
 * the federation's recovery lever.
 */
export declare const MEMBERSHIP_STATUS: {
    readonly Proposed: "https://w3id.org/jeswr/fedreg#Proposed";
    readonly Active: "https://w3id.org/jeswr/fedreg#Active";
    readonly Suspended: "https://w3id.org/jeswr/fedreg#Suspended";
    readonly Revoked: "https://w3id.org/jeswr/fedreg#Revoked";
};
/** The set of valid status IRIs, for validation. */
export declare const VALID_STATUS_IRIS: ReadonlySet<string>;
/** A membership status short name. */
export type MembershipStatusName = keyof typeof MEMBERSHIP_STATUS;
/**
 * The set of statuses a consumer should treat as a TRUSTED, current membership.
 * `Proposed` is pending (not yet ratified); `Suspended`/`Revoked` are withdrawn.
 * Only `Active` denotes a live membership.
 */
export declare const TRUSTED_STATUS: ReadonlySet<MembershipStatusName>;
/** Map a status IRI back to its short name, or `undefined` if unknown. */
export declare function statusName(iri: string): MembershipStatusName | undefined;
//# sourceMappingURL=vocab.d.ts.map