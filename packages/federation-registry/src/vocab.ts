// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Term IRIs for the Federation Catalogue / Registry vocabulary (fedreg:) and the
// adjacent vocabularies it references (DCAT, Dublin Core Terms, RDF). These are
// the single source of the string IRIs the typed wrappers, the validators and the
// builders all key on.
//
// Source of truth: jeswr/solid-federation-vocab `fedreg.ttl`
// (https://w3id.org/jeswr/fedreg#). Keep in lock-step with that ontology.

/** The fedreg: namespace IRI (Catalogue / Registry). */
export const FEDREG = "https://w3id.org/jeswr/fedreg#" as const;

/** The fedapp: namespace IRI (app self-registration). */
export const FEDAPP = "https://w3id.org/jeswr/fed#" as const;

/** The DCAT `dcat:` namespace IRI (catalogue spine). */
export const DCAT = "http://www.w3.org/ns/dcat#" as const;

/** `rdf:type`. */
export const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" as const;

/** The sector base IRI (`https://w3id.org/jeswr/sectors/`). */
export const SECTOR_BASE = "https://w3id.org/jeswr/sectors/" as const;

/** Classes. */
export const FEDREG_REGISTRY = `${FEDREG}Registry` as const;
export const FEDREG_MEMBERSHIP = `${FEDREG}Membership` as const;
export const FEDREG_MEMBERSHIP_STATUS = `${FEDREG}MembershipStatus` as const;
export const FEDREG_STORAGE_DESCRIPTION = `${FEDREG}StorageDescription` as const;

/** Registry / Membership properties. */
export const FEDREG_MEMBER = `${FEDREG}member` as const;
export const FEDREG_APP = `${FEDREG}app` as const;
export const FEDREG_STATUS = `${FEDREG}status` as const;
export const FEDREG_ASSERTED_BY = `${FEDREG}assertedBy` as const;
export const FEDREG_ASSERTED = `${FEDREG}asserted` as const;

/** DCAT property a fedreg:member refines (a consumer may also reach records here). */
export const DCAT_RECORD = `${DCAT}record` as const;

/** StorageDescription properties. */
export const FEDREG_ACCEPTS_SPEC = `${FEDREG}acceptsSpec` as const;
export const FEDREG_SUPPORTS_SECTOR = `${FEDREG}supportsSector` as const;
export const FEDREG_STORAGE = `${FEDREG}storage` as const;

/**
 * The four membership-status coded values (instances of `fedreg:MembershipStatus`).
 * The lifecycle is Proposed → Active → Suspended → Revoked; Suspended/Revoked are
 * the federation's recovery lever.
 */
export const MEMBERSHIP_STATUS = {
  Proposed: `${FEDREG}Proposed`,
  Active: `${FEDREG}Active`,
  Suspended: `${FEDREG}Suspended`,
  Revoked: `${FEDREG}Revoked`,
} as const;

/** The set of valid status IRIs, for validation. */
export const VALID_STATUS_IRIS: ReadonlySet<string> = new Set(Object.values(MEMBERSHIP_STATUS));

/** A membership status short name. */
export type MembershipStatusName = keyof typeof MEMBERSHIP_STATUS;

/**
 * The set of statuses a consumer should treat as a TRUSTED, current membership.
 * `Proposed` is pending (not yet ratified); `Suspended`/`Revoked` are withdrawn.
 * Only `Active` denotes a live membership.
 */
export const TRUSTED_STATUS: ReadonlySet<MembershipStatusName> = new Set(["Active"]);

/** Map a status IRI back to its short name, or `undefined` if unknown. */
export function statusName(iri: string): MembershipStatusName | undefined {
  for (const [name, statusIri] of Object.entries(MEMBERSHIP_STATUS)) {
    if (statusIri === iri) {
      return name as MembershipStatusName;
    }
  }
  return undefined;
}
