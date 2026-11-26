// AUTHORED-BY Codex (GPT-6.1 Sol)
import { RdfFetchError } from "@jeswr/fetch-rdf";
import {
  buildPhoto,
  buildTrash,
  documentUrl,
  identifier,
  parsePhoto,
  parseTrash,
  RestoreReceipt,
  TrashDoc,
  type TrashRecord,
} from "@jeswr/solid-photos";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { isomorphic } from "rdf-isomorphic";
import { PhotoIoError, type PhotoStorage } from "./io.js";

export { buildTrash, parseTrash, TrashDoc, type TrashRecord };

function requireEtag(etag: string | null): string {
  if (!etag || etag.startsWith("W/")) throw new TypeError("Trash operations require a strong ETag");
  return etag;
}

/** Copy metadata before replacing it with a durable ETag fence. Binaries remain until purge. */
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
  const activity = `${url}#restore-${crypto.randomUUID()}`;
  const dataset = buildTrash(url, photo, {
    originalUrl,
    actor,
    trashedAt: now,
    restoreActivity: activity,
  });
  await io.ensureContainers(["", ".trash/"]);
  await io.write(url, dataset, { create: true });
  // Keep the URL occupied across trash/purge cycles so a paused restore cannot
  // recreate metadata after its generation has been superseded.
  const tombstone = new Store();
  new RestoreReceipt(`${documentUrl(originalUrl)}#it`, tombstone, DataFactory).restoreActivity =
    activity;
  await io.write(originalUrl, tombstone, { etag: match });
  return url;
}
export async function restorePhoto(io: PhotoStorage, url: string): Promise<string> {
  const { dataset, etag } = await io.read(url);
  const { photo, record } = parseTrash(url, dataset);
  const match = requireEtag(etag);
  if (record.state === "purging") throw new TypeError("Cannot restore a purging photo");
  const activity = record.restoreActivity ?? `${documentUrl(url)}#restore-${crypto.randomUUID()}`;
  new TrashDoc(`${documentUrl(url)}#trash`, dataset, DataFactory).restoreActivity = activity;
  const claimed = await claim(io, url, dataset, match, "restoring");
  // Persist the same receipt atomically with creation, including when the response is lost.
  const live = buildPhoto(record.originalUrl, photo);
  new RestoreReceipt(`${record.originalUrl}#it`, live, DataFactory).restoreActivity = activity;
  try {
    await io.write(record.originalUrl, live, { create: true });
  } catch (error) {
    if (!(error instanceof PhotoIoError) || error.status !== 412) throw error;
    const existing = await io.read(record.originalUrl);
    const receipt = new RestoreReceipt(`${record.originalUrl}#it`, existing.dataset, DataFactory);
    if (receipt.restoreActivity !== activity) throw error;
    if (!parsePhoto(record.originalUrl, existing.dataset)) {
      // Only this generation's tombstone may become live, using its current ETag.
      await io.write(record.originalUrl, live, { etag: requireEtag(existing.etag) });
    }
  }
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
  const result = await io.write(url, dataset, { etag });
  if (result.etag) return requireEtag(result.etag);
  // CSS may omit PUT validators. Only use a read's validator for the same claim,
  // including its receipt and photo data, across blank-node relabeling.
  const current = await io.read(url);
  if (!isomorphic([...dataset], [...current.dataset])) throw new PhotoIoError(url, 412);
  return requireEtag(current.etag);
}

async function requireMissing(io: PhotoStorage, record: TrashRecord): Promise<void> {
  try {
    const { dataset } = await io.read(record.originalUrl);
    const receipt = new RestoreReceipt(`${record.originalUrl}#it`, dataset, DataFactory);
    if (
      record.restoreActivity !== undefined &&
      receipt.restoreActivity === record.restoreActivity &&
      !parsePhoto(record.originalUrl, dataset)
    )
      return;
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
  await requireMissing(io, record);
  const claimed = await claim(io, url, dataset, match, "purging");
  await io.removeBinary(photo.contentUrl);
  if (photo.thumbnailUrl) await io.removeBinary(photo.thumbnailUrl);
  await io.remove(url, claimed);
}
