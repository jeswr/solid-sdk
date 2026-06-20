// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * OPTIONAL fetch-from-granary helper — GET a granary REST endpoint (e.g.
 * `granary.io`) and return its parsed `format=as2` payload.
 *
 * THIS IS THE ONLY PLACE A USER-CONFIGURED REMOTE URL IS DEREFERENCED, and it is
 * MANDATORY that it go through `@jeswr/guarded-fetch` (the suite's SSRF-safe fetch):
 * https-only, no userinfo, block private / loopback / link-local / cloud-metadata
 * addresses, DNS-pin (the `./node` entry closes the lookup→connect rebinding TOCTOU),
 * cap the response body + time, and DO NOT auto-follow redirects (each hop is
 * re-validated). A granary URL is attacker-influenceable (a user types it), so every
 * one of these defences is required.
 *
 * The returned payload is the untrusted granary JSON — hand it to `ingestGranary`
 * (which hardens every field on the map). This helper does NOT write to any pod.
 */
/** Raised when a granary endpoint returns a non-2xx status or an unparseable body. */
export class GranaryFetchError extends Error {
    /** The HTTP status, when a response was received. */
    status;
    /** The requested URL. */
    url;
    constructor(message, url, options) {
        super(message, { cause: options?.cause });
        this.name = "GranaryFetchError";
        this.url = url;
        this.status = options?.status;
    }
}
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
/**
 * Resolve the default SSRF-guarded fetch lazily so the `@jeswr/guarded-fetch/node`
 * entry (which imports `undici` / `node:*`) is only loaded when actually used — a
 * caller that supplies its own `fetch`, or only ever uses {@link ingestGranary},
 * never pulls in the Node networking stack.
 */
async function defaultGuardedFetch() {
    const { nodeGuardedFetch } = await import("@jeswr/guarded-fetch/node");
    return nodeGuardedFetch;
}
/**
 * GET a granary `format=as2` endpoint through the SSRF guard and return the parsed
 * payload (a single AS2 object or an AS2 Collection). Throws {@link
 * GranaryFetchError} on a non-2xx status, an over-cap body, or unparseable JSON; the
 * guard throws its own `SsrfError`/`GuardError` for a blocked URL.
 *
 * The URL is validated + DNS-pinned by `@jeswr/guarded-fetch`; this helper appends
 * `Accept: application/activity+json, application/ld+json, application/json` so a
 * compliant granary endpoint returns AS2 JSON. It does NOT write to a pod — pass the
 * result to {@link ingestGranary}.
 *
 * @param url - the granary endpoint URL (must be https; attacker-influenceable).
 */
export async function fetchGranary(url, options = {}) {
    const { signal, maxBytes = DEFAULT_MAX_BYTES } = options;
    const guarded = options.fetch ?? (await defaultGuardedFetch());
    let res;
    try {
        res = await guarded(url, {
            method: "GET",
            headers: {
                accept: "application/activity+json, application/ld+json, application/json",
            },
            signal,
        });
    }
    catch (err) {
        // Re-throw SSRF/guard refusals untouched (they are the security signal); wrap a
        // plain network error so callers get one error type to branch on.
        if (err instanceof GranaryFetchError)
            throw err;
        throw new GranaryFetchError(`granary fetch failed: ${url}`, url, { cause: err });
    }
    if (res.status < 200 || res.status >= 300) {
        throw new GranaryFetchError(`granary endpoint returned ${res.status}`, url, {
            status: res.status,
        });
    }
    const text = await res.text();
    if (text.length > maxBytes) {
        throw new GranaryFetchError(`granary payload exceeds ${maxBytes} bytes`, url, {
            status: res.status,
        });
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch (err) {
        throw new GranaryFetchError(`granary payload is not valid JSON: ${url}`, url, {
            status: res.status,
            cause: err,
        });
    }
    if (!parsed || typeof parsed !== "object") {
        throw new GranaryFetchError(`granary payload is not an AS2 object/collection: ${url}`, url, {
            status: res.status,
        });
    }
    return parsed;
}
//# sourceMappingURL=remote.js.map