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
    // The item document names its binaries; only the library's own binary folders count, so
    // an edited item can never point a grant at another document in the pod.
    if (binary(photo.contentUrl, `${io.root}originals/`)) urls.add(photo.contentUrl);
    if (photo.thumbnailUrl && binary(photo.thumbnailUrl, `${io.root}thumbs/`))
      urls.add(photo.thumbnailUrl);
  }
  return [...urls];
}
/** A canonical, query- and fragment-free direct child of `folder`. */
function binary(url: string, folder: string): boolean {
  try {
    const parsed = new URL(url);
    const name = parsed.href.slice(folder.length);
    return (
      parsed.href === url &&
      !parsed.search &&
      !parsed.hash &&
      url.startsWith(folder) &&
      name.length > 0 &&
      !name.includes("/")
    );
  } catch {
    return false;
  }
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
