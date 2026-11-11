// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import {
  assertWithinPodScope,
  classifyIpLiteral,
  DEFAULT_HOSTNAME_DENYLIST,
  isDeniedHostname,
  isWithinPodScope,
  normalizeHostForClassification,
} from "@jeswr/guarded-fetch";
import { isHttpIri } from "@jeswr/rdf-serialize";

/** Maximum inbox members visited in one listing. Listings may be incomplete at this cap. */
export const MAX_MEMBERS = 100;
/** Applies to every RDF read, including streamed bodies with no Content-Length. */
export const MAX_NOTIFICATION_BYTES = 256 * 1024;

export class RequestConflictError extends Error {
  constructor(
    readonly id: string,
    readonly current: string,
  ) {
    super(`Request ${id} changed concurrently; current status: ${current}`);
    this.name = "RequestConflictError";
  }
}

/** Validate RDF-derived HTTP URLs before any dereference or term construction. */
export function httpUrl(url: string): string {
  if (!isHttpIri(url)) throw new TypeError("Expected a safe HTTP(S) IRI");
  const parsed = new URL(url);
  if (parsed.username || parsed.password) throw new TypeError("URL credentials are forbidden");
  return url;
}

/** Names that resolve to the local machine or network; IP literals are classified separately. */
const LOCAL_NAMES: readonly string[] = Object.freeze([
  ...DEFAULT_HOSTNAME_DENYLIST,
  "localhost",
  ".localhost",
  ".local",
  ".lan",
  ".home.arpa",
  ".internal",
  ".intranet",
  ".corp",
  ".home",
]);

/**
 * A requester-supplied URL the owner's browser may contact without credentials: HTTPS only, and
 * never a loopback, private, link-local or local-name host (no requests into the owner's network).
 * This only classifies the URL; it cannot see what a public name resolves to, so server callers
 * must also pass a DNS-checking `publicFetch` (for example from `@jeswr/guarded-fetch`).
 */
export function publicHttpsUrl(url: string): string {
  const parsed = new URL(httpUrl(url));
  if (parsed.protocol !== "https:") throw new TypeError("Requester URLs must use HTTPS");
  const host = normalizeHostForClassification(parsed.hostname);
  const local =
    classifyIpLiteral(host) !== 0 ||
    !host.includes(".") ||
    host.split(".").some((label) => label.length === 0) ||
    isDeniedHostname(host, LOCAL_NAMES);
  if (local) throw new TypeError("Requester URL is not on the public web");
  return url;
}

/** A transport that can never carry the owner's credentials or follow a redirect. */
export function publicTransport(publicFetch: typeof fetch, signal?: AbortSignal): typeof fetch {
  return transport(
    (input, init) => publicFetch(input, { ...init, credentials: "omit", redirect: "error" }),
    signal,
  );
}

/**
 * Read the owner's WebID profile. Inside storage it goes through the session transport; a
 * profile hosted elsewhere is read only through the explicit unauthenticated transport, so the
 * session's credentials never leave storage. Without one, an off-storage profile is not read.
 */
export async function readProfile(
  webId: string,
  storage: string,
  sessionFetch: typeof fetch,
  publicFetch: typeof fetch | undefined,
) {
  if (isWithinPodScope(storage, httpUrl(webId))) return read(webId, sessionFetch);
  if (publicFetch === undefined) return null;
  return read(publicHttpsUrl(webId), publicFetch);
}

export function scoped(storage: string, url: string): string {
  return assertWithinPodScope(storage, httpUrl(url));
}

/** Bound bytes before the parser sees them; never follow a redirect with credentials. */
export function transport(fetchFn: typeof fetch, signal?: AbortSignal): typeof fetch {
  return async (input, init) => {
    signal?.throwIfAborted();
    const response = await fetchFn(input, {
      ...init,
      ...(signal && { signal }),
      redirect: "error",
    });
    if (response.status >= 300 && response.status < 400) throw new Error("Redirect refused");
    if (!response.ok || !response.body || init?.method === "HEAD") return response;
    const reader = response.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let length = 0;
    try {
      while (true) {
        signal?.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_NOTIFICATION_BYTES)
          throw new RangeError("RDF response exceeds byte limit");
        chunks.push(new Uint8Array(value));
      }
    } finally {
      await reader.cancel();
    }
    return new Response(new Blob(chunks), { status: response.status, headers: response.headers });
  };
}

export async function read(url: string, fetchFn: typeof fetch) {
  try {
    return await fetchRdf(httpUrl(url), { fetch: fetchFn });
  } catch (error) {
    if (error instanceof RdfFetchError && error.status === 404) return null;
    throw error;
  }
}

/** Throws unless `etag` is a strong validator, so callers can refuse before any other write. */
export function requireStrongEtag(etag: string | null): void {
  if (etag === null || !/^"[^"\r\n]*"$/.test(etag)) {
    throw new Error("A strong ETag is required for a conditional update");
  }
}

/** Existing documents always require a strong validator. 412 is returned for reconciliation. */
export async function put(
  url: string,
  body: string,
  fetchFn: typeof fetch,
  etag: string | null,
  create = false,
): Promise<boolean> {
  if (!create) requireStrongEtag(etag);
  const response = await fetchFn(url, {
    method: "PUT",
    headers: {
      "content-type": "text/turtle",
      ...(create ? { "if-none-match": "*" } : { "if-match": etag as string }),
    },
    body,
  });
  if (response.status === 412) return false;
  if (!response.ok) throw new Error(`Conditional write failed (${response.status})`);
  return true;
}
