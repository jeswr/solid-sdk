// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Term IRIs for the Federation App-Registration vocabulary (fedapp:) and the
// adjacent vocabularies it references. These are the single source of the
// string IRIs the typed wrappers, the validator and the serialiser all key on.
//
// Source of truth: jeswr/solid-federation-vocab `fedapp.ttl`
// (https://w3id.org/jeswr/fed#). Keep in lock-step with that ontology.

/** The fedapp: namespace IRI. */
export const FEDAPP = "https://w3id.org/jeswr/fed#" as const;

/** The WAC `acl:` namespace IRI (access modes). */
export const ACL = "http://www.w3.org/ns/auth/acl#" as const;

/** The SHACL `sh:` namespace IRI (node shapes). */
export const SHACL = "http://www.w3.org/ns/shacl#" as const;

/** `rdf:type`. */
export const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" as const;

/** The sector base IRI (`https://w3id.org/jeswr/sectors/`). */
export const SECTOR_BASE = "https://w3id.org/jeswr/sectors/" as const;

/** Classes. */
export const FEDAPP_APP = `${FEDAPP}App` as const;
export const FEDAPP_APP_VERSION = `${FEDAPP}AppVersion` as const;
export const FEDAPP_SECTOR_USE_CLASS = `${FEDAPP}SectorUse` as const;

/** Properties. */
export const FEDAPP_SECTOR_USE = `${FEDAPP}sectorUse` as const;
export const FEDAPP_SECTOR = `${FEDAPP}sector` as const;
export const FEDAPP_ACCESS = `${FEDAPP}access` as const;
export const FEDAPP_CONSUMES = `${FEDAPP}consumes` as const;
export const FEDAPP_PRODUCES = `${FEDAPP}produces` as const;
export const FEDAPP_DECLARES_SHAPE = `${FEDAPP}declaresShape` as const;

/** The four WAC/ACP access modes (`acl:Mode` instances). */
export const ACL_MODES = {
  Read: `${ACL}Read`,
  Write: `${ACL}Write`,
  Append: `${ACL}Append`,
  Control: `${ACL}Control`,
} as const;

/** The set of valid access-mode IRIs, for validation. */
export const VALID_ACCESS_MODE_IRIS: ReadonlySet<string> = new Set(Object.values(ACL_MODES));

/** A WAC access mode short name. */
export type AccessMode = keyof typeof ACL_MODES;

/**
 * The canonical sector slugs (the path segment under {@link SECTOR_BASE}).
 * Mirrors the sectors published in jeswr/solid-federation-vocab `sectors/`.
 */
export const KNOWN_SECTOR_SLUGS = [
  "identity",
  "contacts",
  "media",
  "finance",
  "health",
  "scheduling",
  "core",
] as const;

/** A known sector slug. */
export type SectorSlug = (typeof KNOWN_SECTOR_SLUGS)[number];

/** The full IRI of a known sector (`https://w3id.org/jeswr/sectors/<slug>`). */
export function sectorIri(slug: SectorSlug): string {
  return `${SECTOR_BASE}${slug}`;
}

/** Map an access-mode IRI back to its short name, or `undefined` if unknown. */
export function accessModeName(iri: string): AccessMode | undefined {
  for (const [name, modeIri] of Object.entries(ACL_MODES)) {
    if (modeIri === iri) {
      return name as AccessMode;
    }
  }
  return undefined;
}
