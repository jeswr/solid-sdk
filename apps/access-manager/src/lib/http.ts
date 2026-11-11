// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Fable 5
// AUTHORED-BY Codex GPT-6.1-Sol
//
// Dashboard/history reads and conditional writes use an injected session fetch
// directly. readRdf has no byte limit: the SDK exports no bounded reader for
// authenticated storage reads. Public profile callers supply the SDK's bounded
// public transport, and the request inbox/decision pipeline uses the SDK transport.
//
// Writes are ALWAYS conditional (the suite CAS discipline, proposal §3.5):
//   - `putIfMatch`     — update guarded by the ETag from the read (lost race → 412)
// A 412 is a first-class, typed outcome (`PreconditionFailedError`) the caller
// re-reads and reconciles on — never a swallowed error.

import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { requireStrongEtag } from "@jeswr/pod-access/requests-solid";
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
  constructor(url: string) {
    super(`Conditional write to ${url} failed: the resource changed since it was read (412).`);
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
 * STRICT storage-containment check (the confused-deputy boundary): `target` is
 * within `root` iff both parse as http(s) URLs, share an origin, and the
 * root's path (with a guaranteed trailing "/") is a path-segment prefix of the
 * target's. A raw `startsWith` is NOT sufficient — a root without a trailing
 * slash would treat `https://pod.example.evil/...` or a sibling
 * `https://pod.example/foo-bar` as in-scope (the roborev finding).
 */
export function isWithinStorage(target: string, root: string): boolean {
  if (!isHttpUrl(target) || !isHttpUrl(root)) return false;
  const t = new URL(target);
  const r = new URL(root);
  if (t.origin !== r.origin) return false;
  const rootPath = r.pathname.endsWith("/") ? r.pathname : `${r.pathname}/`;
  return t.pathname === r.pathname || t.pathname.startsWith(rootPath);
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
 * Refuse missing, weak or malformed validators before sending any write.
 */
export async function putIfMatch(
  url: string,
  turtle: string,
  etag: string | null,
  fetchFn: SolidFetch,
): Promise<void> {
  requireStrongEtag(etag);
  const headers = { "content-type": "text/turtle", "if-match": etag as string };
  const res = await fetchFn(url, { method: "PUT", headers, body: turtle });
  if (res.status === 412) throw new PreconditionFailedError(url);
  if (!res.ok) throw new WriteFailedError(url, res.status);
}
