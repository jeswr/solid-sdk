// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
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
import { DataFactory } from "n3";

const { namedNode } = DataFactory;

// ---------------------------------------------------------------------------
//  Namespace bases (string IRIs). The `draw:` base is the ONE namespace this
//  package mints under; the rest are re-used standard vocabularies.
// ---------------------------------------------------------------------------

/** The drawing vocabulary namespace — the ONE namespace minted here (prefix `draw:`). */
export const DRAW = "https://w3id.org/jeswr/drawing#";
/** Dublin Core Terms — `dct:created`, `dct:modified`, `dct:title`. Re-used, not minted. */
export const DCT = "http://purl.org/dc/terms/";
/** schema.org (canonical http scheme) — `schema:CreativeWork`, `schema:about`. Re-used. */
export const SCHEMA = "http://schema.org/";
/** W3C PROV-O — `prov:wasGeneratedBy` (the activity that produced the scene). Re-used. */
export const PROV = "http://www.w3.org/ns/prov#";
/** RDF core — `rdf:type`. */
export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
/** RDF Schema — referenced by the ontology TTL (`rdfs:subClassOf`). */
export const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
/** XSD datatypes — referenced via the wrapper value mappers (`xsd:dateTime`, `xsd:string`). */
export const XSD = "http://www.w3.org/2001/XMLSchema#";

/** Build a `draw:` term IRI string. */
export const draw = (local: string): string => `${DRAW}${local}`;
/** Build a `dct:` term IRI string. */
export const dct = (local: string): string => `${DCT}${local}`;
/** Build a `schema:` term IRI string. */
export const schema = (local: string): string => `${SCHEMA}${local}`;
/** Build a `prov:` term IRI string. */
export const prov = (local: string): string => `${PROV}${local}`;
/** Build an `rdf:` term IRI string. */
export const rdf = (local: string): string => `${RDF}${local}`;
/** Build an `xsd:` term IRI string. */
export const xsd = (local: string): string => `${XSD}${local}`;

// ---------------------------------------------------------------------------
//  Minted `draw:` terms — IRI strings (the EXACT five the federation-vocab
//  drawing# alignments reference; match these verbatim).
// ---------------------------------------------------------------------------

/** `draw:Scene` — the class of a drawing/whiteboard scene descriptor. */
export const DRAW_SCENE_IRI = draw("Scene");
/** `draw:sceneDocument` — links a scene to its byte-exact `.excalidraw` JSON resource. */
export const DRAW_SCENE_DOCUMENT_IRI = draw("sceneDocument");
/** `draw:schemaVersion` — the Excalidraw scene-format version (literal). */
export const DRAW_SCHEMA_VERSION_IRI = draw("schemaVersion");
/** `draw:viewBackgroundColor` — the canvas background colour (literal). */
export const DRAW_VIEW_BACKGROUND_COLOR_IRI = draw("viewBackgroundColor");
/** `draw:thumbnail` — links a scene to a thumbnail image resource. */
export const DRAW_THUMBNAIL_IRI = draw("thumbnail");

// ---------------------------------------------------------------------------
//  Re-used standard-term IRI strings (NOT minted — dct/schema/prov/rdf).
// ---------------------------------------------------------------------------

/** `schema:CreativeWork` — the schema.org superclass of `draw:Scene`. */
export const SCHEMA_CREATIVE_WORK_IRI = schema("CreativeWork");
/** `dct:title` — the scene's human-readable title. */
export const DCT_TITLE_IRI = dct("title");
/** `dct:created` — when the scene was created (xsd:dateTime). */
export const DCT_CREATED_IRI = dct("created");
/** `dct:modified` — when the scene was last modified (xsd:dateTime). */
export const DCT_MODIFIED_IRI = dct("modified");
/** `schema:about` — the real-world subject the drawing depicts. */
export const SCHEMA_ABOUT_IRI = schema("about");
/** `prov:wasGeneratedBy` — the activity/agent that produced the scene. */
export const PROV_WAS_GENERATED_BY_IRI = prov("wasGeneratedBy");
/** The `rdf:type` predicate IRI. */
export const RDF_TYPE_IRI = rdf("type");

// ---------------------------------------------------------------------------
//  Typed `NamedNode` term constants (rdf-js). These are what the typed
//  accessors and the n3.Writer consume directly — no hand-built terms.
// ---------------------------------------------------------------------------

/** `draw:Scene` as an rdf-js `NamedNode`. */
export const DRAW_SCENE: NamedNode = namedNode(DRAW_SCENE_IRI);
/** `draw:sceneDocument` as an rdf-js `NamedNode`. */
export const DRAW_SCENE_DOCUMENT: NamedNode = namedNode(DRAW_SCENE_DOCUMENT_IRI);
/** `draw:schemaVersion` as an rdf-js `NamedNode`. */
export const DRAW_SCHEMA_VERSION: NamedNode = namedNode(DRAW_SCHEMA_VERSION_IRI);
/** `draw:viewBackgroundColor` as an rdf-js `NamedNode`. */
export const DRAW_VIEW_BACKGROUND_COLOR: NamedNode = namedNode(DRAW_VIEW_BACKGROUND_COLOR_IRI);
/** `draw:thumbnail` as an rdf-js `NamedNode`. */
export const DRAW_THUMBNAIL: NamedNode = namedNode(DRAW_THUMBNAIL_IRI);

/** `schema:CreativeWork` as an rdf-js `NamedNode`. */
export const SCHEMA_CREATIVE_WORK: NamedNode = namedNode(SCHEMA_CREATIVE_WORK_IRI);
/** `dct:title` as an rdf-js `NamedNode`. */
export const DCT_TITLE: NamedNode = namedNode(DCT_TITLE_IRI);
/** `dct:created` as an rdf-js `NamedNode`. */
export const DCT_CREATED: NamedNode = namedNode(DCT_CREATED_IRI);
/** `dct:modified` as an rdf-js `NamedNode`. */
export const DCT_MODIFIED: NamedNode = namedNode(DCT_MODIFIED_IRI);
/** `schema:about` as an rdf-js `NamedNode`. */
export const SCHEMA_ABOUT: NamedNode = namedNode(SCHEMA_ABOUT_IRI);
/** `prov:wasGeneratedBy` as an rdf-js `NamedNode`. */
export const PROV_WAS_GENERATED_BY: NamedNode = namedNode(PROV_WAS_GENERATED_BY_IRI);
/** The `rdf:type` predicate as an rdf-js `NamedNode`. */
export const RDF_TYPE: NamedNode = namedNode(RDF_TYPE_IRI);
/** `xsd:dateTime` datatype as an rdf-js `NamedNode`. */
export const XSD_DATE_TIME: NamedNode = namedNode(xsd("dateTime"));
/** `xsd:string` datatype as an rdf-js `NamedNode`. */
export const XSD_STRING: NamedNode = namedNode(xsd("string"));

/**
 * Prefix map for an `n3.Writer` that serialises this model (pretty Turtle
 * output). Pass as the `prefixes` option.
 */
export const PREFIXES = {
  draw: DRAW,
  dct: DCT,
  schema: SCHEMA,
  prov: PROV,
  rdf: RDF,
  rdfs: RDFS,
  xsd: XSD,
} as const;
