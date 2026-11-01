// AUTHORED-BY Codex GPT-6
import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
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

export function scoped(storage: string, url: string): string {
  return assertWithinPodScope(storage, httpUrl(url));
}

/** Bound bytes before the parser sees them; never follow a redirect with credentials. */
export function transport(fetchFn: typeof fetch, signal?: AbortSignal): typeof fetch {
  return async (input, init) => {
    signal?.throwIfAborted();
    const response = await fetchFn(input, { ...init, signal, redirect: "error" });
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

/** Existing documents always require a strong validator. 412 is returned for reconciliation. */
export async function put(
  url: string,
  body: string,
  fetchFn: typeof fetch,
  etag: string | null,
  create = false,
): Promise<boolean> {
  if (!create && (etag === null || !/^"[^"\r\n]*"$/.test(etag))) {
    throw new Error("A strong ETag is required for a conditional update");
  }
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
