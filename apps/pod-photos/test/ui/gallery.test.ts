// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The gallery READ facade, driven by a stubbed fetch (the auth seam). Proves it
// composes the data-layer primitives into folders + photos, surfaces 401/403 as
// a typed GalleryAccessError, re-throws other failures, and is resilient to a
// single unreadable / non-photo / unparseable child — all with NO real pod.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { GalleryAccessError, listGallery } from '../../src/ui/index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

// A tiny LDP "pod": maps a URL to the Turtle a GET returns. Anything not in the
// map 404s.
const ROOT = `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
<https://pod.example/photos/> a ldp:Container ;
  ldp:contains <https://pod.example/photos/2026/>,
               <https://pod.example/photos/sunset.ttl>,
               <https://pod.example/photos/aurora.ttl> .
<https://pod.example/photos/2026/> a ldp:Container .
<https://pod.example/photos/sunset.ttl> a ldp:Resource .
<https://pod.example/photos/aurora.ttl> a ldp:Resource .
`;

const SUNSET = `
@prefix schema: <https://schema.org/> .
@prefix exif: <http://www.w3.org/2003/12/exif/ns#> .
<https://pod.example/photos/sunset.ttl#it> a schema:Photograph ;
  schema:name "Sunset over the bay" ;
  schema:contentUrl <https://pod.example/photos/sunset.jpg> ;
  schema:keywords "sunset", "bay" ;
  schema:width 6240 ; schema:height 4160 .
`;

const AURORA = `
@prefix schema: <https://schema.org/> .
<https://pod.example/photos/aurora.ttl#it> a schema:Photograph ;
  schema:name "Aurora" ;
  schema:contentUrl <https://pod.example/photos/aurora.jpg> .
`;

// A resource that parses fine but is NOT a schema:Photograph — must be skipped.
const NOT_A_PHOTO = `
@prefix schema: <https://schema.org/> .
<https://pod.example/photos/note.ttl#it> a schema:TextDigitalDocument ;
  schema:name "a note" .
`;

const EMPTY = `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
<https://pod.example/photos/empty/> a ldp:Container .
`;

function turtleResponse(url: string, body: string): Response {
  const res = new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/turtle', etag: '"v1"' },
  });
  Object.defineProperty(res, 'url', { value: url });
  return res;
}

function statusResponse(url: string, status: number): Response {
  const res = new Response(null, { status });
  Object.defineProperty(res, 'url', { value: url });
  return res;
}

/** A fake authenticated fetch that routes by URL to a canned Turtle body. */
function routerFetch(map: Record<string, string>): typeof globalThis.fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    const body = map[url];
    return body === undefined ? statusResponse(url, 404) : turtleResponse(url, body);
  }) as unknown as typeof globalThis.fetch;
}

/** A fake fetch that always returns the given status (for 401/403 paths). */
function statusFetch(status: number): typeof globalThis.fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    return statusResponse(url, status);
  }) as unknown as typeof globalThis.fetch;
}

