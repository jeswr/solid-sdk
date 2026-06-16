// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// photos-root.ts — derive the gallery ROOT container <PhotoGallery rootUrl> needs
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
//      (`typeIndexLinks`), fetch the index, and `locate(schema:Photograph)` for a
//      registered `solid:instanceContainer` — the canonical cross-app discovery
//      signal, so photos registered by Pod Photos (or any other app) are found
//      wherever the owner chose to store them.
//   2. fallback: the conventional `${podRoot}photos/` slug (PHOTOS_SLUG). The view
//      surfaces a small banner when this fallback is used (see App.tsx).
//
// Reads go through the library's `freshRdf` (which composes @jeswr/fetch-rdf), so
// in a real session the auth-patched global fetch carries the DPoP token; tests /
// the pre-popup public read can pass an explicit fetch.

import {
  freshRdf,
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
}

/** Ensure a container URL ends in a single trailing slash. */
function asContainer(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/** The conventional fallback container: `${podRoot}photos/`. */
function conventionalRoot(podRoot: string): string {
  return asContainer(new URL(PHOTOS_SLUG, asContainer(podRoot)).toString());
}

/**
 * Resolve the photos gallery root for a session. Tries Type-Index discovery of
 * the `schema:Photograph` container first; on ANY discovery failure (no index,
 * unreadable index, no registration) it falls back to `${podRoot}photos/` and
 * flags `isFallback` so the UI can note it. Discovery is best-effort: a failure
 * to read the index must never block the gallery — the fallback always yields a
 * usable root, and the data layer's own scope guards protect every read.
 *
 * @param fetchImpl - omit in production so the auth-patched global fetch runs;
 *   the login flow may pass the pre-popup public fetch for a profile read.
 */
export async function resolvePhotosRoot(opts: {
  webId: string;
  podRoot: string;
  fetchImpl?: typeof fetch;
}): Promise<PhotosRoot> {
  const { webId, podRoot, fetchImpl } = opts;
  const fallback: PhotosRoot = { rootUrl: conventionalRoot(podRoot), isFallback: true };
  try {
    const { dataset: profile } = await freshRdf(webId, fetchImpl);
    const links = typeIndexLinks(webId, profile);
    const indexUrl = links.privateIndex ?? links.publicIndex;
    if (!indexUrl) return fallback;
    const { dataset: indexDs } = await freshRdf(indexUrl, fetchImpl);
    const index = new TypeIndexDataset(indexDs, DataFactory);
    const located = index
      .locate(PHOTOGRAPH_CLASS)
      .map((l) => l.container)
      .find((c): c is string => typeof c === "string" && c.length > 0);
    if (!located) return fallback;
    return { rootUrl: asContainer(located), isFallback: false };
  } catch {
    // No usable Type Index (absent / unreadable / unparseable) — fall back to the
    // conventional path. Never block the gallery on discovery.
    return fallback;
  }
}
