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

async function readTrash(io: PhotoStorage, url: string) {
  const { dataset, etag } = await io.read(url);
  const copy = parseTrash(url, dataset);
  let status: "trashed" | "needs-recovery" = "trashed";
  // A claimed restore may already have recreated the live photo and only need
  // trash cleanup. Leave it on the model's receipt-verified restore path.
  if (!copy.record.state) {
    const live = await io.loadPhoto(copy.record.originalUrl).catch((error: unknown) => {
      if (statusOf(error) === 404 || statusOf(error) === 410) return null;
      throw error;
    });
    if (live?.photo) status = "needs-recovery";
  }
  return { ...copy, url, etag, status };
}
export async function listTrash(io: PhotoStorage) {
  return collect(await children(io, ".trash/"), async (url) => [await readTrash(io, url)]);
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
  return result(async () => {
    await requireTrashed(io, url);
    return restore(io, url);
  });
}
export function purgePhoto(io: PhotoStorage, url: string) {
  return result(async () => {
    await requireTrashed(io, url);
    return purge(io, url);
  });
}
/** Check before claiming: a recovery copy must never become a restoring record. */
async function requireTrashed(io: PhotoStorage, url: string) {
  if ((await readTrash(io, url)).status === "needs-recovery")
    throw new TypeError("This photo needs recovery. Resume its move to trash first.");
}
/** Reuse the original operation, including after reload; never mint another copy. */
export function resumeTrash(io: PhotoStorage, url: string) {
  return result(async () => {
    const prefix = `${io.root}.trash/`;
    if (!url.startsWith(prefix) || !url.endsWith(".ttl"))
      throw new TypeError("Not a managed trash record");
    const id = identifier(url.slice(prefix.length, -4));
    const { dataset } = await io.read(url);
    const { record } = parseTrash(url, dataset);
    const outcome = await trashPhoto(io, record.originalUrl, id, record.actor, record.trashedAt);
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  });
}
export async function emptyTrash(io: PhotoStorage) {
  const listing = await listTrash(io);
  const purged: string[] = [];
  const failures = [...listing.failures];
  for (const item of listing.items) {
    if (item.status === "needs-recovery") continue;
    const outcome = await purgePhoto(io, item.url);
    if (outcome.ok) purged.push(item.url);
    else failures.push({ url: item.url, error: outcome.error });
  }
  return { purged, failures };
}
