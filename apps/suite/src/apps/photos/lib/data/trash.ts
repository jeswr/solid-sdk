// AUTHORED-BY Codex GPT-6

import { DataFactory } from "n3";
import { isomorphic } from "rdf-isomorphic";
import {
  buildPhoto,
  PhotoIoError,
  type PhotoStorage,
  parseTrash,
  purgePhoto as purge,
  RestoreReceipt,
  restorePhoto as restore,
  trashPhoto as trash,
} from "../model";
import { identifier } from "../model/validation";
import { children, collect, requireEtag, statusOf } from "./shared";

export async function listTrash(io: PhotoStorage) {
  return collect(await children(io, ".trash/"), async (url) => {
    const { dataset, etag } = await io.read(url);
    return [{ ...parseTrash(url, dataset), url, etag }];
  });
}
export type TrashedPhoto = Awaited<ReturnType<typeof listTrash>>["items"][number];
export type MutationResult<T> = { ok: true; value: T } | { ok: false; error: unknown };
async function result<T>(work: () => Promise<T>): Promise<MutationResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, error };
  }
}
export function trashPhoto(io: PhotoStorage, url: string, id: string, actor: string, now: string) {
  return result(async () => {
    const recoveryUrl = `${io.root}.trash/${identifier(id)}.ttl`;
    const existing = await io.read(recoveryUrl).catch((error: unknown) => {
      if (statusOf(error) === 404) return null;
      throw error;
    });
    if (existing) {
      const copy = parseTrash(recoveryUrl, existing.dataset);
      if (copy.record.originalUrl !== url || copy.record.actor !== actor || copy.record.state)
        throw new PhotoIoError(recoveryUrl, 412);
      const live = await io.loadPhoto(url);
      const receipt = new RestoreReceipt(`${url}#it`, live.dataset, DataFactory).restoreActivity;
      if (!live.photo && copy.record.restoreActivity && receipt === copy.record.restoreActivity)
        return recoveryUrl; // Tombstone committed but its response was lost.
      if (
        !live.photo ||
        !isomorphic([...buildPhoto(url, live.photo)], [...buildPhoto(url, copy.photo)])
      )
        throw new PhotoIoError(url, 412);
      // An incomplete move left the unchanged live photo. Conditionally remove
      // this operation's copy before retrying, so a second record cannot orphan it.
      await io.remove(recoveryUrl, requireEtag(existing.etag));
    }
    return trash(io, url, id, actor, now);
  });
}
export function restorePhoto(io: PhotoStorage, url: string) {
  return result(() => restore(io, url));
}
export function purgePhoto(io: PhotoStorage, url: string) {
  return result(() => purge(io, url));
}
export async function emptyTrash(io: PhotoStorage) {
  const listing = await listTrash(io);
  const purged: string[] = [];
  const failures = [...listing.failures];
  for (const item of listing.items) {
    const outcome = await purgePhoto(io, item.url);
    if (outcome.ok) purged.push(item.url);
    else failures.push({ url: item.url, error: outcome.error });
  }
  return { purged, failures };
}
