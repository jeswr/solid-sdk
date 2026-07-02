import { jwtVerify } from "jose";
/**
 * A header collection accepted by {@link RequestLike}: a web `Headers`, an iterable of
 * `[name, value]` pairs, or a plain record (array values become repeated headers; `undefined`
 * values are skipped). A web `Request`'s `headers` (a `Headers`) satisfies this directly.
 */
export type HeadersInput = Headers | Iterable<readonly [string, string]> | Record<string, string | readonly string[] | undefined>;
/**
 * The minimal request shape the verifier needs — deliberately framework-free. A web `Request`
 * (or Next's `NextRequest`) is assignable to this, and so is any framework's
 * `{ headers, method, url }`. `url` MUST be the absolute request URL (so `htu` reconstruction
 * and the same-origin check work); reverse-proxy deployments are handled via `X-Forwarded-*`.
 */
export interface RequestLike {
    readonly headers: HeadersInput;
    readonly method: string;
    readonly url: string;
}
/** The verified caller identity produced on success. */
export interface ApiCredentials {
    /** The authenticated WebID (the `webid` claim — an `https:` URL). */
    readonly webId: string;
    /** The token's issuer (a trusted issuer). */
    readonly issuer: string;
    /** The token's `client_id`, when present. */
    readonly clientId?: string;
}
/**
 * A request-verification failure carrying the HTTP status + `WWW-Authenticate` challenge the
 * client should act on. The `message` is safe to surface (it never leaks token internals).
 * 401 = authenticate; 403 = authenticated-but-not-owner; 429 = rate-limited; 503 = server not
 * configured / cannot decide (fail-closed).
 */
export declare class ApiAuthError extends Error {
    readonly statusCode: number;
    /** The `WWW-Authenticate` header value, or undefined (403/429/503 need no challenge). */
    readonly wwwAuthenticate?: string;
    constructor(message: string, statusCode?: number, wwwAuthenticate?: string);
}
/**
 * A DPoP-proof replay store: every accepted proof's `jti` is marked seen for a bounded window
 * (the proof's freshness lifetime). A subsequent mark of the same `jti` within that window is a
 * replay.
 */
export interface ReplayStore {
    /**
     * Atomically record `jti` as seen with a per-entry `ttlSeconds`.
     * @returns `"new"` the first time within the window; `"replay"` if already seen.
     */
    mark(jti: string, ttlSeconds: number): Promise<"new" | "replay">;
}
/**
 * In-process {@link ReplayStore} backed by a `Map` with per-entry TTL + lazy pruning.
 * Sufficient for a SINGLE app instance.
 *
 * ⚠️ HORIZONTAL-SCALING CAVEAT: this is process-local, so a captured proof could be replayed
 * against a DIFFERENT instance behind a load balancer. For a multi-instance deployment, inject
 * a SHARED store (Redis `SET jti 1 EX ttl NX`) via {@link DpopApiVerifierOptions.replayStore}.
 * The interface is deliberately abstracted so that swap is a config change, not a code change.
 */
export declare class InProcessReplayStore implements ReplayStore {
    private readonly seen;
    private readonly now;
    private readonly maxEntries;
    constructor(options?: {
        now?: () => number;
        maxEntries?: number;
    });
    mark(jti: string, ttlSeconds: number): Promise<"new" | "replay">;
    /** Drop expired entries (lazy — bounded work: only when the map has grown). */
    private prune;
}
/**
 * A rate limiter behind an injectable seam: consume one token for a key, returning whether it
 * was allowed. Implemented in-process by {@link TokenBucketRateLimiter}; swap for a shared
 * (Redis) implementation in a multi-instance deployment.
 */
export interface RateLimiter {
    /** Attempt to consume one token for `key`; `true` = allowed, `false` = rate-limited (429). */
    tryRemove(key: string): boolean;
}
/**
 * A per-key token-bucket {@link RateLimiter} (in-process). Owner-only auth SHRINKS the abuse
 * surface of a write route but does not eliminate it — a compromised owner token could
 * otherwise spawn unbounded work. This caps the burst + sustained rate.
 *
 * ⚠️ HORIZONTAL-SCALING CAVEAT (same as {@link InProcessReplayStore}): the buckets are
 * process-local, so the effective cluster-wide limit is `capacity × instances`. For a strict
 * global limit across a multi-instance deployment, back this with a shared store (Redis token
 * bucket / `INCR`+`EXPIRE`). Single-instance is exact.
 */