describe('listGallery', () => {
  it('lists sub-folders and photos, sorted by name, with thumbnails + dimensions', async () => {
    const fetch = routerFetch({
      'https://pod.example/photos/': ROOT,
      'https://pod.example/photos/sunset.ttl': SUNSET,
      'https://pod.example/photos/aurora.ttl': AURORA,
    });

    const listing = await listGallery('https://pod.example/photos/', { fetch });

    expect(listing.url).toBe('https://pod.example/photos/');
    expect(listing.folders).toEqual([{ url: 'https://pod.example/photos/2026/', name: '2026' }]);
    // Photos sorted by name: Aurora before Sunset.
    expect(listing.photos.map((p) => p.photo.name)).toEqual(['Aurora', 'Sunset over the bay']);
    const sunset = listing.photos[1];
    expect(sunset?.url).toBe('https://pod.example/photos/sunset.ttl');
    expect(sunset?.etag).toBe('"v1"');
    expect(sunset?.photo.contentUrl).toBe('https://pod.example/photos/sunset.jpg');
    expect(sunset?.photo.keywords).toEqual(['bay', 'sunset']);
    expect(sunset?.photo.exif.pixelWidth).toBe(6240);
  });

  it('normalises a slashless container URL and skips a self-listing container', async () => {
    const fetch = routerFetch({ 'https://pod.example/photos/': EMPTY_ROOT });
    const listing = await listGallery('https://pod.example/photos', { fetch });
    expect(listing.url).toBe('https://pod.example/photos/');
    // The container's self-reference in ldp:contains is not treated as a child.
    expect(listing.folders).toEqual([]);
    expect(listing.photos).toEqual([]);
  });

  it('skips a child that is unreadable, not-a-photo, or unparseable', async () => {
    const fetch = routerFetch({
      'https://pod.example/photos/': MIXED_ROOT,
      'https://pod.example/photos/aurora.ttl': AURORA,
      'https://pod.example/photos/note.ttl': NOT_A_PHOTO,
      // missing.ttl is absent → 404 → skipped
    });
    const listing = await listGallery('https://pod.example/photos/', { fetch });
    expect(listing.photos.map((p) => p.photo.name)).toEqual(['Aurora']);
  });

  it('returns an empty listing for a container with no children', async () => {
    const fetch = routerFetch({ 'https://pod.example/photos/empty/': EMPTY });
    const listing = await listGallery('https://pod.example/photos/empty/', { fetch });
    expect(listing.folders).toEqual([]);
    expect(listing.photos).toEqual([]);
  });

  it('throws GalleryAccessError(401) on an unauthenticated container read', async () => {
    const fetch = statusFetch(401);
    await expect(listGallery('https://pod.example/private/', { fetch })).rejects.toMatchObject({
      name: 'GalleryAccessError',
      status: 401,
      url: 'https://pod.example/private/',
    });
  });

  it('throws GalleryAccessError(403) on a forbidden container read', async () => {
    const fetch = statusFetch(403);
    await expect(listGallery('https://pod.example/private/', { fetch })).rejects.toBeInstanceOf(
      GalleryAccessError,
    );
  });

  it('re-throws a non-access container failure (404) unchanged', async () => {
    const fetch = statusFetch(404);
    await expect(listGallery('https://pod.example/gone/', { fetch })).rejects.not.toBeInstanceOf(
      GalleryAccessError,
    );
  });

  it('rejects with AbortError when handed an already-aborted signal (early-out)', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = routerFetch({
      'https://pod.example/photos/': ROOT,
      'https://pod.example/photos/sunset.ttl': SUNSET,
      'https://pod.example/photos/aurora.ttl': AURORA,
    });
    await expect(
      listGallery('https://pod.example/photos/', { fetch, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('aborts the photo walk when the signal trips mid-walk', async () => {
    // The signal is NOT aborted up front (so the container read + early-out pass)
    // — it is aborted the moment the first photo GET is issued, so the in-walk
    // `signal.aborted` check rejects the call.
    const controller = new AbortController();
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      const map: Record<string, string> = {
        'https://pod.example/photos/': ROOT,
        'https://pod.example/photos/sunset.ttl': SUNSET,
        'https://pod.example/photos/aurora.ttl': AURORA,
      };
      if (url !== 'https://pod.example/photos/') {
        controller.abort(); // a photo GET → trip the signal before parse
      }
      const body = map[url];
      return body === undefined ? statusResponse(url, 404) : turtleResponse(url, body);
    }) as unknown as typeof globalThis.fetch;

    await expect(
      listGallery('https://pod.example/photos/', { fetch, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('falls back to the global fetch when none is injected', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://pod.example/photos/empty/') {
        return turtleResponse(url, EMPTY);
      }
      return statusResponse(url, 404);
    }) as typeof fetch);
    const listing = await listGallery('https://pod.example/photos/empty/');
    expect(listing.photos).toEqual([]);
  });
});

// A container that lists ITSELF in ldp:contains (some servers emit the
// self-description as a member). The facade must skip the self-reference, so
// this both drives the slashless-normalisation test AND covers the self-skip.
const EMPTY_ROOT = `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
<https://pod.example/photos/> a ldp:Container ;
  ldp:contains <https://pod.example/photos/> .
`;

// A root mixing one good photo, one non-photo doc, and one missing resource —
// the resilience path.
const MIXED_ROOT = `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
<https://pod.example/photos/> a ldp:Container ;
  ldp:contains <https://pod.example/photos/aurora.ttl>,
               <https://pod.example/photos/note.ttl>,
               <https://pod.example/photos/missing.ttl> .
<https://pod.example/photos/aurora.ttl> a ldp:Resource .
<https://pod.example/photos/note.ttl> a ldp:Resource .
<https://pod.example/photos/missing.ttl> a ldp:Resource .
`;
