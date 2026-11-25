// AUTHORED-BY Claude Sonnet 5.5
/** Project-document and collection documents, and Turtle read/write for every document. */
import type { DatasetCore } from "@rdfjs/types";
import type { Store } from "n3";
import {
  type AssetDescription,
  build,
  buildAssetDocument,
  type CollectionData,
  documentUrl,
  fieldsOf,
  nodeIri,
  only,
  type ProjectDocumentData,
  parseAssetDocument,
} from "./assets.js";
import { type CreativeWorkData, entities } from "./generated/model.js";
import { FRAGMENTS, SCHEMA_LEGACY } from "./vocab.js";

/** Build a project document (a JSON scene, timeline or board file) description. */
export function buildProjectDocument(url: string, data: ProjectDocumentData): Store {
  const keys = fieldsOf("CreativeWork").filter((k) => k !== "text");
  const picked = only<CreativeWorkData>(data, keys);
  if (picked.contentUrl === undefined) throw new TypeError("a project document needs a contentUrl");
  return build(entities.CreativeWork, nodeIri(url, FRAGMENTS.asset), picked, "project document");
}

/** Parse a project document; `undefined` without a valid `contentUrl`. */
export function parseProjectDocument(
  url: string,
  dataset: DatasetCore,
): ProjectDocumentData | undefined {
  const data = entities.CreativeWork.parse(nodeIri(url, FRAGMENTS.asset), dataset);
  if (data === undefined || data.contentUrl === undefined) return undefined;
  const { text: _prompt, ...project } = data;
  return project;
}

/** Build a collection (folder) description; it needs a name. */
export function buildCollection(url: string, data: CollectionData): Store {
  const picked = only<CollectionData>(data, fieldsOf("Collection"));
  if (picked.name === undefined) throw new TypeError("a collection needs a name");
  return build(entities.Collection, nodeIri(url, FRAGMENTS.asset), picked, "collection");
}

/** Parse a collection description. */
export function parseCollection(url: string, dataset: DatasetCore): CollectionData | undefined {
  return entities.Collection.parse(nodeIri(url, FRAGMENTS.asset), dataset);
}

/** Serialise any document store built here to Turtle (legacy alias types become canonical). */
export function documentToTurtle(store: Store): Promise<string> {
  // Legacy predicates are not read (README "Generator gaps"); a document that still holds
  // them would be typed canonically but unreadable, so it is refused rather than mixed.
  if ([...store].some((q) => q.predicate.value.startsWith(SCHEMA_LEGACY))) {
    throw new TypeError("refusing to write legacy http://schema.org/ predicates");
  }
  return entities.Image.storeToTurtle(store);
}

export const serializeAssetDocument = (url: string, d: AssetDescription): Promise<string> =>
  documentToTurtle(buildAssetDocument(url, d));
export const serializeProjectDocument = (url: string, d: ProjectDocumentData): Promise<string> =>
  documentToTurtle(buildProjectDocument(url, d));
export const serializeCollection = (url: string, d: CollectionData): Promise<string> =>
  documentToTurtle(buildCollection(url, d));

/** Parse a fetched document body (Turtle or JSON-LD) through `@jeswr/fetch-rdf`. */
async function read<T>(
  url: string,
  body: string,
  contentType: string | null,
  parse: (url: string, dataset: DatasetCore) => T | undefined,
): Promise<T | undefined> {
  const { parseRdf } = await import("@jeswr/fetch-rdf");
  const dataset = await parseRdf(body, contentType ?? "text/turtle", { baseIRI: documentUrl(url) });
  return parse(url, dataset);
}

export const parseAssetDocumentTtl = (
  url: string,
  body: string,
  type: string | null = "text/turtle",
) => read(url, body, type, parseAssetDocument);
export const parseProjectDocumentTtl = (
  url: string,
  body: string,
  type: string | null = "text/turtle",
) => read(url, body, type, parseProjectDocument);
export const parseCollectionTtl = (
  url: string,
  body: string,
  type: string | null = "text/turtle",
) => read(url, body, type, parseCollection);