export declare class TokenBucketRateLimiter implements RateLimiter {
    private readonly buckets;
    private readonly capacity;
    private readonly refillPerSec;
    private readonly now;
    private readonly maxKeys;
    /**
     * @param options.capacity     max burst (and the count restored per full window).
     * @param options.refillPerSec tokens restored per second (e.g. `capacity / 60` = `capacity`/min).
     */
    constructor(options: {
        capacity: number;
        refillPerSec: number;
        now?: () => number;
        maxKeys?: number;
    });
    /**
     * Attempt to consume one token for `key`. Returns `true` when allowed (a token was
     * available), `false` when the bucket is empty (rate-limited → the caller returns 429).
     */
    tryRemove(key: string): boolean;
}
/** The verification key set for an issuer, plus dev-only HTTP relaxation. */
export interface IssuerKeys {
    /** The `jose` key resolver (`createRemoteJWKSet` in prod; `createLocalJWKSet` in tests). */
    readonly jwks: Parameters<typeof jwtVerify>[1];
    /** Allow OIDC discovery / JWKS over plain HTTP — loopback dev IdP only. */
    readonly allowInsecureRequests?: boolean;
}
/** Resolve an issuer to its verification keys. Overridable in tests (inline JWKS). */
export type ResolveIssuer = (issuer: string) => Promise<IssuerKeys> | IssuerKeys;
/** The bidirectional WebID↔issuer check posture. */
export type BidirectionalMode = "strict" | "warn" | "off";
/** Minimal logger surface (a subset of `console`); defaults to no-op. */
export interface AuthLogger {
    warn: (obj: object | string, msg?: string) => void;
    info?: (obj: object | string, msg?: string) => void;
}
/** Configuration for {@link DpopApiVerifier}. */
export interface DpopApiVerifierOptions {
    /** Issuers trusted to mint access tokens. An `iss` outside this set is rejected. */
    readonly trustedIssuers: readonly string[];
    /**
     * The single WebID authorized to write. `undefined`/empty = FAIL-CLOSED: every authenticated
     * write is refused with 503 (never open).
     */
    readonly ownerWebId?: string;
    /** The claim name carrying the WebID. Default `"webid"`. */
    readonly webidClaim?: string;
    /** Clock skew (seconds) tolerated on temporal claims. Default 5. */
    readonly clockToleranceSec?: number;
    /**
     * Bidirectional WebID↔issuer check mode. Default `"strict"`, auto-downgraded to `"warn"` when
     * EVERY trusted issuer is a loopback-HTTP dev IdP (so the local dev/CI loop is not broken).
     * `"off"` skips it entirely.
     */
    readonly bidirectionalMode?: BidirectionalMode;
    /** Allow loopback-HTTP issuers + WebID hosts (dev/CI only). Default false. */
    readonly allowInsecureLoopback?: boolean;
    /** Issuer→keys resolver. Default: OIDC discovery + remote JWKS (issuer-agnostic). */
    readonly resolveIssuer?: ResolveIssuer;
    /** Replay store. Default: a fresh {@link InProcessReplayStore}. */
    readonly replayStore?: ReplayStore;
    /**
     * SSRF-guarded fetch for the WebID profile (the bidirectional check). Default: a DNS-pinning
     * `@jeswr/guarded-fetch/node` fetch (loaded lazily). Test seam.
     */
    readonly webidFetch?: typeof fetch;
    /** Injected clock (`Date.now`) for deterministic tests. */
    readonly now?: () => number;
    /** Logger for soft (`warn`) bidirectional mismatches + replay detections. */
    readonly log?: AuthLogger;
}
/** Whether an issuer URL is a loopback-HTTP endpoint (the dev/CI IdP). */
export declare function isLoopbackHttp(issuer: string): boolean;
/**
 * DPoP-bound access-token verifier + owner authorizer for an app's own `/api/**` routes.
 * Issuer-agnostic; framework-agnostic. See the module header for the full pipeline. Construct
 * once (per process) and reuse — the issuer discovery + JWKS fetch are cached, and the
 * in-process replay store is shared across requests.
 */
