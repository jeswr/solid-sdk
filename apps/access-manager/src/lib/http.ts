// AUTHORED-BY Claude Fable 5
//
// The HTTP seam of the whole app. EVERY pod interaction goes through an
// injectable `SolidFetch` (the authenticated fetch handed down from the login
// controller), so every view and every pipeline is unit-testable against a
// stubbed in-memory pod — no live server needed for the gate.
//
// Writes are ALWAYS conditional (the suite CAS discipline, proposal §3.5):
//   - `putIfMatch`     — update guarded by the ETag from the read (lost race → 412)
//   - `putIfNoneMatch` — create-only (`If-None-Match: *`; already-exists → 412)
// A 412 is a first-class, typed outcome (`PreconditionFailedError`) the caller
// re-reads and reconciles on — never a swallowed error.

import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";

/** The injectable authenticated-fetch seam. */
export type SolidFetch = typeof fetch;

/** A read RDF resource + the validator needed for a conditional write. */
export interface ReadRdf {
  url: string;
  dataset: DatasetCore;
  /** Strong validator for `If-Match`; null when the server sent none. */
  etag: string | null;
}

/** Thrown when a conditional write loses the race (HTTP 412). */
export class PreconditionFailedError extends Error {
  readonly url: string;
  constructor(url: string, kind: "if-match" | "if-none-match") {
    super(
      kind === "if-match"
        ? `Conditional write to ${url} failed: the resource changed since it was read (412).`
        : `Create-only write to ${url} failed: the resource already exists (412).`,
    );
    this.name = "PreconditionFailedError";
    this.url = url;
  }
}

/** Thrown on any other non-2xx write response. */
export class WriteFailedError extends Error {
  readonly url: string;
  readonly status: number;
  constructor(url: string, status: number) {
    super(`Write to ${url} failed with HTTP ${status}.`);
    this.name = "WriteFailedError";
    this.url = url;
    this.status = status;
  }
}

/** Only http(s) URLs are ever dereferenced (SSRF discipline — untrusted IRIs). */
export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * GET + parse an RDF resource, keeping the ETag for a later `If-Match` write.
 * Returns `null` on 404 (a first-class "does not exist" for ACL discovery and
 * create-only flows); every other failure propagates as `RdfFetchError`.
 */
export async function readRdf(url: string, fetchFn: SolidFetch): Promise<ReadRdf | null> {
  try {
    const { dataset, etag, url: finalUrl } = await fetchRdf(url, { fetch: fetchFn });
    return { url: finalUrl, dataset, etag };
  } catch (e) {
    if (e instanceof RdfFetchError && e.status === 404) return null;
    throw e;
  }
}

/**
 * Conditional update: PUT Turtle guarded by the ETag captured at read time.
 * When `etag` is null (a server that sends no validator) the write degrades to
 * an unconditional PUT — the degraded legacy path, kept explicit here.
 */
export async function putIfMatch(
  url: string,
  turtle: string,
  etag: string | null,
  fetchFn: SolidFetch,
): Promise<void> {
  const headers: Record<string, string> = { "content-type": "text/turtle" };
  if (etag !== null) headers["if-match"] = etag;
  const res = await fetchFn(url, { method: "PUT", headers, body: turtle });
  if (res.status === 412) throw new PreconditionFailedError(url, "if-match");
  if (!res.ok) throw new WriteFailedError(url, res.status);
}

/** Create-only PUT (`If-None-Match: *`). 412 = already exists. */
export async function putIfNoneMatch(
  url: string,
  turtle: string,
  fetchFn: SolidFetch,
): Promise<void> {
  const res = await fetchFn(url, {
    method: "PUT",
    headers: { "content-type": "text/turtle", "if-none-match": "*" },
    body: turtle,
  });
  if (res.status === 412) throw new PreconditionFailedError(url, "if-none-match");
  if (!res.ok) throw new WriteFailedError(url, res.status);
}

/** DELETE a resource. 404 is treated as already-gone (idempotent). */
export async function deleteResource(url: string, fetchFn: SolidFetch): Promise<void> {
  const res = await fetchFn(url, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new WriteFailedError(url, res.status);
}
