// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Pod I/O — read a health resource off a Solid pod into a typed HealthDocument,
// and prepare a conditional write back. Reads go through @jeswr/fetch-rdf (never
// an inline parser); writes serialise via n3.Writer (src/serialise.ts) and PUT
// with If-Match on the ETag captured at read time.
//
// Auth is the caller's concern: pass no `fetch` and @solid/reactive-authentication
// patches globalThis.fetch (the house pattern), or pass an authenticated fetch
// explicitly. A read is WAC-gated by the server: a 401/403 surfaces as an
// RdfFetchError with that status — discovery (a type-index hint) is NOT a grant,
// so callers must handle the access error rather than assume readability.

import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { HealthDocument } from "./model.js";
import { toTurtle } from "./serialise.js";

export { RdfFetchError };

/** Options for reading a health resource. */
export interface ReadOptions {
  /** An authenticated fetch; omit to use the patched `globalThis.fetch`. */
  fetch?: typeof fetch;
  /** An abort signal for the GET. */
  signal?: AbortSignal;
}

/** The result of reading a health resource: the typed document + its validators. */
export interface ReadHealthResult {
  /** The parsed resource as a typed, mutable HealthDocument. */
  document: HealthDocument;
  /** The strong ETag for a conditional write (`null` if the server sent none). */
  etag: string | null;
  /** The final resource URL after redirects. */
  url: string;
}

/**
 * Read a health resource off a pod into a typed `HealthDocument`. The returned
 * `etag` MUST be carried into `writeHealth` for the conditional `PUT`. A non-2xx
 * (incl. 401/403/404) throws `RdfFetchError` with `.status` — branch on the
 * status, never string-match the message.
 */
export async function readHealth(
  url: string,
  options: ReadOptions = {},
): Promise<ReadHealthResult> {
  const fetchOpts: Parameters<typeof fetchRdf>[1] = {};
  if (options.fetch !== undefined) fetchOpts.fetch = options.fetch;
  if (options.signal !== undefined) fetchOpts.signal = options.signal;

  const { dataset, etag, url: finalUrl } = await fetchRdf(url, fetchOpts);
  return {
    document: new HealthDocument(dataset, DataFactory),
    etag,
    url: finalUrl,
  };
}

/** A fresh, empty HealthDocument backed by a new in-memory store. */
export function emptyHealthDocument(): HealthDocument {
  return new HealthDocument(new Store(), DataFactory);
}

/** Options for writing a health document back to a pod. */
export interface WriteOptions {
  /** An authenticated fetch; omit to use the patched `globalThis.fetch`. */
  fetch?: typeof fetch;
  /**
   * The ETag from the read, sent as `If-Match` for an optimistic-concurrency
   * write. Omit (or pass `null`) only for a create / a server that sent no ETag;
   * a missing `If-Match` means the write is unconditional (last-writer-wins).
   */
  etag?: string | null;
  /** An abort signal for the PUT. */
  signal?: AbortSignal;
}

/**
 * Serialise a health document to Turtle and `PUT` it back to `url`. With an
 * `etag` the write is conditional (`If-Match`); a `412 Precondition Failed`
 * means the resource changed under you — re-read, re-apply, retry. Returns the
 * raw `Response` so the caller can inspect the new ETag / status.
 */
export async function writeHealth(
  url: string,
  document: DatasetCore,
  options: WriteOptions = {},
): Promise<Response> {
  const body = await toTurtle(document);
  const doFetch = options.fetch ?? globalThis.fetch;

  const headers: Record<string, string> = { "content-type": "text/turtle" };
  if (options.etag) headers["if-match"] = options.etag;

  const init: RequestInit = { method: "PUT", headers, body };
  if (options.signal !== undefined) init.signal = options.signal;

  return doFetch(url, init);
}
