// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Turtle fixtures for the federation-registry tests. Authored as Turtle strings
// (test inputs, not built RDF) so the parse path is exercised end-to-end.

export const REGISTRY_NS = "https://registry.example/federation";
export const AUTHORITY = "https://registry.example/profile/card#me";
export const APP_MUSIC = "https://music.example/clientid.jsonld";
export const APP_DRIVE = "https://drive.example/clientid.jsonld";
export const SPEC_SCHED_100 = "https://w3id.org/jeswr/sectors/scheduling#1.0.0";
export const SPEC_SCHED_110 = "https://w3id.org/jeswr/sectors/scheduling#1.1.0";
export const SPEC_SCHED_200 = "https://w3id.org/jeswr/sectors/scheduling#2.0.0";
export const SECTOR_SCHED = "https://w3id.org/jeswr/sectors/scheduling#sector";
export const STORAGE = "https://alice.pod.example/";

const PREFIXES = `@prefix fedreg: <https://w3id.org/jeswr/fedreg#> .
@prefix fedapp: <https://w3id.org/jeswr/fed#> .
@prefix dcat:  <http://www.w3.org/ns/dcat#> .
@prefix xsd:   <http://www.w3.org/2001/XMLSchema#> .
`;

/** A valid registry with two active members. */
export const REGISTRY_TWO_MEMBERS = `${PREFIXES}
<${REGISTRY_NS}> a fedreg:Registry ;
    fedreg:member <${REGISTRY_NS}#m-music>, <${REGISTRY_NS}#m-drive> .

<${REGISTRY_NS}#m-music> a fedreg:Membership ;
    fedreg:app <${APP_MUSIC}> ;
    fedreg:status fedreg:Active ;
    fedreg:assertedBy <${AUTHORITY}> ;
    fedreg:asserted "2026-06-16T10:00:00Z"^^xsd:dateTime .

<${REGISTRY_NS}#m-drive> a fedreg:Membership ;
    fedreg:app <${APP_DRIVE}> ;
    fedreg:status fedreg:Suspended ;
    fedreg:assertedBy <${AUTHORITY}> ;
    fedreg:asserted "2026-06-16T11:00:00Z"^^xsd:dateTime .
`;

/** A registry whose single membership omits the assertedBy authority (invalid). */
export const REGISTRY_NO_ASSERTED_BY = `${PREFIXES}
<${REGISTRY_NS}> a fedreg:Registry ;
    fedreg:member <${REGISTRY_NS}#m1> .

<${REGISTRY_NS}#m1> a fedreg:Membership ;
    fedreg:app <${APP_MUSIC}> ;
    fedreg:status fedreg:Active .
`;

/** A registry whose membership has an unknown status IRI + no app (invalid). */
export const REGISTRY_BAD_MEMBERSHIP = `${PREFIXES}
<${REGISTRY_NS}> a fedreg:Registry ;
    fedreg:member <${REGISTRY_NS}#m1> .

<${REGISTRY_NS}#m1> a fedreg:Membership ;
    fedreg:status <https://w3id.org/jeswr/fedreg#Bogus> ;
    fedreg:assertedBy <${AUTHORITY}> .
`;

/** A membership with a LITERAL in the app position (term-type violation). */
export const MEMBERSHIP_LITERAL_APP = `${PREFIXES}
<${REGISTRY_NS}#m1> a fedreg:Membership ;
    fedreg:app "${APP_MUSIC}" ;
    fedreg:status fedreg:Active ;
    fedreg:assertedBy <${AUTHORITY}> .
`;

/** An empty document with no registry node. */
export const NO_REGISTRY = `${PREFIXES}
<https://example.org/something> a dcat:Dataset .
`;

/** A registry with no member records. */
export const REGISTRY_EMPTY = `${PREFIXES}
<${REGISTRY_NS}> a fedreg:Registry .
`;

/** Bare membership records with no wrapping Registry node. */
export const BARE_MEMBERSHIPS = `${PREFIXES}
<${REGISTRY_NS}#m1> a fedreg:Membership ;
    fedreg:app <${APP_MUSIC}> ;
    fedreg:status fedreg:Active ;
    fedreg:assertedBy <${AUTHORITY}> .
`;

/** A valid storage description advertising a dual-read window (1.0.0 + 1.1.0). */
export const STORAGE_DUAL_READ = `${PREFIXES}
<${STORAGE}> a fedreg:StorageDescription ;
    fedreg:acceptsSpec <${SPEC_SCHED_100}>, <${SPEC_SCHED_110}> ;
    fedreg:supportsSector <${SECTOR_SCHED}> .
`;

/** A storage description with no acceptsSpec (invalid — no migration info). */
export const STORAGE_NO_SPEC = `${PREFIXES}
<${STORAGE}> a fedreg:StorageDescription ;
    fedreg:supportsSector <${SECTOR_SCHED}> .
`;

/** A membership naming two apps (invalid — expected exactly one). */
export const MEMBERSHIP_TWO_APPS = `${PREFIXES}
<${REGISTRY_NS}#m1> a fedreg:Membership ;
    fedreg:app <${APP_MUSIC}>, <${APP_DRIVE}> ;
    fedreg:status fedreg:Active ;
    fedreg:assertedBy <${AUTHORITY}> .
`;

/** A membership with two conflicting fedreg:status values (invalid). */
export const MEMBERSHIP_TWO_STATUSES = `${PREFIXES}
<${REGISTRY_NS}#m1> a fedreg:Membership ;
    fedreg:app <${APP_MUSIC}> ;
    fedreg:status fedreg:Active, fedreg:Revoked ;
    fedreg:assertedBy <${AUTHORITY}> .
`;

/** A storage description with no explicit fedreg:storage triple (storage defaults to id). */
export const STORAGE_NO_EXPLICIT_STORAGE = `${PREFIXES}
<${STORAGE}> a fedreg:StorageDescription ;
    fedreg:acceptsSpec <${SPEC_SCHED_100}> .
`;

/** A membership with no fedreg:status (invalid). */
export const MEMBERSHIP_NO_STATUS = `${PREFIXES}
<${REGISTRY_NS}#m1> a fedreg:Membership ;
    fedreg:app <${APP_MUSIC}> ;
    fedreg:assertedBy <${AUTHORITY}> .
`;

/** Two fedreg:Registry nodes in one document (invalid — expected exactly one). */
export const TWO_REGISTRIES = `${PREFIXES}
<${REGISTRY_NS}> a fedreg:Registry ;
    fedreg:member <${REGISTRY_NS}#m1> .
<${REGISTRY_NS}/other> a fedreg:Registry .

<${REGISTRY_NS}#m1> a fedreg:Membership ;
    fedreg:app <${APP_MUSIC}> ;
    fedreg:status fedreg:Active ;
    fedreg:assertedBy <${AUTHORITY}> .
`;

/** Build a stub `fetch` that returns the given Turtle body with HTTP 200. */
export function turtleFetch(turtle: string): typeof globalThis.fetch {
  return (async () =>
    new Response(turtle, {
      status: 200,
      headers: { "content-type": "text/turtle" },
    })) as typeof globalThis.fetch;
}
