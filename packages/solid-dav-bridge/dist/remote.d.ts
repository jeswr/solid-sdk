/**
 * OPTIONAL fetch-from-DAV helper — GET (or CalDAV/CardDAV REPORT) a user-configured
 * CalDAV / CardDAV endpoint and return the raw iCalendar / vCard text.
 *
 * THIS IS THE ONLY PLACE A USER-CONFIGURED REMOTE URL IS DEREFERENCED, and it is
 * MANDATORY that it go through `@jeswr/guarded-fetch` (the suite's SSRF-safe fetch):
 * https-only, no userinfo, block private / loopback / link-local / cloud-metadata
 * addresses, DNS-pin (the `./node` entry closes the lookup→connect rebinding TOCTOU),
 * and cap the response body + time. A DAV URL is attacker-influenceable (a user types
 * it), so every one of these defences is required.
 *
 * **Redirects (how the guard actually handles them).** `@jeswr/guarded-fetch` does
 * NOT let the underlying fetch auto-follow — it sets `redirect:"manual"` and runs its
 * OWN bounded redirect loop (≤ `maxRedirects` hops). On EACH hop it re-runs the FULL
 * host classification (so a `302` to a private / loopback / cloud-metadata address is
 * REFUSED, closing redirect-based SSRF) AND, on a CROSS-ORIGIN hop, STRIPS the
 * credential headers (`Authorization`, `Cookie`, `DPoP`) before re-issuing. So the
 * DAV `Authorization` header is forwarded only on a SAME-origin redirect and is never
 * sent to a different origin — the security outcome the older "we don't follow
 * redirects" wording was reaching for, achieved by re-validate-and-strip rather than
 * outright refusal (which would break legitimate same-origin DAV redirects).
 *
 * **DAV credential handling (load-bearing).** Basic / Bearer auth is a SEPARATE
 * injectable credential ({@link DavAuth}) turned into an `Authorization` header. It
 * is NEVER logged, NEVER placed in a URL, and — because the guard strips credential
 * headers on any cross-origin redirect hop — never re-sent to a different origin.
 * {@link DavFetchError} messages carry only the URL + status, never the credential.
 *
 * The returned text is the untrusted DAV body — hand it to `importCalendar` /
 * `importAddressBook` (which parse + harden every field). This helper does NOT write
 * to any pod.
 */
/** A DAV authentication credential, turned into an `Authorization` header. */
export type DavAuth = {
    readonly type: "basic";
    readonly username: string;
    readonly password: string;
} | {
    readonly type: "bearer";
    readonly token: string;
};
/** Options for {@link fetchDav}. */
export interface FetchDavOptions {
    /**
     * The SSRF-guarded fetch to use. Defaults to `@jeswr/guarded-fetch`'s strict
     * Node pinning fetch (`nodeGuardedFetch`) — DNS-pinned, https-only, and redirects
     * re-validated + cross-origin-credential-stripped per hop. Pass your own ONLY if it
     * is itself SSRF-safe; passing a raw `globalThis.fetch` would defeat the guard.
     */
    readonly fetch?: typeof globalThis.fetch;
    /** Optional DAV auth credential (Basic / Bearer). NEVER logged or URL-embedded. */
    readonly davAuth?: DavAuth;
    /**
     * The HTTP method. `"GET"` (the default) fetches an `.ics`/`.vcf` collection
     * export; `"REPORT"` issues a CalDAV `calendar-query` / CardDAV `addressbook-query`
     * with `body` as the XML report.
     */
    readonly method?: "GET" | "REPORT";
    /** The request body (for a `REPORT`); the `Content-Type` defaults to XML. */
    readonly body?: string;
    /** `Accept` header (defaults to text/calendar for GET; the caller can override). */
    readonly accept?: string;
    /** AbortSignal to cancel the request. */
    readonly signal?: AbortSignal;
    /**
     * Maximum payload size, bytes (decoded). Defaults 10 MiB — a second, parse-time
     * guard on the decoded text length on top of guarded-fetch's own cap.
     */
    readonly maxBytes?: number;
}
/** Raised when a DAV endpoint returns a non-2xx status or an over-cap body. */
export declare class DavFetchError extends Error {
    /** The HTTP status, when a response was received. */
    readonly status?: number;
    /** The requested URL (NEVER contains the credential). */
    readonly url: string;
    constructor(message: string, url: string, options?: {
        status?: number;
        cause?: unknown;
    });
}
/**
 * Fetch a CalDAV / CardDAV endpoint through the SSRF guard and return the raw
 * iCalendar / vCard text. Throws {@link DavFetchError} on a non-2xx status or an
 * over-cap body; the guard throws its own `SsrfError`/`GuardError` for a blocked
 * URL (re-thrown untouched — that is the security signal).
 *
 * The URL is validated + DNS-pinned by `@jeswr/guarded-fetch`; redirects are
 * re-validated per hop and credential headers stripped on any cross-origin hop, so
 * the `Authorization` header cannot leak cross-origin. The credential is never logged
 * and never placed in the URL.
 *
 * @param url - the DAV endpoint URL (must be https; attacker-influenceable).
 */
export declare function fetchDav(url: string, options?: FetchDavOptions): Promise<string>;
//# sourceMappingURL=remote.d.ts.map