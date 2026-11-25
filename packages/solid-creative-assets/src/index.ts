// AUTHORED-BY Claude Sonnet 5.5
/**
 * `@jeswr/solid-creative-assets`: a generated typed model for AI-generated creative assets
 * saved to a Solid pod (images, video, 3D, project documents, collections) with PROV-O
 * generation provenance. Browser-safe: no `node:*` imports.
 *
 * @packageDocumentation
 */
export {
  type AiModelData,
  type AssetDescription,
  buildAssetDocument,
  type CollectionData,
  type Described,
  documentUrl,
  type GenerationData,
  type ImageAssetData,
  type Model3DAssetData,
  nodeIri,
  type ProjectDocumentData,
  parseAssetDocument,
  type SettingData,
  type ThumbnailData,
  type VideoAssetData,
} from "./assets.js";
export {
  buildCollection,
  buildProjectDocument,
  documentToTurtle,
  parseAssetDocumentTtl,
  parseCollection,
  parseCollectionTtl,
  parseProjectDocument,
  parseProjectDocumentTtl,
  serializeAssetDocument,
  serializeCollection,
  serializeProjectDocument,
} from "./documents.js";
export {
  CLASSES,
  FRAGMENTS,
  LEGACY_CLASSES,
  PREFIXES,
  PROV,
  prov,
  RDF,
  RDF_TYPE,
  SCHEMA,
  SCHEMA_LEGACY,
  schema,
  XSD,
} from "./vocab.js";
