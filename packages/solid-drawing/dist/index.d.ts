/**
 * `@jeswr/solid-drawing` — the RDF vocabulary + types for vector drawings /
 * whiteboards (the data model for an Excalidraw→Solid fork).
 *
 * A drawing scene is a `draw:Scene` descriptor that points — via
 * `draw:sceneDocument` — at a BYTE-EXACT `.excalidraw` JSON resource. The canvas
 * is stored as an OPAQUE JSON blob; only the lightweight metadata (title,
 * timestamps, format version, background colour, thumbnail, provenance) is RDF.
 *
 * The five minted terms live under `https://w3id.org/jeswr/drawing#` (prefix
 * `draw:`); everything else is re-used from Dublin Core Terms, schema.org and
 * W3C PROV-O. `draw:Scene` is `rdfs:subClassOf schema:CreativeWork` and rooted
 * into the suite Core ontology as a `gufo:SubKind` of `core:InformationResource`
 * (see `drawing.ttl`), matching every other `@jeswr` sector vocab.
 *
 * @packageDocumentation
 */
export { escapeIri, safeHttpIri, safeSubjectBaseIri } from "./iri.js";
export { buildScene, parseScene, parseSceneTtl, type Quad, type SceneData, sceneSubject, serializeScene, storeToTurtle, } from "./scene.js";
export { DCT, DCT_CREATED, DCT_CREATED_IRI, DCT_MODIFIED, DCT_MODIFIED_IRI, DCT_TITLE, DCT_TITLE_IRI, DRAW, DRAW_SCENE, DRAW_SCENE_DOCUMENT, DRAW_SCENE_DOCUMENT_IRI, DRAW_SCENE_IRI, DRAW_SCHEMA_VERSION, DRAW_SCHEMA_VERSION_IRI, DRAW_THUMBNAIL, DRAW_THUMBNAIL_IRI, DRAW_VIEW_BACKGROUND_COLOR, DRAW_VIEW_BACKGROUND_COLOR_IRI, dct, draw, PREFIXES, PROV, PROV_WAS_GENERATED_BY, PROV_WAS_GENERATED_BY_IRI, prov, RDF, RDF_TYPE, RDF_TYPE_IRI, RDFS, rdf, SCHEMA, SCHEMA_ABOUT, SCHEMA_ABOUT_IRI, SCHEMA_CREATIVE_WORK, SCHEMA_CREATIVE_WORK_IRI, schema, XSD, XSD_DATE_TIME, XSD_STRING, xsd, } from "./vocab.js";
//# sourceMappingURL=index.d.ts.map