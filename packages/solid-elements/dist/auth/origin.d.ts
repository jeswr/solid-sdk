/** The loopback hosts `http:` is tolerated on (dev only, under an explicit opt-in). */
export declare const isLoopback: (host: string) => boolean;
/** How {@link computeAllowedOrigins} derives the default WebID/issuer origins. */
export interface AllowedOriginsInputs {
    /** Explicit allowed resource origins (any URL; compared by `origin`). */
    allowedOrigins?: string[];
    /** The authenticated WebID (its origin is included unless disabled). */
    webId?: string;
    /** The issuer URL (its origin is included unless disabled). */
    issuer?: string;
    /** Include the WebID's origin. Default true. */
    includeWebIdOrigin?: boolean;
    /** Include the issuer's origin. Default true. */
    includeIssuerOrigin?: boolean;
    /**
     * Allow `http:` origins for LOOPBACK hosts only (dev). Default false: every
     * non-`https:` origin is dropped, so the token is never attached over cleartext.
     */
    allowInsecureLoopback?: boolean;
}
/**
 * The set of resource origins a session token may be attached to — the credential
 * boundary the token provider enforces. PURE + exported so the boundary is
 * unit-tested. CLEARTEXT GUARD: a non-`https:` origin is DROPPED (so a configured
 * `http:` allowedOrigin can't make the DPoP token ride over cleartext), EXCEPT a
 * loopback `http:` origin when `allowInsecureLoopback` is set (dev). Fail-closed: an
 * unparseable entry is skipped; an empty result means the token is attached to NOTHING.
 */
export declare function computeAllowedOrigins(inputs: AllowedOriginsInputs): ReadonlySet<string>;
/**
 * Whether a request URL targets an allowed origin (the per-request credential
 * gate). PURE + exported. Fail-closed: an unparseable URL is never allowed.
 */
export declare function isOriginAllowed(allowed: ReadonlySet<string>, requestUrl: string): boolean;
/**
 * The DPoP `htu` claim for a request URL — the request URI WITHOUT its query and
 * fragment (RFC 9449 §4.2). PURE + exported. If the URL is unparseable it is
 * returned unchanged (the proof generator then sees the raw string).
 */
export declare function htuOf(requestUrl: string): string;
/**
 * Validate user input as a WebID: it must parse as a URL and be **`https:`** —
 * because the WebID's origin is added to the credential boundary (the session's
 * DPoP token may be attached to it), so a cleartext `http:` WebID would let the
 * token be sent over plaintext. `http:` is allowed ONLY for a loopback host
 * (`localhost`/`127.0.0.1`/`[::1]`) and ONLY when `allowInsecureLoopback` is set
 * (dev CSS over HTTP) — every other `http:` WebID is rejected.
 */
export declare function validateWebId(input: string, allowInsecureLoopback?: boolean): string;
