// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * The Pod-Chat data layer's ONE way to touch pod RDF I/O: read (via
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
 * @param fetchImpl - test-only override; **omit in production** so the
 *   auth-patched global fetch (`@solid/reactive-authentication`) runs.
 */
export function readRdf(url: string, fetchImpl?: typeof fetch): Promise<FetchedRdf> {
  return fetchRdf(
    url,
    fetchImpl ? { fetch: fetchImpl, headers: REVALIDATE_HEADERS } : { headers: REVALIDATE_HEADERS },
  );
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
 * PUT, so a deep path needs no separate container creation.
 *
 * @throws ResourceWriteError on any non-2xx answer (412 = precondition failed:
 *   a concurrent edit under `etag`, or "already exists" under `createOnly`).
 */
export async function writeRdf(
  url: string,
  dataset: DatasetCore,
  opts: WriteOptions = {},
): Promise<{ etag: string | null }> {
  const body = await serializeTurtle(dataset, opts.prefixes);
  const headers: Record<string, string> = { "content-type": "text/turtle" };
  if (opts.etag) headers["if-match"] = opts.etag;
  if (opts.createOnly) headers["if-none-match"] = "*";
  const init: RequestInit = { method: "PUT", headers, body };
  const res = opts.fetchImpl ? await opts.fetchImpl(url, init) : await fetch(url, init);
  if (!res.ok) throw new ResourceWriteError(url, res.status);
  return { etag: res.headers.get("etag") };
}

/**
 * Idempotently ensure a container exists via a conditional LDP `PUT`
 * (`If-None-Match: *`) of an empty Turtle body with `Content-Type: text/turtle`
 * and `Link: …#Container`. A `2xx` (freshly created) and a `412 Precondition
 * Failed` (the conditional create's *only* "already exists" signal) are BOTH the
 * caller's desired end state. **Every other non-2xx throws** — crucially `409
 * Conflict`, which on Solid/LDP is NOT "already exists" but "cannot create here"
 * (e.g. a missing parent container). Swallowing a 409 would report success on a
 * container that was never created, so we propagate it.
 *
 * This is the belt-and-braces complement to PUT-creates-intermediates: a server
 * that does NOT recursively mint parent containers on a deep resource PUT needs
 * the parents created first, and a server that DOES simply answers the redundant
 * container PUT with `412` we swallow. Parents are created shallowest-first so a
 * child container's PUT never precedes its parent's (no spurious 409).
 *
 * @param fetchImpl - test-only override; **omit in production**.
 * @throws ResourceWriteError on any non-2xx that is not the conditional `412`.
 */
export async function ensureContainer(url: string, fetchImpl?: typeof fetch): Promise<void> {
  const headers: Record<string, string> = {
    "content-type": "text/turtle",
    link: '<http://www.w3.org/ns/ldp#Container>; rel="type"',
    "if-none-match": "*",
  };
  const init: RequestInit = { method: "PUT", headers, body: "" };
  const res = fetchImpl ? await fetchImpl(url, init) : await fetch(url, init);
  // 2xx = freshly created; 412 = the conditional create's "already exists". A 409
  // means the server could NOT create it (e.g. missing parent) → propagate it.
  if (res.ok || res.status === 412) return;
  throw new ResourceWriteError(url, res.status);
}

/**
 * Delete a resource. A `404`/`410` is treated as success (idempotent delete —
 * the resource is already gone, the caller's desired end state).
 *
 * @param fetchImpl - test-only override; **omit in production**.
 * @throws ResourceDeleteError on any other non-2xx answer.
 */
export async function deleteRdf(url: string, fetchImpl?: typeof fetch): Promise<void> {
  const init: RequestInit = { method: "DELETE" };
  const res = fetchImpl ? await fetchImpl(url, init) : await fetch(url, init);
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
