// AUTHORED-BY Codex GPT-6
import { type Album, addMember, type PhotoStorage, removeMember, reorderMembers } from "../model";
import { children, collect, requireEtag, statusOf } from "./shared";

export interface StoredAlbum extends Album {
  url: string;
  etag: string | null;
}
export async function listAlbums(io: PhotoStorage) {
  return collect(await children(io, "albums/"), async (url) => {
    const { album, etag } = await io.loadAlbum(url);
    return album ? [{ ...album, url, etag }] : [];
  });
}
export async function createAlbum(
  io: PhotoStorage,
  name: string,
  now: string,
): Promise<StoredAlbum> {
  name = name.trim();
  if (!name) throw new TypeError("Give the album a name");
  const slug =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64) || "album";
  await io.ensureContainers(["", "albums/"]);
  for (let suffix = 1; ; suffix++) {
    const url = `${io.root}albums/${slug}${suffix === 1 ? "" : `-${suffix}`}.ttl`;
    const album: Album = { name, dateCreated: now, members: [] };
    try {
      const { etag } = await io.saveAlbum(url, album, { create: true });
      return { ...album, url, etag };
    } catch (error) {
      if (statusOf(error) !== 412) throw error;
    }
  }
}
export async function saveAlbum(io: PhotoStorage, album: StoredAlbum) {
  if (!album.name.trim()) throw new TypeError("Give the album a name");
  return io.saveAlbum(album.url, album, { etag: requireEtag(album.etag) });
}
export async function deleteAlbum(io: PhotoStorage, album: StoredAlbum) {
  await io.remove(album.url, requireEtag(album.etag));
}
export function changeMembers(
  album: StoredAlbum,
  members: readonly string[],
  add: boolean,
): StoredAlbum {
  let changed: Album = album;
  for (const member of members)
    changed = add ? addMember(changed, member) : removeMember(changed, member);
  return { ...album, ...changed };
}
export function orderAlbum(album: StoredAlbum, members: readonly string[]): StoredAlbum {
  return { ...album, ...reorderMembers(album, members) };
}
/** Explicit model cover term; member order remains independent. */
export function coverAlbum(album: StoredAlbum, ref: string): StoredAlbum {
  if (!album.members.includes(ref)) throw new TypeError("Cover must belong to this album");
  return { ...album, coverUrl: ref };
}
