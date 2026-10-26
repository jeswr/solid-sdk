// AUTHORED-BY Codex GPT-6.1-Sol
import { RdfFetchError } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import type { PhotoStorage } from "./io.js";
import { buildPhoto, type Photo, parsePhoto } from "./photograph.js";
import { documentUrl, httpIri, identifier, isoDate } from "./validation.js";
import { RDF_TYPE, SCHEMA } from "./vocab.js";

const PROV = "http://www.w3.org/ns/prov#";
export interface TrashRecord {
  originalUrl: string;
  trashedAt: string;
  actor: string;
  /** Absent on ordinary/legacy trash records. Purging permanently forbids restore. */
  state?: "restoring" | "purging";
}
export class TrashDoc extends TermWrapper {
  get state(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}creativeWorkStatus`, LiteralAs.string);
  }
  set state(value: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}creativeWorkStatus`, value, LiteralFrom.string);
  }
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get originalUrl(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${PROV}wasDerivedFrom`, NamedNodeAs.string);
  }
  set originalUrl(value: string | undefined) {
    OptionalAs.object(
      this,
      `${PROV}wasDerivedFrom`,
      value === undefined ? undefined : documentUrl(value),
      NamedNodeFrom.string,
    );
  }
  get actor(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${PROV}wasAttributedTo`, NamedNodeAs.string);
  }
  set actor(value: string | undefined) {
    OptionalAs.object(
      this,
      `${PROV}wasAttributedTo`,
      value === undefined ? undefined : httpIri(value),
      NamedNodeFrom.string,
    );
  }
  get trashedAt(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, `${PROV}invalidatedAtTime`, LiteralAs.date);
  }
  set trashedAt(value: Date | undefined) {
    OptionalAs.object(this, `${PROV}invalidatedAtTime`, value, LiteralFrom.dateTime);
  }
}

export function buildTrash(url: string, photo: Photo, record: TrashRecord) {
  const dataset = buildPhoto(record.originalUrl, photo);
  const doc = new TrashDoc(`${documentUrl(url)}#trash`, dataset, DataFactory);
  doc.types.add(`${PROV}Entity`);
  doc.originalUrl = record.originalUrl;
  doc.actor = record.actor;
  doc.state = record.state;
  doc.trashedAt = new Date(isoDate(record.trashedAt));
  return dataset;
}
export function parseTrash(
  url: string,
  dataset: DatasetCore,
): { photo: Photo; record: TrashRecord } {
  const doc = new TrashDoc(`${documentUrl(url)}#trash`, dataset, DataFactory);
  if (!doc.types.has(`${PROV}Entity`) || !doc.originalUrl || !doc.actor || !doc.trashedAt)
    throw new TypeError("Invalid trash record");
  const state = doc.state;
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
    },
  };
}
function requireEtag(etag: string | null): string {
  if (!etag) throw new TypeError("Trash operations require an ETag");
  return etag;
}

/** Copy metadata before conditional delete. Binaries remain available until purge. */
export async function trashPhoto(
  io: PhotoStorage,
  originalUrl: string,
  id: string,
  actor: string,
  now: string,
): Promise<string> {
  const { photo, etag } = await io.loadPhoto(originalUrl);
  if (!photo) throw new TypeError("Not a photograph");
  const match = requireEtag(etag);
  const url = `${io.root}.trash/${identifier(id)}.ttl`;
  const dataset = buildTrash(url, photo, { originalUrl, actor, trashedAt: now });
  await io.ensureContainers(["", ".trash/"]);
  await io.write(url, dataset, { create: true });
  await io.remove(originalUrl, match);
  return url;
}
export async function restorePhoto(io: PhotoStorage, url: string): Promise<string> {
  const { dataset, etag } = await io.read(url);
  const { photo, record } = parseTrash(url, dataset);
  const match = requireEtag(etag);
  if (record.state === "purging") throw new TypeError("Cannot restore a purging photo");
  const claimed = await claim(io, url, dataset, match, "restoring");
  await io.savePhoto(record.originalUrl, photo, { create: true });
  await io.remove(url, claimed);
  return record.originalUrl;
}

/** A conditional state write fences stale readers before any side effects. */
async function claim(
  io: PhotoStorage,
  url: string,
  dataset: DatasetCore,
  etag: string,
  state: NonNullable<TrashRecord["state"]>,
): Promise<string> {
  new TrashDoc(`${documentUrl(url)}#trash`, dataset, DataFactory).state = state;
  return requireEtag((await io.write(url, dataset, { etag })).etag);
}

async function requireMissing(io: PhotoStorage, originalUrl: string): Promise<void> {
  try {
    await io.read(originalUrl);
  } catch (error) {
    if (error instanceof RdfFetchError && (error.status === 404 || error.status === 410)) return;
    throw error;
  }
  throw new TypeError("Cannot purge binaries while the original description exists");
}

/** Purge only app-owned binaries matching the metadata resource's identifier. */
export async function purgePhoto(io: PhotoStorage, url: string): Promise<void> {
  const { dataset, etag } = await io.read(url);
  const { photo, record } = parseTrash(url, dataset);
  const match = requireEtag(etag);
  const prefix = `${io.root}items/`;
  if (!record.originalUrl.startsWith(prefix)) throw new TypeError("Cannot purge imported binaries");
  const id = identifier(record.originalUrl.slice(prefix.length).replace(/\.ttl$/, ""));
  const originalPrefix = `${io.root}originals/${id}.`;
  const extension = photo.contentUrl.slice(originalPrefix.length);
  if (
    !photo.contentUrl.startsWith(originalPrefix) ||
    !/^(jpg|png|webp|tif|heic|avif)$/.test(extension) ||
    (photo.thumbnailUrl !== undefined && photo.thumbnailUrl !== `${io.root}thumbs/${id}.webp`)
  ) {
    throw new TypeError("Cannot purge binaries outside the photo's managed paths");
  }
  if (record.state === "restoring") throw new TypeError("Cannot purge a restoring photo");
  await requireMissing(io, record.originalUrl);
  const claimed = await claim(io, url, dataset, match, "purging");
  await io.removeBinary(photo.contentUrl);
  if (photo.thumbnailUrl) await io.removeBinary(photo.thumbnailUrl);
  await io.remove(url, claimed);
}