export declare class DpopApiVerifier {
    private readonly trustedIssuers;
    private readonly ownerWebId;
    private readonly webidClaim;
    private readonly clockToleranceSec;
    private readonly bidirectionalMode;
    private readonly allowInsecureLoopback;
    private readonly resolveIssuer;
    private readonly replayStore;
    private readonly injectedWebidFetch;
    private readonly now;
    private readonly log;
    /** Cached per-issuer keys (the promise, so concurrent first-requests share discovery). */
    private readonly issuerKeys;
    /** Lazily-built guarded fetch (undici DNS-pinning) — created on first bidirectional check. */
    private lazyWebidFetch;
    constructor(options: DpopApiVerifierOptions);
    /**
     * Verify the request's DPoP-bound token WITHOUT the owner check — returns the caller's
     * verified {@link ApiCredentials}. Throws {@link ApiAuthError} on any failure. Use
     * {@link authorizeOwner} for the full write gate. Accepts any {@link RequestLike} (a web
     * `Request` included).
     */
    authenticate(request: RequestLike): Promise<ApiCredentials>;
    /**
     * The full write gate: {@link authenticate} + `webid === ownerWebId`. FAIL-CLOSED when
     * `ownerWebId` is unset (503). Wrong WebID → 403.
     */
    authorizeOwner(request: RequestLike): Promise<ApiCredentials>;
    /**
     * Verify the access-token JWS with `jose`: asymmetric alg, `typ=at+jwt`, trusted `iss`,
     * temporal within tolerance. The `aud` is intentionally NOT checked (see the module header —
     * the token's audience is the pod, and the DPoP proof re-binds it to this request). Requires a
     * `sub` as basic sanity.
     */
    private verifyAccessToken;
    /**
     * Verify the DPoP proof (RFC 9449) with `jose`, returning its `jti`. Mirrors the pod
     * resource-server checks: `typ=dpop+jwt`, an asymmetric alg, an embedded PUBLIC JWK verifying
     * the proof signature, `htm`==method, `htu`==reconstructed URL, `iat` fresh, `ath`==access-
     * token hash, and `jkt(jwk)==cnf.jkt`. `jti` presence is asserted here; the caller consumes it
     * against the replay store.
     */
    private verifyDpopProof;
    /** Consume the proof's `jti` against the replay store (a repeat within the window = replay). */
    private checkReplay;
    /** The `webid` claim — must be present and an `https:` URL without userinfo. */
    private extractWebId;
    /**
     * Bidirectional WebID↔issuer check: dereference the WebID profile (SSRF-guarded) and confirm
     * it lists `issuer` via `solid:oidcIssuer`. `strict` → any mismatch or fetch failure is a 401;
     * `warn` → log + accept; `off` → skip. The client-facing message is constant so this cannot be
     * used as a network-reconnaissance oracle.
     */
    private checkBidirectionalIssuer;
    /**
     * Fetch the WebID profile through the SSRF-guarded fetch and extract its `solid:oidcIssuer`
     * object set. The WebID is user-influenced, so this NEVER uses a bare `fetch` — it uses
     * `@jeswr/guarded-fetch/node` (DNS-pinned; closes the rebinding TOCTOU) via `@jeswr/fetch-rdf`.
     */
    private fetchWebIdIssuers;
    /** The SSRF-guarded fetch for WebID profiles (injected in tests; built lazily otherwise). */
    private webidFetch;
    /** Get (or cache) an issuer's verification keys; a rejected discovery is evicted so it can retry. */
    private keysFor;
    /**
     * The default issuer resolver: OIDC discovery (`${issuer}/.well-known/openid-configuration`,
     * issuer cross-checked) via `oauth4webapi`, then a cached remote JWKS over the discovered
     * `jwks_uri`. The issuer is operator-configured (a trusted-list entry), NOT user-influenced,
     * so discovery does not need the SSRF guard (unlike the WebID fetch, which does).
     */
    private discoverIssuer;
    /** Build an {@link ApiAuthError} (401) with an RFC 6750 / 9449-style `WWW-Authenticate`. */
    private challenge;
}
/** Options for {@link verifyRequest}. */
export interface VerifyRequestOptions {
    /**
     * The verifier to use. Build it ONCE (per process) and reuse — issuer discovery + JWKS are
     * cached on it, and the in-process replay store is shared across requests. Building a fresh
     * verifier per request would defeat both.
     */
    readonly verifier: DpopApiVerifier;
    /**
     * Require `webid === ownerWebId` (the full write gate). Default `true`. Set `false` to only
     * authenticate (any verified WebID is accepted) — e.g. a read route that just needs identity.
     */
    readonly requireOwner?: boolean;
    /**
     * Also enforce the same-origin CSRF check (see {@link assertSameOrigin}) BEFORE verifying.
     * Default `false` (the DPoP `htu` binding is the primary control; enable for browser routes).
     */
    readonly assertSameOrigin?: boolean;
    /**
     * Optional rate limiter. When set, ONE token is consumed AFTER successful verification, keyed
     * by {@link rateLimitKey} (default the verified WebID); an empty bucket → 429. Placing it after
     * auth means the key is a verified identity, not an attacker-chosen value.
     */
    readonly rateLimiter?: RateLimiter;
    /** The rate-limit key from the verified credentials. Default `(c) => c.webId`. */
    readonly rateLimitKey?: (credentials: ApiCredentials) => string;
}
/**
 * Framework-free verification entry: verify a request expressed as `(headers, method, url)`
 * against a pre-built {@link DpopApiVerifier}. Returns the verified {@link ApiCredentials};
 * throws {@link ApiAuthError} on any failure (401/403/429/503). A web `Request`'s
 * `(request.headers, request.method, request.url)` maps straight in; see the `./next` subexport
 * for a Next.js route-handler helper.
 */
