/**
 * Vocabulary IRIs + typed `NamedNode` term constants for the Solid drawing /
 * whiteboard model.
 *
 * **The data model for an Excalidraw→Solid fork.** A drawing scene is a
 * {@link DRAW_SCENE} (`draw:Scene`): a small RDF *descriptor* that points — via
 * {@link DRAW_SCENE_DOCUMENT} (`draw:sceneDocument`) — at the BYTE-EXACT
 * `.excalidraw` JSON resource. The canvas itself is stored as an OPAQUE JSON
 * blob, **never shredded into triples**: the only RDF is the lightweight metadata
 * needed to list, title, version, thumbnail and provenance-track a scene without
 * parsing the canvas.
 *
 * **Namespace discipline (the suite house rule).** Exactly five terms are MINTED
 * here, all under the dereferenceable `https://w3id.org/jeswr/drawing#` namespace
 * (prefix `draw:`): `Scene`, `sceneDocument`, `schemaVersion`,
 * `viewBackgroundColor`, `thumbnail`. Everything else is RE-USED from established,
 * dereferenceable standard vocabularies — Dublin Core Terms (`dct:created`,
 * `dct:modified`, `dct:title`), schema.org (`schema:about`, `schema:CreativeWork`)
 * and W3C PROV-O (`prov:wasGeneratedBy`). Nothing already covered by dct/schema/
 * prov is re-minted.
 *
 * **Suite-core rooting (gUFO).** `draw:Scene` is `rdfs:subClassOf
 * schema:CreativeWork` AND, in the ontology TTL ({@link ../drawing.ttl}), rooted
 * into the suite Core ontology as a `gufo:SubKind` of `core:InformationResource`
 * — matching the convention every other `@jeswr` sector vocab follows (see
 * `@jeswr/solid-federation-vocab` `sectors/media`). The `w3id.org/jeswr/drawing#`
 * alignments in `solid-federation-vocab` reference these same IRIs.
 *
 * **House rule: nothing here builds RDF.** These are IRI string + `NamedNode`
 * constants consumed by the typed `n3` / `@rdfjs/wrapper` accessors in
 * {@link ./scene.ts} — never hand-concatenated into triples.
 */
