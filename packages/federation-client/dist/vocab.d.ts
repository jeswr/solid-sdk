/** The fedapp: namespace IRI. */
export declare const FEDAPP: "https://w3id.org/jeswr/fed#";
/** The WAC `acl:` namespace IRI (access modes). */
export declare const ACL: "http://www.w3.org/ns/auth/acl#";
/** The SHACL `sh:` namespace IRI (node shapes). */
export declare const SHACL: "http://www.w3.org/ns/shacl#";
/** `rdf:type`. */
export declare const RDF_TYPE: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
/** The sector base IRI (`https://w3id.org/jeswr/sectors/`). */
export declare const SECTOR_BASE: "https://w3id.org/jeswr/sectors/";
/** Classes. */
export declare const FEDAPP_APP: "https://w3id.org/jeswr/fed#App";
export declare const FEDAPP_APP_VERSION: "https://w3id.org/jeswr/fed#AppVersion";
export declare const FEDAPP_SECTOR_USE_CLASS: "https://w3id.org/jeswr/fed#SectorUse";
/** Properties. */
export declare const FEDAPP_SECTOR_USE: "https://w3id.org/jeswr/fed#sectorUse";
export declare const FEDAPP_SECTOR: "https://w3id.org/jeswr/fed#sector";
export declare const FEDAPP_ACCESS: "https://w3id.org/jeswr/fed#access";
export declare const FEDAPP_CONSUMES: "https://w3id.org/jeswr/fed#consumes";
export declare const FEDAPP_PRODUCES: "https://w3id.org/jeswr/fed#produces";
export declare const FEDAPP_DECLARES_SHAPE: "https://w3id.org/jeswr/fed#declaresShape";
/** The four WAC/ACP access modes (`acl:Mode` instances). */
export declare const ACL_MODES: {
    readonly Read: "http://www.w3.org/ns/auth/acl#Read";
    readonly Write: "http://www.w3.org/ns/auth/acl#Write";
    readonly Append: "http://www.w3.org/ns/auth/acl#Append";
    readonly Control: "http://www.w3.org/ns/auth/acl#Control";
};
/** The set of valid access-mode IRIs, for validation. */
export declare const VALID_ACCESS_MODE_IRIS: ReadonlySet<string>;
/** A WAC access mode short name. */
export type AccessMode = keyof typeof ACL_MODES;
/**
 * The canonical sector slugs (the path segment under {@link SECTOR_BASE}).
 * Mirrors the sectors published in jeswr/solid-federation-vocab `sectors/`.
 */
export declare const KNOWN_SECTOR_SLUGS: readonly ["identity", "contacts", "media", "finance", "health", "scheduling", "core"];
/** A known sector slug. */
export type SectorSlug = (typeof KNOWN_SECTOR_SLUGS)[number];
/** The full IRI of a known sector (`https://w3id.org/jeswr/sectors/<slug>`). */
export declare function sectorIri(slug: SectorSlug): string;
/** Map an access-mode IRI back to its short name, or `undefined` if unknown. */
export declare function accessModeName(iri: string): AccessMode | undefined;
//# sourceMappingURL=vocab.d.ts.map