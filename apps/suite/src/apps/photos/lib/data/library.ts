// AUTHORED-BY Codex GPT-6
import { groupPhotos, type Photo, type PhotoStorage } from "../model";
import type { StoredAlbum } from "./albums";
import { children, collect, requireEtag } from "./shared";

export interface LibraryPhoto extends Photo {
  url: string;
  ref: string;
  etag: string | null;
  readOnly: boolean;
}
export function dayGroups(photos: readonly LibraryPhoto[]) {
  return [...groupPhotos(photos, "day")].map(([key, items]) => ({
    key,
    photos: items,
    monthLabel:
      key === "undated"
        ? "Undated"
        : new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(
            new Date(`${key}T12:00:00Z`),
          ),
  }));
}
export async function listLibrary(io: PhotoStorage) {
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
