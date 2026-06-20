// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * OPTIONAL fetch-from-DAV helper — GET (or CalDAV/CardDAV REPORT) a user-configured
 * CalDAV / CardDAV endpoint and return the raw iCalendar / vCard text.
 *
 * THIS IS THE ONLY PLACE A USER-CONFIGURED REMOTE URL IS DEREFERENCED, and it is
 * MANDATORY that it go through `@jeswr/guarded-fetch` (the suite's SSRF-safe fetch):
 * https-only, no userinfo, block private / loopback / link-local / cloud-metadata
 * addresses, DNS-pin (the `./node` entry closes the lookup→connect rebinding TOCTOU),
 * cap the response body + time, and DO NOT auto-follow redirects (each hop would
 * otherwise re-leak the Authorization header to a new origin). A DAV URL is
 * attacker-influenceable (a user types it), so every one of these defences is
 * required.
 *
 * **DAV credential handling (load-bearing).** Basic / Bearer auth is a SEPARATE
 * injectable credential ({@link DavAuth}) turned into an `Authorization` header. It
 * is NEVER logged, NEVER placed in a URL, and — because the guard does NOT follow
 * redirects — never re-sent to a different origin on a redirect. {@link DavFetchError}
 * messages carry only the URL + status, never the credential.
 *
 * The returned text is the untrusted DAV body — hand it to `importCalendar` /
 * `importAddressBook` (which parse + harden every field). This helper does NOT write
 * to any pod.
 */
/** Raised when a DAV endpoint returns a non-2xx status or an over-cap body. */
export class DavFetchError extends Error {
    /** The HTTP status, when a response was received. */
    status;
    /** The requested URL (NEVER contains the credential). */
    url;
    constructor(message, url, options) {
        super(message, { cause: options?.cause });
        this.name = "DavFetchError";
        this.url = url;
        this.status = options?.status;
    }
}
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
/**
 * Resolve the default SSRF-guarded fetch lazily so the `@jeswr/guarded-fetch/node`
 * entry (which imports `undici` / `node:*`) is only loaded when actually used — a
 * caller that supplies its own `fetch`, or only ever uses the pure mappers /
 * already-fetched-text import path, never pulls in the Node networking stack.
 */
async function defaultGuardedFetch() {
    const { nodeGuardedFetch } = await import("@jeswr/guarded-fetch/node");
    return nodeGuardedFetch;
}
/**
 * Turn a {@link DavAuth} into an `Authorization` header value. Basic credentials
 * are base64-encoded per RFC 7617. Returns `undefined` for no/empty credential.
 * NEVER logged.
 */
function authHeader(davAuth) {
    if (!davAuth)
        return undefined;
    if (davAuth.type === "bearer") {
        return davAuth.token.length > 0 ? `Bearer ${davAuth.token}` : undefined;
    }
    // Basic — base64(username:password), portable encoder (no Node-only Buffer on
    // the type, though Buffer is fine in Node; use a WHATWG-safe path).
    const raw = `${davAuth.username}:${davAuth.password}`;
    const encoded = typeof btoa === "function"
        ? btoa(unescape(encodeURIComponent(raw)))
        : Buffer.from(raw, "utf8").toString("base64");
    return `Basic ${encoded}`;
}
/**
 * Fetch a CalDAV / CardDAV endpoint through the SSRF guard and return the raw
 * iCalendar / vCard text. Throws {@link DavFetchError} on a non-2xx status or an
 * over-cap body; the guard throws its own `SsrfError`/`GuardError` for a blocked
 * URL (re-thrown untouched — that is the security signal).
 *
 * The URL is validated + DNS-pinned by `@jeswr/guarded-fetch`; redirects are NOT
 * followed, so the `Authorization` header cannot leak cross-origin. The credential
 * is never logged and never placed in the URL.
 *
 * @param url - the DAV endpoint URL (must be https; attacker-influenceable).
 */
export async function fetchDav(url, options = {}) {
    const { davAuth, method = "GET", body, signal, maxBytes = DEFAULT_MAX_BYTES } = options;
    const guarded = options.fetch ?? (await defaultGuardedFetch());
    const headers = {
        accept: options.accept ?? "text/calendar, text/vcard, application/xml, text/xml",
    };
    const auth = authHeader(davAuth);
    if (auth !== undefined)
        headers.authorization = auth;
    if (method === "REPORT") {
        headers["content-type"] = "application/xml; charset=utf-8";
        // CalDAV/CardDAV REPORTs are non-recursive over the collection by default.
        headers.depth = "1";
    }
    let res;
    try {
        res = await guarded(url, {
            method,
            headers,
            ...(body !== undefined ? { body } : {}),
            signal,
        });
    }
    catch (err) {
        // Re-throw SSRF/guard refusals untouched (they are the security signal); wrap a
        // plain network error so callers get one error type to branch on. The message
        // carries only the URL — never the credential.
        if (err instanceof DavFetchError)
            throw err;
        throw new DavFetchError(`DAV fetch failed: ${url}`, url, { cause: err });
    }
    if (res.status < 200 || res.status >= 300) {
        throw new DavFetchError(`DAV endpoint returned ${res.status}`, url, { status: res.status });
    }
    const text = await res.text();
    // Count ENCODED utf-8 bytes (not utf-16 code units) so a multi-byte payload
    // cannot slip past the byte-named cap.
    if (new TextEncoder().encode(text).length > maxBytes) {
        throw new DavFetchError(`DAV payload exceeds ${maxBytes} bytes`, url, { status: res.status });
    }
    return text;
}
//# sourceMappingURL=remote.js.map