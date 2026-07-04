// AUTHORED-BY Claude Fable 5
/**
 * Shared MANUAL-REDIRECT machinery, extracted from `./guard.ts` so both guarded fetches —
 * the SSRF guard ({@link ../guard.js}) and the pod-scope guard ({@link ../podScope.js}) —
 * follow redirects with the SAME reviewed Fetch-spec semantics instead of two divergent
 * copies (the exact duplication this package exists to consolidate).
 *
 * Everything here is policy-free: which redirect targets are ALLOWED is each guard's job;
 * this module only answers "is this status a redirect?", "same origin?", and "what does the
 * next hop's init look like under standard Fetch redirect semantics?" (method-changing
 * redirects switch to GET and drop the body + Content-* headers; a cross-origin redirect
 * additionally strips credential headers and the body).
 */

/** Whether a status code is a redirect we re-validate + follow manually. */
export function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/** Whether two URLs share the same WHATWG origin (scheme + host + port). */
export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false; // an unparseable URL is never same-origin (fail safe → strip headers)
  }
}

/** The protocol of a URL string, or "" if unparseable. */
export function safeProtocol(u: string): string {
  try {
    return new URL(u).protocol;
  } catch {
    return "";
  }
}

/**
 * Credential-bearing request headers that must NOT be forwarded across a CROSS-ORIGIN
 * redirect (the standard browser rule). Lower-cased for case-insensitive match.
 */
export const CREDENTIAL_HEADERS: ReadonlySet<string> = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "www-authenticate",
  "dpop",
]);

/** Body-shaping `Content-*` headers dropped whenever a redirect strips the request body. */
export const CONTENT_HEADERS: ReadonlySet<string> = new Set([
  "content-length",
  "content-type",
  "content-encoding",
  "content-language",
  "content-location",
]);

/**
 * Rewrite the per-hop `init` for the NEXT redirect hop, applying standard Fetch redirect
 * semantics: a method-changing redirect (303 always; 301/302 on a non-GET/HEAD) switches to
 * GET and drops the body + body-shaping Content-* headers; a cross-origin redirect
 * additionally strips credential headers AND the body (even a 307/308). Returns a fresh init
 * (the caller's object is never mutated).
 */
export function rewriteInitForRedirect(
  init: RequestInit,
  status: number,
  crossOrigin: boolean,
): RequestInit {
  const method = (init.method ?? "GET").toUpperCase();
  const methodChanges =
    status === 303 || ((status === 301 || status === 302) && method !== "GET" && method !== "HEAD");
  const dropBody = methodChanges || crossOrigin;

  const headers = new Headers(init.headers ?? {});
  if (crossOrigin) {
    for (const name of CREDENTIAL_HEADERS) {
      headers.delete(name);
    }
  }
  if (dropBody) {
    for (const name of CONTENT_HEADERS) {
      headers.delete(name);
    }
  }
  const kept: Record<string, string> = {};
  headers.forEach((value, key) => {
    kept[key] = value;
  });

  const {
    body: _body,
    duplex: _duplex,
    method: _method,
    ...rest
  } = init as RequestInit & { duplex?: string };
  const next: RequestInit = { ...rest, headers: kept };
  if (methodChanges) {
    next.method = "GET";
  } else if (init.method !== undefined) {
    next.method = init.method;
    if (!dropBody && init.body !== undefined) {
      next.body = init.body;
      const duplex = (init as { duplex?: string }).duplex;
      if (duplex !== undefined) {
        (next as { duplex?: string }).duplex = duplex;
      }
    }
  }
  return next;
}

/** Normalise the `(input, init)` a `fetch`-shaped call receives into a `{ url, init }` pair. */
export function normalizeRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): { url: string; init: RequestInit | undefined } {
  if (typeof input === "string") {
    return { url: input, init };
  }
  if (input instanceof URL) {
    return { url: input.toString(), init };
  }
  const req = input as Request;
  const fromRequest: RequestInit = {
    method: req.method,
    headers: req.headers,
    credentials: req.credentials,
    redirect: req.redirect,
    ...(req.signal ? { signal: req.signal } : {}),
    ...(req.body ? { body: req.body, duplex: "half" } : {}),
  } as RequestInit;
  return { url: req.url, init: { ...fromRequest, ...(init ?? {}) } };
}
