// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Turtle fixtures for the registry-consumption tests (discoverFromRegistry /
// resolveStorageSpecVersion). The fedreg: shapes mirror @jeswr/federation-registry's
// own test fixtures so the parse path we delegate to is exercised end-to-end against
// the exact term shapes the registry SDK expects.

export const REGISTRY_URL = "https://registry.example/federation";
export const AUTHORITY = "https://registry.example/profile/card#me";
export const APP_MUSIC = "https://music.example/clientid.jsonld";
export const APP_DRIVE = "https://drive.example/clientid.jsonld";
export const STORAGE_URL = "https://alice.pod.example/";
export const SPEC_SCHED_100 = "https://w3id.org/jeswr/sectors/scheduling#1.0.0";
export const SPEC_SCHED_110 = "https://w3id.org/jeswr/sectors/scheduling#1.1.0";
export const SPEC_SCHED_200 = "https://w3id.org/jeswr/sectors/scheduling#2.0.0";
export const SECTOR_SCHED = "https://w3id.org/jeswr/sectors/scheduling#sector";

const PREFIXES = `@prefix fedreg: <https://w3id.org/jeswr/fedreg#> .
@prefix dcat:  <http://www.w3.org/ns/dcat#> .
@prefix xsd:   <http://www.w3.org/2001/XMLSchema#> .
`;

/** A valid registry with two members — one Active, one Suspended. */
export const REGISTRY_TWO_MEMBERS = `${PREFIXES}
<${REGISTRY_URL}> a fedreg:Registry ;
    fedreg:member <${REGISTRY_URL}#m-music>, <${REGISTRY_URL}#m-drive> .

<${REGISTRY_URL}#m-music> a fedreg:Membership ;
    fedreg:app <${APP_MUSIC}> ;
    fedreg:status fedreg:Active ;
    fedreg:assertedBy <${AUTHORITY}> ;
    fedreg:asserted "2026-06-16T10:00:00Z"^^xsd:dateTime .

<${REGISTRY_URL}#m-drive> a fedreg:Membership ;
    fedreg:app <${APP_DRIVE}> ;
    fedreg:status fedreg:Suspended ;
    fedreg:assertedBy <${AUTHORITY}> ;
    fedreg:asserted "2026-06-16T11:00:00Z"^^xsd:dateTime .
`;

/** A registry whose single membership omits assertedBy + has an unknown status (invalid). */
export const REGISTRY_BAD_MEMBERSHIP = `${PREFIXES}
<${REGISTRY_URL}> a fedreg:Registry ;
    fedreg:member <${REGISTRY_URL}#m1> .

<${REGISTRY_URL}#m1> a fedreg:Membership ;
    fedreg:app <${APP_MUSIC}> ;
    fedreg:status <https://w3id.org/jeswr/fedreg#Bogus> .
`;

/** A document with no fedreg:Registry node at all (malformed registry). */
export const NO_REGISTRY = `${PREFIXES}
<https://example.org/something> a dcat:Dataset .
`;

/** A registry node with no member records. */
export const REGISTRY_EMPTY = `${PREFIXES}
<${REGISTRY_URL}> a fedreg:Registry .
`;

/** A storage description advertising a dual-read window (1.0.0 + 1.1.0). */
export const STORAGE_DUAL_READ = `${PREFIXES}
<${STORAGE_URL}> a fedreg:StorageDescription ;
    fedreg:acceptsSpec <${SPEC_SCHED_100}>, <${SPEC_SCHED_110}> ;
    fedreg:supportsSector <${SECTOR_SCHED}> .
`;

/** A storage description missing acceptsSpec (invalid — no migration info). */
export const STORAGE_NO_SPEC = `${PREFIXES}
<${STORAGE_URL}> a fedreg:StorageDescription ;
    fedreg:supportsSector <${SECTOR_SCHED}> .
`;

/**
 * A storage description whose `acceptsSpec` IS populated (well-formed IRIs) but which
 * is INVALID because `fedreg:supportsSector` is a string LITERAL (a term-type
 * violation). The registry returns `valid: false` yet a non-empty `acceptsSpec`. The
 * client MUST still fail closed (accept nothing) — an app must never write against an
 * unverifiable storage even if it happens to list a matching version.
 */
export const STORAGE_INVALID_WITH_SPEC = `${PREFIXES}
<${STORAGE_URL}> a fedreg:StorageDescription ;
    fedreg:acceptsSpec <${SPEC_SCHED_100}> ;
    fedreg:supportsSector "${SECTOR_SCHED}" .
`;

/** A garbage body that is not parseable Turtle. */
export const MALFORMED_TURTLE = "@prefix fedreg: <https://w3id.org/jeswr/fedreg#> . <broken ;;;";
