// AUTHORED-BY Codex GPT-6
import {
  type PhotoStorage,
  parseTrash,
  purgePhoto as purge,
  restorePhoto as restore,
  trashPhoto as trash,
} from "../model";
import { children, collect } from "./shared";

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
  return result(() => trash(io, url, id, actor, now));
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
