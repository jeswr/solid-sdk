// AUTHORED-BY Claude Sonnet 5.5
import { NS } from "@jeswr/suite-vocab";

/**
 * Vocabulary IRIs for the creative-asset model. Nothing here is minted: every term is a
 * schema.org or PROV-O term. Writers use the https schema.org scheme; the http scheme is a
 * read-only alias of the classes (see the README "Generator gaps" for why not predicates).
 */

export const { SCHEMA, PROV, RDF, XSD } = NS;
/** schema.org, legacy http scheme: accepted on read for classes only. */
export const SCHEMA_LEGACY = "http://schema.org/";

/** Build a `schema:` term IRI. */
export const schema = (local: string): string => `${SCHEMA}${local}`;
/** Build a `prov:` term IRI. */
export const prov = (local: string): string => `${PROV}${local}`;

/** Classes the model writes: the canonical type of each node, plus two second types below. */
export const CLASSES = {
  image: schema("ImageObject"),
  video: schema("VideoObject"),
  model3d: schema("3DModel"),
  creativeWork: schema("CreativeWork"),
  collection: schema("Collection"),
  aiModel: schema("SoftwareApplication"),
  setting: schema("PropertyValue"),
  run: prov("Activity"),
  /** Second written type of the prompt node, added through the generated wrapper. */
  promptEntity: prov("Entity"),
  /** Second written type of the model node, added through the generated wrapper. */
  modelAgent: prov("SoftwareAgent"),
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