export declare function verifyRequest(headers: HeadersInput, method: string, url: string, opts: VerifyRequestOptions): Promise<ApiCredentials>;
/** Parse an `Authorization` header into `{ scheme (lower-case), token }`, or undefined. */
export declare function parseAuthorization(header: string | undefined): {
    scheme: string;
    token: string;
} | undefined;
/**
 * Reconstruct the exact request URL the client signed into the DPoP proof's `htu`: scheme +
 * host + (non-default) port + path, query/fragment stripped. PROXY-AWARE — honours
 * `X-Forwarded-Proto` / `X-Forwarded-Host` (a TLS-terminating proxy / Vercel fronts the Node
 * process), falling back to the `Host` header and the raw request URL. This must match what the
 * browser signed (its absolute request URL). Accepts any {@link RequestLike}.
 */
export declare function reconstructRequestUrl(request: RequestLike): string;
/**
 * Same-origin CSRF check (defence-in-depth alongside the DPoP `htu` binding). Rejects a request
 * whose `Origin` (or, as a fallback, `Referer`) is present but does NOT match the request's own
 * origin (the reconstructed, proxy-aware origin). A same-origin request or a request with
 * neither header is allowed (non-browser clients, and the DPoP proof is the primary control). A
 * forged cross-site browser POST carries the attacker origin and is refused here. Throws
 * {@link ApiAuthError} (403) on mismatch. Accepts any {@link RequestLike}.
 */
export declare function assertSameOrigin(request: RequestLike): void;
/**
 * Parse a trusted-issuer list (comma/space/newline-separated) into a trimmed array. Exported
 * for the fan-out apps + tests.
 */
export declare function parseTrustedIssuers(raw: string | undefined): string[];
/**
 * Build {@link DpopApiVerifierOptions} from environment variables (the shared convention across
 * the five products, preserved verbatim from the AccessRadar reference):
 *  - `PSS_TRUSTED_ISSUERS`              — required; the trusted-issuer allowlist.
 *  - `OWNER_WEBID`                      — the single authorized writer (fail-closed if unset).
 *  - `PSS_WEBID_CLAIM`                  — the WebID claim name (default `webid`).
 *  - `PSS_BIDIRECTIONAL_WEBID_MODE`     — `strict` | `warn` | `off`.
 *  - `PSS_AUTH_ALLOW_INSECURE_LOOPBACK` — `1`/`true` to allow loopback-HTTP (dev/CI).
 *  - `PSS_CLOCK_TOLERANCE_SEC`          — clock skew seconds (default 5).
 */
export declare function optionsFromEnv(env?: NodeJS.ProcessEnv): DpopApiVerifierOptions;
/**
 * A process-wide verifier built from the environment via {@link optionsFromEnv}. Constructed
 * once and reused so issuer discovery + JWKS + the replay store persist across requests. Throws
 * if the trusted-issuer list is empty — a misconfigured server must not silently accept nothing
 * (or, worse, everything); it should fail loudly at first use.
 */
export declare function getVerifier(): DpopApiVerifier;
/** Test-only: drop the cached singleton so the next {@link getVerifier} rereads the env. */
export declare function __resetVerifierForTests(): void;
/**
 * A process-wide rate limiter, built from `PSS_SCAN_RATE_PER_MIN` (per-minute capacity + refill;
 * default {@link DEFAULT_SCAN_RATE_PER_MIN}). Key it by WebID at the call site so a single
 * compromised owner token is capped rather than able to spawn unbounded work. Single-instance
 * (see {@link TokenBucketRateLimiter}).
 */
export declare function getScanRateLimiter(): TokenBucketRateLimiter;
/** Test-only: drop the cached rate limiter so the next {@link getScanRateLimiter} rereads the env. */
export declare function __resetRateLimiterForTests(): void;
//# sourceMappingURL=core.d.ts.map