import type { NamedNode } from "@rdfjs/types";
/** The drawing vocabulary namespace — the ONE namespace minted here (prefix `draw:`). */
export declare const DRAW = "https://w3id.org/jeswr/drawing#";
/** Dublin Core Terms — `dct:created`, `dct:modified`, `dct:title`. Re-used, not minted. */
export declare const DCT = "http://purl.org/dc/terms/";
/** schema.org (canonical http scheme) — `schema:CreativeWork`, `schema:about`. Re-used. */
export declare const SCHEMA = "http://schema.org/";
/** W3C PROV-O — `prov:wasGeneratedBy` (the activity that produced the scene). Re-used. */
export declare const PROV = "http://www.w3.org/ns/prov#";
/** RDF core — `rdf:type`. */
export declare const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
/** RDF Schema — referenced by the ontology TTL (`rdfs:subClassOf`). */
export declare const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
/** XSD datatypes — referenced via the wrapper value mappers (`xsd:dateTime`, `xsd:string`). */
export declare const XSD = "http://www.w3.org/2001/XMLSchema#";
/** Build a `draw:` term IRI string. */
export declare const draw: (local: string) => string;
/** Build a `dct:` term IRI string. */
export declare const dct: (local: string) => string;
/** Build a `schema:` term IRI string. */
export declare const schema: (local: string) => string;
/** Build a `prov:` term IRI string. */
export declare const prov: (local: string) => string;
/** Build an `rdf:` term IRI string. */
export declare const rdf: (local: string) => string;
/** Build an `xsd:` term IRI string. */
export declare const xsd: (local: string) => string;
/** `draw:Scene` — the class of a drawing/whiteboard scene descriptor. */
export declare const DRAW_SCENE_IRI: string;
/** `draw:sceneDocument` — links a scene to its byte-exact `.excalidraw` JSON resource. */
export declare const DRAW_SCENE_DOCUMENT_IRI: string;
/** `draw:schemaVersion` — the Excalidraw scene-format version (literal). */
export declare const DRAW_SCHEMA_VERSION_IRI: string;
/** `draw:viewBackgroundColor` — the canvas background colour (literal). */
export declare const DRAW_VIEW_BACKGROUND_COLOR_IRI: string;
/** `draw:thumbnail` — links a scene to a thumbnail image resource. */
export declare const DRAW_THUMBNAIL_IRI: string;
/** `schema:CreativeWork` — the schema.org superclass of `draw:Scene`. */
export declare const SCHEMA_CREATIVE_WORK_IRI: string;
/** `dct:title` — the scene's human-readable title. */
export declare const DCT_TITLE_IRI: string;
/** `dct:created` — when the scene was created (xsd:dateTime). */
export declare const DCT_CREATED_IRI: string;
/** `dct:modified` — when the scene was last modified (xsd:dateTime). */
export declare const DCT_MODIFIED_IRI: string;
/** `schema:about` — the real-world subject the drawing depicts. */
export declare const SCHEMA_ABOUT_IRI: string;
/** `prov:wasGeneratedBy` — the activity/agent that produced the scene. */
export declare const PROV_WAS_GENERATED_BY_IRI: string;
/** The `rdf:type` predicate IRI. */
export declare const RDF_TYPE_IRI: string;
/** `draw:Scene` as an rdf-js `NamedNode`. */
export declare const DRAW_SCENE: NamedNode;
/** `draw:sceneDocument` as an rdf-js `NamedNode`. */
export declare const DRAW_SCENE_DOCUMENT: NamedNode;
/** `draw:schemaVersion` as an rdf-js `NamedNode`. */
export declare const DRAW_SCHEMA_VERSION: NamedNode;
/** `draw:viewBackgroundColor` as an rdf-js `NamedNode`. */
export declare const DRAW_VIEW_BACKGROUND_COLOR: NamedNode;
/** `draw:thumbnail` as an rdf-js `NamedNode`. */
export declare const DRAW_THUMBNAIL: NamedNode;
/** `schema:CreativeWork` as an rdf-js `NamedNode`. */
export declare const SCHEMA_CREATIVE_WORK: NamedNode;
/** `dct:title` as an rdf-js `NamedNode`. */
export declare const DCT_TITLE: NamedNode;
/** `dct:created` as an rdf-js `NamedNode`. */
export declare const DCT_CREATED: NamedNode;
/** `dct:modified` as an rdf-js `NamedNode`. */
export declare const DCT_MODIFIED: NamedNode;
/** `schema:about` as an rdf-js `NamedNode`. */
export declare const SCHEMA_ABOUT: NamedNode;
/** `prov:wasGeneratedBy` as an rdf-js `NamedNode`. */
export declare const PROV_WAS_GENERATED_BY: NamedNode;
/** The `rdf:type` predicate as an rdf-js `NamedNode`. */
export declare const RDF_TYPE: NamedNode;
/** `xsd:dateTime` datatype as an rdf-js `NamedNode`. */
export declare const XSD_DATE_TIME: NamedNode;
/** `xsd:string` datatype as an rdf-js `NamedNode`. */
export declare const XSD_STRING: NamedNode;
/**
 * Prefix map for an `n3.Writer` that serialises this model (pretty Turtle
 * output). Pass as the `prefixes` option.
 */
export declare const PREFIXES: {
    readonly draw: "https://w3id.org/jeswr/drawing#";
    readonly dct: "http://purl.org/dc/terms/";
    readonly schema: "http://schema.org/";
    readonly prov: "http://www.w3.org/ns/prov#";
    readonly rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
    readonly rdfs: "http://www.w3.org/2000/01/rdf-schema#";
    readonly xsd: "http://www.w3.org/2001/XMLSchema#";
};
//# sourceMappingURL=vocab.d.ts.map