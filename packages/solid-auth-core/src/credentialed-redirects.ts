// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { requestHref } from "./request.js";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BODY_HEADERS = [
  "Content-Encoding",
  "Content-Language",
  "Content-Length",
  "Content-Location",
  "Content-Type",
];
const CREDENTIAL_HEADERS = ["Authorization", "DPoP", "Proxy-Authorization"];
const ORIGIN_HEADERS = [...CREDENTIAL_HEADERS, "Cookie", "Cookie2"];

export function hasCredentialHeaders(request: Request): boolean {
  return CREDENTIAL_HEADERS.some((header) => request.headers.has(header));
}

/** Caller-owned credentials cannot be re-scoped or replayed on a redirect. */
export function fetchPassthrough(base: typeof fetch, request: Request): Promise<Response> {
  return base(
    hasCredentialHeaders(request) && request.redirect !== "manual"
      ? new Request(request, { redirect: "manual" })
      : request,
  );
}

export interface CredentialedHopResult {
  response: Response;
  followRedirects: boolean;
}

/** Keep the native Response (and its body/brand), including through clone(). */
function withRedirectMetadata(response: Response, url: string): Response {
  const clone = response.clone.bind(response);
  Object.defineProperties(response, {
    redirected: { configurable: true, get: () => true },
    url: { configurable: true, get: () => url },
    clone: {
      configurable: true,
      value: (): Response => withRedirectMetadata(clone(), url),
    },
  });
  return response;
}

/** Buffer replayable bodies without making cancellation wait for their source. */
async function bufferBody(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  signal.throwIfAborted();
  const reader = body.getReader();
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(signal.reason);
      void reader.cancel(signal.reason).catch(() => {});
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
    signal.throwIfAborted();
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes.buffer;
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

/**
 * Follow visible redirects only after the same live credential gate accepts each hop.
 * `send` upgrades afresh and performs the bounded 401 retry for that hop.
 * This is internal; full-page OAuth login redirects live separately in redirect.ts.
 */
export async function fetchWithCredentialedRedirects(
  request: Request,
  init: RequestInit | undefined,
  matches: (request: Request) => boolean | Promise<boolean>,
  send: (request: Request) => Promise<CredentialedHopResult>,
): Promise<Response> {
  // A Request exposes only a stream, with no portable way to recover its source.
  // Buffer only a caller-supplied non-stream BodyInit, never an arbitrary stream.
  const source = init?.body;
  let replayable =
    request.body === null ||
    (source != null && !(typeof source === "object" && "getReader" in source));
  // Keep sources and fallback clones on the caller's policy. Only the credential
  // attachment/send boundary derives manual requests, including on later hops.
  let current = request;
  let body: ArrayBuffer | null = null;
  if (current.body !== null && replayable) {
    body = await bufferBody(current.body, current.signal);
    current = new Request(current, { body });
  }

  for (let hops = 0; ; hops++) {
    const { response, followRedirects } = await send(current);
    const href = requestHref(current);
    if (hops > 0 && href !== undefined && response.type !== "opaqueredirect") {
      // A credential-free fallback may have followed further native redirects.
      const url = new URL(response.url || href);
      url.hash = "";
      withRedirectMetadata(response, url.href);
    }
    if (
      !followRedirects ||
      response.type === "opaqueredirect" ||
      !REDIRECT_STATUSES.has(response.status)
    ) {
      return response;
    }
    const location = response.headers.get("Location");
    if (location === null) return response;
    if (href === undefined) return response;
    const rewrite =
      (response.status === 303 && current.method !== "GET" && current.method !== "HEAD") ||
      ((response.status === 301 || response.status === 302) && current.method === "POST");
    // Fetch cannot replay a streaming body. A rewrite discards it, so it is safe.
    if (!rewrite && !replayable) return response;
    let next: Request;
    try {
      const destination = new URL(location, href);
      if (
        (destination.protocol !== "https:" && destination.protocol !== "http:") ||
        destination.username ||
        destination.password
      ) {
        return response;
      }
      const headers = new Headers(current.headers);
      if (destination.origin !== new URL(href).origin) {
        for (const header of ORIGIN_HEADERS) headers.delete(header);
      }
      if (rewrite) {
        for (const header of BODY_HEADERS) headers.delete(header);
      }
      next = new Request(destination, {
        method: rewrite ? "GET" : current.method,
        headers,
        body: rewrite ? null : body,
        redirect: current.redirect,
        cache: current.cache,
        credentials: current.credentials,
        integrity: current.integrity,
        keepalive: current.keepalive,
        mode: current.mode,
        referrer: current.referrer,
        referrerPolicy: current.referrerPolicy,
        signal: current.signal,
      });
    } catch {
      // Invalid/unrequestable Locations leave the original response readable.
      return response;
    }
    // Never send even an uncredentialed follow-up outside the live allowlist.
    if (!(await matches(next))) return response;
    if (hops === 20) {
      void response.body?.cancel().catch(() => {});
      throw new TypeError("fetch failed: redirect count exceeded");
    }
    // Release a followed response, but leave every returned redirect untouched.
    void response.body?.cancel().catch(() => {});
    if (rewrite) {
      body = null;
      replayable = true;
    }
    current = next;
  }
}
