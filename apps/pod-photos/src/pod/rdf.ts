// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * The app's ONE way to GET, serialise, write and delete pod RDF — composed
 * from `@jeswr/fetch-rdf` (read) + `n3.Writer` (serialise) + a thin `PUT`/
 * `DELETE`. App modules never touch `fetch`/`fetchRdf` directly, never inline
 * Turtle, and never hand-build quads (house rule).
 *
 * **Caching.** Solid servers (CSS verified) send `ETag`/`Last-Modified` but no
 * `Cache-Control`, so a browser applies heuristic freshness and may answer a
 * GET from cache without revalidating. For read-modify-write (the type index,
 * an album membership edit) that hands a stale ETag into `If-Match` → a
 * spurious 412. We send `Cache-Control: no-cache` to force conditional
 * revalidation (a cheap `304` when unchanged) while keeping the HTTP cache.
 *
 * @see https://developer.mozilla.org/docs/Web/HTTP/Caching#heuristic_caching
 */
import { fetchRdf } from '@jeswr/fetch-rdf';
import type { DatasetCore } from '@rdfjs/types';
import { Writer } from 'n3';
import { ResourceDeleteError, ResourceWriteError } from './errors.js';

/** Request headers that force conditional revalidation through HTTP caches. */
export const REVALIDATE_HEADERS = { 'cache-control': 'no-cache' } as const;

/**
 * Fetch + parse a pod RDF document, always revalidating any cached copy. Same
 * contract as `fetchRdf` (errors propagate as `RdfFetchError`; keep the
 * returned `etag` for conditional writes).
 *
 * @param fetchImpl - test-only override; **omit in production** so the
 *   auth-patched global fetch runs.
 */
export function freshRdf(url: string, fetchImpl?: typeof fetch): ReturnType<typeof fetchRdf> {
  return fetchRdf(
    url,
    fetchImpl ? { fetch: fetchImpl, headers: REVALIDATE_HEADERS } : { headers: REVALIDATE_HEADERS },
  );
}

/** Serialise an in-memory dataset to Turtle (promisified `n3.Writer`). */
export function serializeTurtle(
  dataset: DatasetCore,
  prefixes?: Record<string, string>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const writer = new Writer({ format: 'text/turtle', prefixes });
    for (const quad of dataset) writer.addQuad(quad);
    // The error arm is defensive: n3's Writer.end does not surface an error for
    // any well-formed RDF/JS quad, so it is not exercisable from a test.
    /* v8 ignore next */
    writer.end((err, result) => (err ? reject(err) : resolve(result)));
  });
}

export interface WriteResourceOptions {
  /** Send `If-Match` so a concurrent edit fails with 412 instead of clobbering. */
  etag?: string | null;
  /** Send `If-None-Match: *` — create only, never overwrite (412 if it exists). */
  createOnly?: boolean;
  /** Test-only override; **omit in production** so the auth-patched global runs. */
  fetchImpl?: typeof fetch;
  /** Optional Turtle prefix map for readable documents. */
  prefixes?: Record<string, string>;
}

/**
 * Serialise the dataset and `PUT` it as Turtle. Always sends an explicit
 * `Content-Type`. Servers that support it create intermediate containers on
 * PUT, so writing `…/photos/x.ttl` needs no separate container creation.
 *
 * @throws ResourceWriteError on any non-2xx answer (412 = precondition failed:
 *   a concurrent edit under `etag`, or "already exists" under `createOnly` —
 *   callers branch on `.status`).
 */
export async function writeResource(
  url: string,
  dataset: DatasetCore,
  opts: WriteResourceOptions = {},
): Promise<{ etag: string | null }> {
  const body = await serializeTurtle(dataset, opts.prefixes);
  const headers: Record<string, string> = { 'content-type': 'text/turtle' };
  if (opts.etag) headers['if-match'] = opts.etag;
  if (opts.createOnly) headers['if-none-match'] = '*';
  const init: RequestInit = { method: 'PUT', headers, body };
  const res = opts.fetchImpl ? await opts.fetchImpl(url, init) : await fetch(url, init);
  if (!res.ok) throw new ResourceWriteError(url, res.status);
  return { etag: res.headers.get('etag') };
}

/**
 * Read a single RDF resource and keep its ETag for a later conditional write.
 * A thin pass-through over `freshRdf` so app modules never import it directly.
 * Errors propagate as `RdfFetchError` (branch on `.status`; 404 = not found).
 */
export async function readResource(
  url: string,
  fetchImpl?: typeof fetch,
): Promise<{ dataset: DatasetCore; etag: string | null }> {
  return freshRdf(url, fetchImpl);
}

/**
 * Delete a resource. A `404`/`410` is treated as success (idempotent delete —
 * the resource is already gone, the caller's desired end state).
 *
 * @throws ResourceDeleteError on any other non-2xx answer.
 */
export async function deleteResource(url: string, fetchImpl?: typeof fetch): Promise<void> {
  const init: RequestInit = { method: 'DELETE' };
  const res = fetchImpl ? await fetchImpl(url, init) : await fetch(url, init);
  if (res.ok || res.status === 404 || res.status === 410) return;
  throw new ResourceDeleteError(url, res.status);
}

/** Derive a friendly name from a resource URL (last non-empty path segment). */
export function nameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const segments = u.pathname.split('/').filter(Boolean);
    const last = segments.at(-1);
    return last ? decodeURIComponent(last) : u.hostname;
  } catch {
    return url;
  }
}

/**
 * Lower-case, hyphenated, ASCII-only slug — URI-safe and `:`-free (a `:` is an
 * ACL-matching hazard on some servers). Empty/uncleanable input yields `""` so
 * the caller falls back to a purely random name. Capped so URLs stay short.
 */
export function toSlug(input: string | undefined): string {
  if (!input) return '';
  return (
    input
      .normalize('NFKD')
      // biome-ignore lint/suspicious/noMisleadingCharacterClass: combining marks range strips diacritics
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
      .replace(/-+$/g, '')
  );
}
