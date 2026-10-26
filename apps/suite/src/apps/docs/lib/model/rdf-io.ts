// AUTHORED-BY Codex GPT-6.1-Sol
// Ported from apps/pod-docs/src/rdf-io.ts.
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * The Pod-Docs data layer's ONE way to touch pod RDF I/O: read (via
 * `@jeswr/fetch-rdf`, force-revalidated), serialise (via `n3.Writer`) and the
 * minimal write/delete primitives. App modules never call `fetch`/`fetchRdf`
 * directly and never parse or serialise RDF inline (house rule: go through
 * `@jeswr/fetch-rdf` + `n3.Writer`, never a bespoke parser).
 */
import { type FetchedRdf, fetchRdf } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import { Writer } from "n3";
import { ResourceDeleteError, ResourceWriteError } from "./errors.js";

/**
 * Force conditional revalidation through any HTTP cache. Solid servers (CSS
 * included) send `ETag`/`Last-Modified` but no `Cache-Control`, so a browser
 * may answer a GET from a heuristically-fresh cache — handing read-modify-write
 * paths a stale ETag (spurious 412 on `If-Match`). `no-cache` keeps the cache
 * but forces a cheap conditional GET (304 when unchanged).
 */
export const REVALIDATE_HEADERS = { "cache-control": "no-cache" } as const;

/**
 * Fetch + parse a pod RDF document, always revalidating any cached copy.
 *
 * Same contract as `fetchRdf` (errors propagate as `RdfFetchError`; keep the
 * returned `etag` for conditional writes).
 *
 * @param fetchImpl - required account-scoped fetch implementation.
 */
export function readRdf(url: string, fetchImpl: typeof fetch): Promise<FetchedRdf> {
  return fetchRdf(url, { fetch: fetchImpl, headers: REVALIDATE_HEADERS });
}

/** Serialise an in-memory dataset to Turtle (promisified n3.Writer). */
export function serializeTurtle(
  dataset: DatasetCore,
  prefixes?: Record<string, string>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const writer = new Writer({ format: "text/turtle", prefixes });
    for (const quad of dataset) writer.addQuad(quad);
    writer.end((err, result) => (err ? reject(err) : resolve(result)));
  });
}

/** Options for {@link writeRdf}. */
export interface WriteOptions {
  /** Strong ETag for conflict detection; weak ETags fall back to existence (`*`). */
  etag?: string | null | undefined;
  /** Send `If-None-Match: *` — create only, never overwrite (412 if it exists). */
  createOnly?: boolean | undefined;
  /** Required account-scoped fetch implementation. */
  fetchImpl: typeof fetch;
  /** Optional Turtle prefix map for readable documents. */
  prefixes?: Record<string, string> | undefined;
}

/**
 * Serialise the dataset and `PUT` it as Turtle. Always sends an explicit
 * `Content-Type`. Servers that support it create intermediate containers on
 * PUT, so a deep path needs no separate container creation.
 *
 * @throws ResourceWriteError on any non-2xx answer (412 = precondition failed:
 *   a concurrent edit under `etag`, or "already exists" under `createOnly`).
 */
export async function writeRdf(
  url: string,
  dataset: DatasetCore,
  opts: WriteOptions,
): Promise<{ etag: string | null }> {
  const body = await serializeTurtle(dataset, opts.prefixes);
  const headers: Record<string, string> = { "content-type": "text/turtle" };
  // If-Match requires strong comparison: a weak validator can never match.
  // Match the store's no-validator policy: require existence, without claiming
  // to detect concurrent edits. Create-only writes retain their own precondition.
  if (opts.etag && !opts.createOnly)
    headers["if-match"] = opts.etag.startsWith("W/") ? "*" : opts.etag;
  if (opts.createOnly) headers["if-none-match"] = "*";
  const init: RequestInit = { method: "PUT", headers, body };
  const res = await opts.fetchImpl(url, init);
  if (!res.ok) throw new ResourceWriteError(url, res.status);
  return { etag: res.headers.get("etag") };
}

/**
 * Delete a resource. A `404`/`410` is treated as success (idempotent delete —
 * the resource is already gone, the caller's desired end state).
 *
 * @param fetchImpl - required account-scoped fetch implementation.
 * @throws ResourceDeleteError on any other non-2xx answer.
 */
export async function deleteRdf(url: string, fetchImpl: typeof fetch): Promise<void> {
  const init: RequestInit = { method: "DELETE" };
  const res = await fetchImpl(url, init);
  if (res.ok || res.status === 404 || res.status === 410) return;
  throw new ResourceDeleteError(url, res.status);
}

/** Derive a friendly name from a resource URL (last non-empty path segment). */
export function nameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    const last = segments.at(-1);
    return last ? decodeURIComponent(last) : u.hostname;
  } catch {
    return url;
  }
}
