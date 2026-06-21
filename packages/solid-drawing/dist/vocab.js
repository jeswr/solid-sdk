// src/vocab.ts
import { DataFactory } from "n3";
var { namedNode } = DataFactory;
var DRAW = "https://w3id.org/jeswr/drawing#";
var DCT = "http://purl.org/dc/terms/";
var SCHEMA = "http://schema.org/";
var PROV = "http://www.w3.org/ns/prov#";
var RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
var RDFS = "http://www.w3.org/2000/01/rdf-schema#";
var XSD = "http://www.w3.org/2001/XMLSchema#";
var draw = (local) => `${DRAW}${local}`;
var dct = (local) => `${DCT}${local}`;
var schema = (local) => `${SCHEMA}${local}`;
var prov = (local) => `${PROV}${local}`;
var rdf = (local) => `${RDF}${local}`;
var xsd = (local) => `${XSD}${local}`;
var DRAW_SCENE_IRI = draw("Scene");
var DRAW_SCENE_DOCUMENT_IRI = draw("sceneDocument");
var DRAW_SCHEMA_VERSION_IRI = draw("schemaVersion");
var DRAW_VIEW_BACKGROUND_COLOR_IRI = draw("viewBackgroundColor");
var DRAW_THUMBNAIL_IRI = draw("thumbnail");
var SCHEMA_CREATIVE_WORK_IRI = schema("CreativeWork");
var DCT_TITLE_IRI = dct("title");
var DCT_CREATED_IRI = dct("created");
var DCT_MODIFIED_IRI = dct("modified");
var SCHEMA_ABOUT_IRI = schema("about");
var PROV_WAS_GENERATED_BY_IRI = prov("wasGeneratedBy");
var RDF_TYPE_IRI = rdf("type");
var DRAW_SCENE = namedNode(DRAW_SCENE_IRI);
var DRAW_SCENE_DOCUMENT = namedNode(DRAW_SCENE_DOCUMENT_IRI);
var DRAW_SCHEMA_VERSION = namedNode(DRAW_SCHEMA_VERSION_IRI);
var DRAW_VIEW_BACKGROUND_COLOR = namedNode(DRAW_VIEW_BACKGROUND_COLOR_IRI);
var DRAW_THUMBNAIL = namedNode(DRAW_THUMBNAIL_IRI);
var SCHEMA_CREATIVE_WORK = namedNode(SCHEMA_CREATIVE_WORK_IRI);
var DCT_TITLE = namedNode(DCT_TITLE_IRI);
var DCT_CREATED = namedNode(DCT_CREATED_IRI);
var DCT_MODIFIED = namedNode(DCT_MODIFIED_IRI);
var SCHEMA_ABOUT = namedNode(SCHEMA_ABOUT_IRI);
var PROV_WAS_GENERATED_BY = namedNode(PROV_WAS_GENERATED_BY_IRI);
var RDF_TYPE = namedNode(RDF_TYPE_IRI);
var XSD_DATE_TIME = namedNode(xsd("dateTime"));
var XSD_STRING = namedNode(xsd("string"));
var PREFIXES = {
  draw: DRAW,
  dct: DCT,
  schema: SCHEMA,
  prov: PROV,
  rdf: RDF,
  rdfs: RDFS,
  xsd: XSD
};
export {
  DCT,
  DCT_CREATED,
  DCT_CREATED_IRI,
  DCT_MODIFIED,
  DCT_MODIFIED_IRI,
  DCT_TITLE,
  DCT_TITLE_IRI,
  DRAW,
  DRAW_SCENE,
  DRAW_SCENE_DOCUMENT,
  DRAW_SCENE_DOCUMENT_IRI,
  DRAW_SCENE_IRI,
  DRAW_SCHEMA_VERSION,
  DRAW_SCHEMA_VERSION_IRI,
  DRAW_THUMBNAIL,
  DRAW_THUMBNAIL_IRI,
  DRAW_VIEW_BACKGROUND_COLOR,
  DRAW_VIEW_BACKGROUND_COLOR_IRI,
  PREFIXES,
  PROV,
  PROV_WAS_GENERATED_BY,
  PROV_WAS_GENERATED_BY_IRI,
  RDF,
  RDFS,
  RDF_TYPE,
  RDF_TYPE_IRI,
  SCHEMA,
  SCHEMA_ABOUT,
  SCHEMA_ABOUT_IRI,
  SCHEMA_CREATIVE_WORK,
  SCHEMA_CREATIVE_WORK_IRI,
  XSD,
  XSD_DATE_TIME,
  XSD_STRING,
  dct,
  draw,
  prov,
  rdf,
  schema,
  xsd
};
//# sourceMappingURL=vocab.js.map
