// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
// (ImageObject discovery added by Claude Sonnet 5.5)
//
// photos-root.ts — derive the gallery ROOT containers <PhotoGallery rootUrl> needs
// from the authenticated session.
//
// WHY THIS LIVES IN THE HOST (not the auth seam): the auth seam's deriveSession()
// is app-agnostic — it only yields a correct POD ROOT + WebID. WHERE this app's
// photos live under that pod root is a Pod-Photos concern, so it is resolved here,
// using the library's own read-only Type-Index primitives — NEVER a bespoke
// parser, and NEVER the write/bootstrap path (`ensureTypeRegistrations`, which
// would mint a private index just to read it).
//
// DISCOVERY (first that yields a value):
//   1. the user's Type Index: read the profile's solid:*TypeIndex links
//      (`typeIndexLinks`), fetch each index ONCE, and collect every registered
//      `solid:instanceContainer` for `schema:Photograph` and for
//      `schema:ImageObject` (images written by other apps). All of them are
//      returned, de-duplicated, and each must lie inside the session's storage
//      (a registration pointing elsewhere is ignored). A container registered for
//      ImageObject is flagged `aggregateShards`: media-store libraries keep their
//      documents in `<yyyy>/<mm>/` shard containers. This only reads the index: Pod
//      Photos never registers ImageObject itself, and nothing crawls the pod.
//   2. fallback: the conventional `${podRoot}photos/` slug (PHOTOS_SLUG). The view
//      surfaces a small banner when this fallback is used (see App.tsx).
//
// Reads go through the library's `freshRdf` (which composes @jeswr/fetch-rdf), so
// in a real session the auth-patched global fetch carries the DPoP token; tests /
// the pre-popup public read can pass an explicit fetch.

import {
  freshRdf,
  IMAGE_OBJECT_CLASS,
  PHOTOGRAPH_CLASS,
  PHOTOS_SLUG,
  TypeIndexDataset,
  typeIndexLinks,
} from "@jeswr/pod-photos";
import { DataFactory } from "n3";

export interface PhotosRoot {
  /** The container URL passed to <PhotoGallery rootUrl> (always ends in "/"). */
  rootUrl: string;
  /** True when the root came from the conventional fallback, not the Type Index. */
  isFallback: boolean;
  /** True for a container registered for schema:ImageObject (media-store shards). */
  aggregateShards: boolean;
}

/** Ensure a container URL ends in a single trailing slash. */
function asContainer(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/** The conventional fallback container: `${podRoot}photos/`. */
function conventionalRoot(podRoot: string): string {
  return asContainer(new URL(PHOTOS_SLUG, asContainer(podRoot)).toString());
}

/** True when `url` is the storage root or inside it (same origin, path prefix). */
function insideStorage(url: string, podRoot: string): boolean {
  try {
    const target = new URL(url);
    const root = new URL(asContainer(podRoot));
    return target.origin === root.origin && target.pathname.startsWith(root.pathname);
  } catch {
    return false;
  }
}

/**
 * Resolve every gallery root for a session. Discovers all registered
 * `schema:Photograph` and `schema:ImageObject` containers inside the pod root
 * (de-duplicated, Photograph registrations first); on ANY discovery failure (no
 * index, unreadable index, no registration) it falls back to `${podRoot}photos/`
 * and flags `isFallback` so the UI can note it. Discovery is best-effort: a failure
 * to read the index must never block the gallery — the fallback always yields a
 * usable root, and the data layer's own scope guards protect every read.
 *
 * @param fetchImpl - omit in production so the auth-patched global fetch runs;
 *   the login flow may pass the pre-popup public fetch for a profile read.
 */
export async function resolvePhotosRoots(opts: {
  webId: string;
  podRoot: string;
  fetchImpl?: typeof fetch;
}): Promise<PhotosRoot[]> {
  const { webId, podRoot, fetchImpl } = opts;
  const fallback: PhotosRoot[] = [
    { rootUrl: conventionalRoot(podRoot), isFallback: true, aggregateShards: false },
  ];
  try {
    const { dataset: profile } = await freshRdf(webId, fetchImpl);
    const links = typeIndexLinks(webId, profile);
    // Consult BOTH advertised indexes (private, then public): either may lack a
    // registration or be unreadable. Each is fetched once for both classes.
    const indexUrls = [links.privateIndex, links.publicIndex].filter(
      (u): u is string => typeof u === "string" && u.length > 0,
    );
    const indexes: TypeIndexDataset[] = [];
    for (const indexUrl of indexUrls) {
      const index = await readIndex(indexUrl, fetchImpl);
      if (index) indexes.push(index);
    }
    const roots = new Map<string, PhotosRoot>();
    for (const forClass of [PHOTOGRAPH_CLASS, IMAGE_OBJECT_CLASS]) {
      for (const index of indexes) {
        for (const location of index.locate(forClass)) {
          const container = location.container;
          if (!container || !insideStorage(container, podRoot)) continue;
          const rootUrl = asContainer(container);
          const aggregateShards =
            forClass === IMAGE_OBJECT_CLASS || roots.get(rootUrl)?.aggregateShards === true;
          roots.set(rootUrl, { rootUrl, isFallback: false, aggregateShards });
        }
      }
    }
    return roots.size > 0 ? [...roots.values()] : fallback;
  } catch {
    // No usable Type Index (absent / unreadable / unparseable) — fall back to the
    // conventional path. Never block the gallery on discovery.
    return fallback;
  }
}

/**
 * Read one Type Index document. Returns `undefined` when the index is unreadable /
 * unparseable so the caller can still use the NEXT advertised index (an unreadable
 * private index must not stop the public one being consulted).
 */
async function readIndex(
  indexUrl: string,
  fetchImpl?: typeof fetch,
): Promise<TypeIndexDataset | undefined> {
  try {
    const { dataset } = await freshRdf(indexUrl, fetchImpl);
    return new TypeIndexDataset(dataset, DataFactory);
  } catch {
    return undefined;
  }
}
