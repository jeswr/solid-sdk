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
import type { GranaryAs2 } from "./granary.js";
/** Options for {@link fetchGranary}. */
export interface FetchGranaryOptions {
    /**
     * The SSRF-guarded fetch to use. Defaults to `@jeswr/guarded-fetch`'s strict
     * Node pinning fetch (`nodeGuardedFetch`) — DNS-pinned, https-only, redirect
     * re-validated. Pass your own ONLY if it is itself SSRF-safe; passing a raw
     * `globalThis.fetch` would defeat the guard.
     */
    readonly fetch?: typeof globalThis.fetch;
    /** AbortSignal to cancel the request. */
    readonly signal?: AbortSignal;
    /**
     * Maximum payload size, bytes. Defaults to guarded-fetch's own cap; this is a
     * second, parse-time guard on the decoded JSON length. Default 5 MiB.
     */
    readonly maxBytes?: number;
}
/** Raised when a granary endpoint returns a non-2xx status or an unparseable body. */
export declare class GranaryFetchError extends Error {
    /** The HTTP status, when a response was received. */
    readonly status?: number;
    /** The requested URL. */
    readonly url: string;
    constructor(message: string, url: string, options?: {
        status?: number;
        cause?: unknown;
    });
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
export declare function fetchGranary(url: string, options?: FetchGranaryOptions): Promise<GranaryAs2>;
//# sourceMappingURL=remote.d.ts.map