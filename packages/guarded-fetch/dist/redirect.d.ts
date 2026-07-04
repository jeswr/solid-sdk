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
export declare function isRedirect(status: number): boolean;
/** Whether two URLs share the same WHATWG origin (scheme + host + port). */
export declare function sameOrigin(a: string, b: string): boolean;
/** The protocol of a URL string, or "" if unparseable. */
export declare function safeProtocol(u: string): string;
/**
 * Redact any embedded userinfo (`scheme://user:pass@host…` or a scheme-relative
 * `//user:pass@host…`) from a URL-ish string BEFORE it is interpolated into an error message.
 * Both guards + the redirect-refusal wrapper echo user-/server-controlled URL values into
 * error messages that consumers surface into logs / item output — so a target or `Location`
 * like `https://u:p@host/x` must never leak its credentials through an error.
 *
 * This is a deliberately BROAD, best-effort textual scrub that also works on MALFORMED input
 * (where `new URL` threw, so the parser cannot be trusted — a value like `ht!tp://u:p@host/`
 * has no RFC-valid scheme yet still carries a secret). It replaces EVERY `//…@` authority-
 * userinfo span (global, scheme-prefix-agnostic) with `//<redacted>@`. The span is `[^/?#]*`
 * (NOT excluding whitespace or `@`): a malformed target like `https://alice:s3 cr3t@ho st/x`
 * would otherwise slip the scrub and leak the credential. Over-redaction is safe here (these
 * are error strings, not requests); under-redaction would leak — so the rule errs toward
 * redacting.
 */
export declare function redactUserinfo(value: string): string;
/**
 * Credential-bearing request headers that must NOT be forwarded across a CROSS-ORIGIN
 * redirect (the standard browser rule). Lower-cased for case-insensitive match.
 */
export declare const CREDENTIAL_HEADERS: ReadonlySet<string>;
/** Body-shaping `Content-*` headers dropped whenever a redirect strips the request body. */
export declare const CONTENT_HEADERS: ReadonlySet<string>;
/**
 * Rewrite the per-hop `init` for the NEXT redirect hop, applying the WHATWG Fetch spec's
 * "HTTP-redirect fetch" method-rewrite rule exactly (step 11): the method switches to `GET`
 * and the body is dropped ONLY when
 *   - the status is 301 or 302 AND the method is `POST`, OR
 *   - the status is 303 AND the method is neither `GET` nor `HEAD`.
 * So a `HEAD` under a 303 stays `HEAD`, and a `PUT`/`PATCH`/`DELETE` under a 301/302 keeps its
 * method (and, on a same-origin hop, its body) — a redirect must NOT silently downgrade a
 * mutating verb to a `GET`. A cross-origin redirect additionally strips credential headers AND
 * the body (even a 307/308). Returns a fresh init (the caller's object is never mutated).
 */
export declare function rewriteInitForRedirect(init: RequestInit, status: number, crossOrigin: boolean): RequestInit;
/** Normalise the `(input, init)` a `fetch`-shaped call receives into a `{ url, init }` pair. */
export declare function normalizeRequest(input: RequestInfo | URL, init: RequestInit | undefined): {
    url: string;
    init: RequestInit | undefined;
};
//# sourceMappingURL=redirect.d.ts.map