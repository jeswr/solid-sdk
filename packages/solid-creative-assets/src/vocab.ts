// AUTHORED-BY Claude Sonnet 5.5
/**
 * Vocabulary IRIs for the creative-asset model. Nothing here is minted: every term is a
 * schema.org or PROV-O term. Writers use the https schema.org scheme; the http scheme is a
 * read-only alias of the classes (see the README "Generator gaps" for why not predicates).
 */

/** schema.org, written form. */
export const SCHEMA = "https://schema.org/";
/** schema.org, legacy http scheme: accepted on read for classes only. */
export const SCHEMA_LEGACY = "http://schema.org/";
/** PROV-O. */
export const PROV = "http://www.w3.org/ns/prov#";
/** RDF. */
export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
/** XSD datatypes. */
export const XSD = "http://www.w3.org/2001/XMLSchema#";

/** Build a `schema:` term IRI. */
export const schema = (local: string): string => `${SCHEMA}${local}`;
/** Build a `prov:` term IRI. */
export const prov = (local: string): string => `${PROV}${local}`;

/** Classes the model writes (one `rdf:type` per node). */
export const CLASSES = {
  image: schema("ImageObject"),
  video: schema("VideoObject"),
  model3d: schema("3DModel"),
  creativeWork: schema("CreativeWork"),
  collection: schema("Collection"),
  aiModel: schema("SoftwareApplication"),
  setting: schema("PropertyValue"),
  run: prov("Activity"),
} as const;

/** The same schema.org classes in the legacy http scheme (read aliases). */
export const LEGACY_CLASSES = {
  image: `${SCHEMA_LEGACY}ImageObject`,
  video: `${SCHEMA_LEGACY}VideoObject`,
  model3d: `${SCHEMA_LEGACY}3DModel`,
  creativeWork: `${SCHEMA_LEGACY}CreativeWork`,
  collection: `${SCHEMA_LEGACY}Collection`,
  aiModel: `${SCHEMA_LEGACY}SoftwareApplication`,
  setting: `${SCHEMA_LEGACY}PropertyValue`,
} as const;

/** `rdf:type`. */
export const RDF_TYPE = `${RDF}type`;

/** Fragment of each node in an asset description document (`<doc#it>`, `<doc#run>`, ...). */
export const FRAGMENTS = {
  asset: "it",
  run: "run",
  prompt: "prompt",
  model: "model",
  thumbnail: "thumbnail",
  /** Settings are `#setting-1`, `#setting-2`, ... in the order given. */
  settingPrefix: "setting-",
} as const;

/** Prefix map for serialising this model. */
export const PREFIXES = {
  schema: SCHEMA,
  prov: PROV,
  rdf: RDF,
  xsd: XSD,
} as const;
