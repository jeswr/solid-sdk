// AUTHORED-BY Codex GPT-6
import { isomorphic } from "rdf-isomorphic";
import { buildPhoto, groupPhotos, type Photo, PhotoIoError, type PhotoStorage } from "../model";
import type { StoredAlbum } from "./albums";
import type { googlePhotosStorage } from "./google-photos";
import { confirmedRevisions } from "./revisions";
import { children, collect, requireEtag } from "./shared";

export interface LibraryPhoto extends Photo {
  url: string;
  ref: string;
  etag: string | null;
  readOnly: boolean;
  source?: "google-photos";
}
export function dayGroups(photos: readonly LibraryPhoto[]) {
  return [...groupPhotos(photos, "day")].map(([key, items]) => ({
    key,
    photos: items,
    monthLabel:
      key === "undated"
        ? "Undated"
        : new Intl.DateTimeFormat(undefined, {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          }).format(new Date(`${key}T12:00:00Z`)),
  }));
}
export async function listLibrary(
  io: PhotoStorage & { googlePhotos?: ReturnType<typeof googlePhotosStorage> },
) {
  const result = await collect(await children(io, "items/"), async (url) => {
    const { photos, etag } = await io.loadPhotos(url);
    return photos.map(({ subject, photo }) => ({
      ...photo,
      url,
      ref: subject,
      etag,
      readOnly: photos.length !== 1 || subject !== `${url}#it`,
    }));
  });
  if (io.googlePhotos) {
    const imported = await io.googlePhotos.listPhotos();
    result.items.push(...imported.items);
    result.failures.push(...imported.failures);
  }
  const groups = dayGroups(result.items);
  return { ...result, items: groups.flatMap((group) => group.photos), groups };
}
export function searchPhotos(
  photos: readonly LibraryPhoto[],
  albums: readonly StoredAlbum[],
  query: string,
): LibraryPhoto[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/);
  return photos.filter((photo) => {
    const date = photo.exif.dateTimeOriginal ?? photo.created;
    const dateText = date
      ? new Intl.DateTimeFormat("en", {
          month: "long",
          year: "numeric",
          day: "numeric",
          timeZone: "UTC",
        }).format(new Date(date))
      : "undated";
    const albumNames = albums
      .filter((album) => album.members.includes(photo.ref))
      .map((album) => album.name);
    const text = [photo.name, photo.description, ...photo.keywords, date, dateText, ...albumNames]
      .join(" ")
      .toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
export async function saveKeywords(io: PhotoStorage, photo: LibraryPhoto, keywords: string[]) {
  if (photo.readOnly || photo.ref !== `${photo.url}#it`)
    throw new TypeError("Imported multi-photo documents are read-only");
  return io.savePhoto(photo.url, { ...photo, keywords }, { etag: requireEtag(photo.etag) });
}
/** Follow only this client's successful revisions; external changes still fail If-Match. */
export function createKeywordWriter(io: PhotoStorage) {
  const revisions = confirmedRevisions<LibraryPhoto>();
  return async (photo: LibraryPhoto, keywords: string[]): Promise<LibraryPhoto> => {
    const source = revisions.latest(photo);
    const result = await saveKeywords(io, source, keywords);
    let etag = result.etag;
    if (!etag) {
      const loaded = await io.loadPhoto(photo.url);
      if (
        !loaded.photo ||
        !isomorphic(
          [...buildPhoto(photo.url, { ...source, keywords })],
          [...buildPhoto(photo.url, loaded.photo)],
        )
      )
        throw new PhotoIoError(photo.url, 412);
      etag = loaded.etag;
    }
    return revisions.confirm(source, { ...source, keywords: [...new Set(keywords)], etag });
  };
}
