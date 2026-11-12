// AUTHORED-BY Claude Opus 5.5
import type { GroupDirectory } from "@jeswr/suite-groups";
import type { PhotoStorage } from "../model";

/** Upload's item, original and thumbnail names (see model/upload.ts and purgePhoto's check). */
const ITEM = /^([a-zA-Z0-9][a-zA-Z0-9_-]*)\.ttl$/;
const ORIGINAL = /^(jpg|png|webp|tif|heic|avif)$/;

/**
 * What a viewer needs to see these photos: each photo's item document, original and thumbnail,
 * when they live in this library. Album membership is only a reference, so sharing an album
 * alone shares none of these.
 */
export async function photoResources(
  io: Pick<PhotoStorage, "root" | "loadPhoto">,
  refs: readonly string[],
): Promise<string[]> {
  const urls = new Set<string>();
  const items = `${io.root}items/`;
  for (const ref of new Set(refs)) {
    const item = new URL(ref);
    item.hash = "";
    // Photos imported by reference (e.g. Google Photos) are not in this pod's library, and a
    // name upload never writes (encoded, nested, with a query) is skipped, never refused, so
    // one bad reference can't stop the rest of the album from being shared.
    const id = item.href.startsWith(items) && ITEM.exec(item.href.slice(items.length))?.[1];
    if (!id) continue;
    const { photo } = await io.loadPhoto(item.href);
    if (!photo) continue;
    urls.add(item.href);
    // The item document names its binaries, which anyone who can edit it could change: only
    // this item's own original and thumbnail count, never another photo's or another document.
    const original = `${io.root}originals/${id}.`;
    if (
      photo.contentUrl.startsWith(original) &&
      ORIGINAL.test(photo.contentUrl.slice(original.length))
    )
      urls.add(photo.contentUrl);
    if (photo.thumbnailUrl === `${io.root}thumbs/${id}.webp`) urls.add(photo.thumbnailUrl);
  }
  return [...urls];
}

/** Photos added to an album become visible to the groups that album is shared with. */
export async function shareAddedPhotos(
  directory: Pick<GroupDirectory, "extend">,
  io: Pick<PhotoStorage, "root" | "loadPhoto">,
  album: string,
  refs: readonly string[],
): Promise<string[]> {
  const resources = await photoResources(io, refs);
  // Album and contents both stay inside the Photos library.
  return resources.length ? directory.extend(album, resources, { within: io.root }) : [];
}
