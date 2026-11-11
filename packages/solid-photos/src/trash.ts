// AUTHORED-BY Codex (GPT-6.1 Sol)
import { objectTerms } from "@jeswr/rdf-serialize/wrapper";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory } from "n3";
import { entities } from "./generated/model.js";
import { orderedStore } from "./order.js";
import { buildPhoto, type Photo, parsePhoto } from "./photograph.js";
import { documentUrl, httpIri, isoDate } from "./validation.js";
import { PROV, RDF_TYPE, SCHEMA } from "./vocab.js";

export { TrashDoc } from "./views.js";

export interface TrashRecord {
  originalUrl: string;
  trashedAt: string;
  actor: string;
  /** Absent on ordinary/legacy trash records. Purging permanently forbids restore. */
  state?: "restoring" | "purging";
  /** Shared with the created live description to identify this restore across retries. */
  restoreActivity?: string;
}
export function buildTrash(url: string, photo: Photo, record: TrashRecord) {
  const dataset = buildPhoto(record.originalUrl, photo);
  for (const quad of entities.Trash.build(`${documentUrl(url)}#trash`, {
    originalUrl: documentUrl(record.originalUrl),
    actor: httpIri(record.actor),
    state: record.state,
    restoreActivity:
      record.restoreActivity === undefined ? undefined : httpIri(record.restoreActivity),
    trashedAt: new Date(isoDate(record.trashedAt)),
  }))
    dataset.add(quad);
  return orderedStore(dataset, [
    RDF_TYPE,
    `${PROV}wasDerivedFrom`,
    `${PROV}wasAttributedTo`,
    `${SCHEMA}creativeWorkStatus`,
    `${PROV}wasGeneratedBy`,
    `${PROV}invalidatedAtTime`,
  ]);
}
export function parseTrash(
  url: string,
  dataset: DatasetCore,
): { photo: Photo; record: TrashRecord } {
  const subject = `${documentUrl(url)}#trash`;
  const doc = entities.Trash.parse(subject, dataset);
  if (!doc?.originalUrl || !doc.actor || !doc.trashedAt)
    throw new TypeError("Invalid trash record");
  const state = doc.state;
  // Present recovery metadata must never become an absent legacy field when a
  // generated optional read drops a malformed or ambiguous value.
  const view = new entities.Trash.Wrapper(subject, dataset, DataFactory);
  if (objectTerms(view, `${SCHEMA}creativeWorkStatus`).size && state === undefined)
    throw new TypeError("Invalid trash state");
  if (objectTerms(view, `${PROV}wasGeneratedBy`).size && doc.restoreActivity === undefined)
    throw new TypeError("Invalid trash receipt");
  if (state !== undefined && state !== "restoring" && state !== "purging")
    throw new TypeError("Invalid trash state");
  const photo = parsePhoto(doc.originalUrl, dataset);
  if (!photo) throw new TypeError("Missing trashed photograph");
  return {
    photo,
    record: {
      originalUrl: documentUrl(doc.originalUrl),
      actor: httpIri(doc.actor),
      trashedAt: doc.trashedAt.toISOString(),
      ...(state !== undefined ? { state } : {}),
      ...(doc.restoreActivity !== undefined
        ? { restoreActivity: httpIri(doc.restoreActivity) }
        : {}),
    },
  };
}
