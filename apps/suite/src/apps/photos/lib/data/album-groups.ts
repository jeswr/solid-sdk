// AUTHORED-BY Claude Opus 5.5
import type { GroupDirectory } from "@jeswr/suite-groups";
import type { PhotoStorage } from "../model";

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
  for (const ref of new Set(refs)) {
    const item = new URL(ref);
    item.hash = "";
    // Photos imported by reference (e.g. Google Photos) are not in this pod's library.
    if (item.search || !item.href.startsWith(`${io.root}items/`)) continue;
    const { photo } = await io.loadPhoto(item.href);
    if (!photo) continue;
    urls.add(item.href);
    for (const url of [photo.contentUrl, photo.thumbnailUrl])
      if (url?.startsWith(io.root)) urls.add(url);
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
  return resources.length ? directory.extend(album, resources) : [];
}
