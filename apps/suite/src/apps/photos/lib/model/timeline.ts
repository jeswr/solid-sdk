// AUTHORED-BY Codex GPT-6.1-Sol
import type { Photo } from "./photograph.js";
import { isoDate } from "./validation.js";

/** UTC keys are deterministic across clients and do not move stored resources. */
export function dayKey(photo: Photo): string {
  const date = photo.exif.dateTimeOriginal ?? photo.created;
  return date ? isoDate(date).slice(0, 10) : "undated";
}
export function monthKey(photo: Photo): string {
  return dayKey(photo).slice(0, 7);
}

export function groupPhotos<T extends Photo>(
  photos: readonly T[],
  by: "day" | "month",
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  const keyOf = by === "day" ? dayKey : monthKey;
  const sorted = [...photos].sort((a, b) => {
    const dateA = a.exif.dateTimeOriginal ?? a.created ?? "";
    const dateB = b.exif.dateTimeOriginal ?? b.created ?? "";
    return (
      (dateB ? isoDate(dateB) : "").localeCompare(dateA ? isoDate(dateA) : "") ||
      a.contentUrl.localeCompare(b.contentUrl)
    );
  });
  for (const photo of sorted) {
    const key = keyOf(photo);
    const group = groups.get(key) ?? [];
    group.push(photo);
    groups.set(key, group);
  }
  return groups;
}

/** Value for the later photos.favourites preference. No RDF or persistence. */
export function setFavourite(
  favourites: readonly string[],
  ref: string,
  enabled: boolean,
): string[] {
  const next = new Set(favourites);
  if (enabled) next.add(ref);
  else next.delete(ref);
  return [...next];
}
