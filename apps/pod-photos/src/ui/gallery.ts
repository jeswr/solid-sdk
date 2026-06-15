// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The photo-gallery READ facade — the single place the gallery view enters the
// data layer. It composes the EXISTING data-layer primitives (`listContainer`
// for the LDP listing, `readResource` + `parsePhoto` for each photo document)
// into the shape one gallery screen needs: the sub-folders to navigate into,
// plus the photos (name + image `contentUrl` for a thumbnail) to lay out in a
// grid. It NEVER re-implements LDP/RDF reading and NEVER hand-builds quads.
//
// ── WAC-aware ────────────────────────────────────────────────────────────────
// The data layer's `listContainer` deliberately maps a 401/403/404 on the
// *container itself* to `[]` (a freshly-provisioned pod may register a container
// in the type index before it is created, or a reader may lack access to a
// sibling). A gallery screen, though, wants to tell "this folder is empty" apart
// from "you can't see this folder", so this facade does its OWN container GET
// and raises a typed {@link GalleryAccessError} on 401/403 — exactly the
// branch the view needs (401 → prompt login, 403 → "no access"). A 404 is a
// genuinely-missing container and surfaces as the underlying RdfFetchError.
//
// ── AUTH SEAM ────────────────────────────────────────────────────────────────
// The authenticated `fetch` is INJECTED, never imported (see the data layer's
// own note in src/pod/rdf.ts). Pass the session's fetch via `fetch`; omit it and
// the data layer falls back to the global fetch — which, in a real session,
// @solid/reactive-authentication patches so a plain fetch transparently upgrades
// with a DPoP token. That wiring is the create-solid-app shell's job (#18-gated:
// https://github.com/solid-contrib/reactive-authentication/issues/18); this
// facade is deliberately unaware of it and works today against a stub fetch.

import { RdfFetchError } from '@jeswr/fetch-rdf';
import { ContainerDataset } from '@solid/object';
import { DataFactory } from 'n3';
import { type Photo, parsePhoto } from '../photos/photograph.js';
import { freshRdf } from '../pod/rdf.js';

/** A sub-folder to navigate into (an LDP sub-container of the current view). */
export interface FolderEntry {
  /** The sub-container URL (always ends in `/`). */
  url: string;
  /** Friendly name from the listing (else the URL tail). */
  name: string;
}

/** A photo tile: its document URL, ETag, and the parsed {@link Photo}. */
export interface PhotoEntry {
  /** The photo document URL (the RDF resource describing the photo). */
  url: string;
  /** ETag from the read — kept for a later conditional write. */
  etag: string | null;
  /** The parsed photo (name, `contentUrl` for the thumbnail, keywords, …). */
  photo: Photo;
}

/** One gallery screen: the sub-folders + the photos in the current container. */
export interface GalleryListing {
  /** The container being viewed (normalised, trailing slash). */
  url: string;
  /** Sub-containers, sorted by name — navigable folder tiles. */
  folders: FolderEntry[];
  /** Photos in this container, sorted by name — the thumbnail grid. */
  photos: PhotoEntry[];
}

/** Options for {@link listGallery}. */
export interface ListGalleryOptions {
  /**
   * The authenticated fetch (e.g. the one @solid/reactive-authentication patches
   * onto globalThis.fetch). Omit to use the ambient global fetch. The injectable
   * auth seam — unit tests pass a stub here.
   */
  fetch?: typeof fetch;
  /** Abort signal forwarded to every underlying GET. */
  signal?: AbortSignal;
}

/**
 * Raised when the pod refuses access (HTTP 401/403) to the container being
 * viewed. Distinct from a 404 (a genuinely-missing container, which surfaces as
 * the original {@link RdfFetchError}) so the view can branch: 401 → prompt
 * login, 403 → "you don't have access".
 */
export class GalleryAccessError extends Error {
  readonly status: 401 | 403;
  readonly url: string;
  constructor(status: 401 | 403, url: string, cause: unknown) {
    super(
      status === 401 ? `Authentication required to view ${url}` : `Forbidden: no access to ${url}`,
    );
    this.name = 'GalleryAccessError';
    this.status = status;
    this.cause = cause;
    this.url = url;
  }
}

/** Stable order: alphabetical by name, locale-aware. */
function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name);
}

/**
 * Build one gallery screen for `containerUrl`: its direct sub-folders plus every
 * `schema:Photograph` resource in it (with the image `contentUrl` for a
 * thumbnail). The container URL is normalised to a trailing slash (LDP
 * containers are slash-terminated). One GET reads the container listing; each
 * photo document is then read so its `contentUrl`/name/keywords are available —
 * an individual photo that 404s, fails to parse, or isn't a Photograph is
 * skipped (resilience over strictness), but a 401/403 on the *container itself*
 * raises {@link GalleryAccessError}.
 *
 * @throws {GalleryAccessError} on 401 / 403 reading the container.
 * @throws {RdfFetchError} on any other non-2xx / network / parse failure of the
 *   container GET (e.g. 404 for a missing container) — re-thrown unchanged.
 */
export async function listGallery(
  containerUrl: string,
  options: ListGalleryOptions = {},
): Promise<GalleryListing> {
  const url = containerUrl.endsWith('/') ? containerUrl : `${containerUrl}/`;
  const { fetch: authedFetch, signal } = options;

  // ONE GET for the container listing, with our own WAC branch (the data layer's
  // `listContainer` would have swallowed a 401/403 into `[]`).
  let containerDataset: import('@rdfjs/types').DatasetCore;
  try {
    ({ dataset: containerDataset } = await freshRdf(url, authedFetch));
  } catch (error) {
    if (error instanceof RdfFetchError && (error.status === 401 || error.status === 403)) {
      throw new GalleryAccessError(error.status, url, error);
    }
    throw error;
  }

  const container = new ContainerDataset(containerDataset, DataFactory).container;
  const folders: FolderEntry[] = [];
  const photoUrls: string[] = [];
  for (const child of container?.contains ?? []) {
    if (child.id === url) continue; // the container's self-description
    if (child.isContainer) {
      folders.push({ url: child.id, name: child.name });
    } else {
      photoUrls.push(child.id);
    }
  }

  // Read each photo document for its contentUrl/name/keywords. A per-item
  // failure (vanished, forbidden, not-a-photo, unparseable) is skipped so a
  // single bad resource never blanks the whole gallery — the same resilience
  // the data layer's PodStore.list() applies.
  const photos: PhotoEntry[] = [];
  for (const photoUrl of photoUrls) {
    try {
      const { dataset, etag } = await freshRdf(photoUrl, authedFetch);
      // Abort cooperatively between reads (freshRdf doesn't take a signal; this
      // stops the N+1 walk promptly when a newer navigation supersedes us).
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const photo = parsePhoto(photoUrl, dataset);
      if (photo !== undefined) {
        photos.push({ url: photoUrl, etag, photo });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error; // a real cancellation — let the caller's staleness guard see it
      }
      // otherwise skip this one photo and keep loading the rest
    }
  }

  folders.sort(byName);
  photos.sort((a, b) => byName({ name: a.photo.name }, { name: b.photo.name }));
  return { url, folders, photos };
}
