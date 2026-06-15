// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Turtle fixtures for the federation-client tests: a well-formed registration,
// several malformed ones, and a registry / container listing.

/** A well-formed flat-form fedapp:App registration. */
export const VALID_FLAT = `
@prefix fedapp: <https://w3id.org/jeswr/fed#> .
@prefix acl: <http://www.w3.org/ns/auth/acl#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .

<https://app.example/clientid>
    a fedapp:App ;
    fedapp:sector <https://w3id.org/jeswr/sectors/identity> ;
    fedapp:access acl:Read, acl:Write ;
    fedapp:consumes <https://w3id.org/jeswr/sectors/identity#Profile> ;
    fedapp:produces <https://w3id.org/jeswr/sectors/identity#Profile> ;
    fedapp:declaresShape <https://app.example/shapes/Profile#shape> .
`;

/** A well-formed registration using the nested fedapp:SectorUse form. */
export const VALID_NESTED = `
@prefix fedapp: <https://w3id.org/jeswr/fed#> .
@prefix acl: <http://www.w3.org/ns/auth/acl#> .

<https://app.example/clientid>
    a fedapp:App ;
    fedapp:sectorUse [
        a fedapp:SectorUse ;
        fedapp:sector <https://w3id.org/jeswr/sectors/health> ;
        fedapp:access acl:Read ;
        fedapp:consumes <https://w3id.org/jeswr/sectors/health#Observation>
    ] , [
        a fedapp:SectorUse ;
        fedapp:sector <https://w3id.org/jeswr/sectors/finance> ;
        fedapp:access acl:Read, acl:Append
    ] .
`;

/** No fedapp:App at all — just an unrelated triple. */
export const INVALID_NO_APP = `
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
<https://app.example/clientid> a foaf:Agent .
`;

/** An fedapp:App with an access mode that is NOT a valid acl: mode. */
export const INVALID_BAD_ACCESS_MODE = `
@prefix fedapp: <https://w3id.org/jeswr/fed#> .
@prefix acl: <http://www.w3.org/ns/auth/acl#> .

<https://app.example/clientid>
    a fedapp:App ;
    fedapp:sector <https://w3id.org/jeswr/sectors/identity> ;
    fedapp:access acl:Read, <https://example.com/bogus#Superuser> .
`;

/** An fedapp:App with a SectorUse that is missing both sector and access. */
export const INVALID_INCOMPLETE_SECTOR_USE = `
@prefix fedapp: <https://w3id.org/jeswr/fed#> .

<https://app.example/clientid>
    a fedapp:App ;
    fedapp:access <http://www.w3.org/ns/auth/acl#Read> ;
    fedapp:sectorUse [ a fedapp:SectorUse ] .
`;

/** A typed fedapp:App that declares nothing at all (empty registration). */
export const INVALID_EMPTY = `
@prefix fedapp: <https://w3id.org/jeswr/fed#> .
<https://app.example/clientid> a fedapp:App .
`;

/** An fedapp:App that declares a sector but requests no access modes. */
export const INVALID_NO_ACCESS = `
@prefix fedapp: <https://w3id.org/jeswr/fed#> .
<https://app.example/clientid>
    a fedapp:App ;
    fedapp:sector <https://w3id.org/jeswr/sectors/identity> .
`;

/** Two fedapp:App subjects in one document. */
export const INVALID_MULTIPLE_APPS = `
@prefix fedapp: <https://w3id.org/jeswr/fed#> .
@prefix acl: <http://www.w3.org/ns/auth/acl#> .

<https://app.example/one>
    a fedapp:App ;
    fedapp:sector <https://w3id.org/jeswr/sectors/identity> ;
    fedapp:access acl:Read .

<https://app.example/two>
    a fedapp:App ;
    fedapp:sector <https://w3id.org/jeswr/sectors/media> ;
    fedapp:access acl:Write .
`;

/** A registry resource enumerating several inline fedapp:App registrations. */
export const REGISTRY_INLINE = INVALID_MULTIPLE_APPS;

/** An LDP container listing two member registration documents. */
export const CONTAINER_LISTING = `
@prefix ldp: <http://www.w3.org/ns/ldp#> .

<https://registry.example/apps/>
    a ldp:Container, ldp:BasicContainer ;
    ldp:contains <https://registry.example/apps/app-a>,
                 <https://registry.example/apps/app-b> .
`;
