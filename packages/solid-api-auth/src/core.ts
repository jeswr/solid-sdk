// AUTHORED-BY Claude Opus 4.8
/**
 * core.ts — server-side DPoP-bound access-token verification + owner authorization for an
 * app's own `/api/**` write routes. Framework-free.
 *
 * Extracted verbatim-in-behaviour from the AccessRadar reference
 * (`accessradar/src/lib/solid/api-auth.ts`, bead xh5.11) so the five revenue products
 * (AccessRadar + Keystone/CapNote/Provena/Furlong) consume one audited package instead of
 * five copies. The ONE deliberate divergence from the reference: the request surface is a
 * framework-free {@link RequestLike} (`{ headers, method, url }`) instead of a hard-wired web
 * `Request`, and the top-level {@link verifyRequest} takes `(headers, method, url, opts)` — a
 * web `Request` still satisfies {@link RequestLike}, so existing call sites are unaffected.
 *
 * ── What this is ──────────────────────────────────────────────────────────────
 * The app's client mints DPoP-bound access tokens for pod requests. When it calls its OWN
 * backend the same DPoP-bound token + a fresh proof are attached. This module verifies that
 * token EXACTLY as a Solid pod resource server does — mirroring `prod-solid-server/src/auth`
 * semantics — then authorizes a single WebID (the owner).
 *
 * ── The verification pipeline (issuer-agnostic; no hard-pinned `aud`) ─────────
 *  1. Parse `Authorization` — MUST be `DPoP <token>` (a bare `Bearer` is refused:
 *     this is a proof-of-possession model, never a bearer one).
 *  2. Peek the UNVERIFIED `iss`; refuse it unless it is in the trusted-issuer allowlist
 *     BEFORE any discovery — so an untrusted issuer never causes us to dereference its
 *     discovery document.
 *  3. Verify the access-token JWS with `jose` against the issuer's JWKS (discovered
 *     issuer-agnostically). Asymmetric algorithms only (`HS*`/`none` excluded — they would let
 *     a token be forged from a public value). `typ`, `iss`, and the temporal claims
 *     (`exp`/`nbf`, bounded clock skew) are checked. The `aud` is DELIBERATELY NOT pinned: the
 *     token's audience is the user's POD, and the DPoP proof (step 4) re-binds it to THIS exact
 *     request, so a token captured by a malicious pod cannot be replayed here without the
 *     holder's private key.
 *  4. Verify the DPoP proof (RFC 9449): `typ=dpop+jwt`, an asymmetric `alg`, an embedded PUBLIC
 *     JWK that verifies the proof's own signature, `htm` == the request method, `htu` == the
 *     exact reconstructed request URL (query/frag stripped, proxy-aware), `iat` fresh (bounded
 *     age + skew), `jti` unique (in-process replay cache — single-instance; see the
 *     horizontal-scaling caveat on {@link InProcessReplayStore}), `ath` == the access-token
 *     hash, and `cnf.jkt` (in the access token) == the base64url SHA-256 thumbprint of the
 *     proof's JWK (the proof-of-possession binding).
 *  5. Extract the `webid` claim (configurable name) — must be an `https:` URL.
 *  6. SSRF-guarded bidirectional WebID↔issuer check (defence-in-depth): fetch the WebID profile
 *     through `@jeswr/guarded-fetch` (DNS-pinned; the WebID is user-influenced, so NEVER a bare
 *     fetch) and confirm it lists the token's issuer via `solid:oidcIssuer`.
 *  7. Authorize: `webid === ownerWebId`. FAIL-CLOSED when `ownerWebId` is unset (503 — refuse
 *     ALL writes; never open).
 *
 * Any failure throws {@link ApiAuthError} carrying the HTTP status + the `WWW-Authenticate`
 * challenge. No token → 401 + `WWW-Authenticate: DPoP`; a valid token for the wrong WebID → 403.
 *
 * ── SERVER-ONLY ───────────────────────────────────────────────────────────────
 * Imports `node:crypto` + (lazily) `@jeswr/guarded-fetch/node` (undici) + (lazily)
 * `@jeswr/fetch-rdf`. MUST be imported only from route handlers / server code, never a client
 * component.
 */
import { createHash } from "node:crypto";
import {
  calculateJwkThumbprint,
  createRemoteJWKSet,
  EmbeddedJWK,
  type JWK,
  type JWTPayload,
  jwtVerify,
} from "jose";
import * as oauth from "oauth4webapi";

/** `solid:oidcIssuer` — the WebID-profile predicate the bidirectional check reads. */
const SOLID_OIDC_ISSUER = "http://www.w3.org/ns/solid/terms#oidcIssuer";

/**
 * Asymmetric signature algorithms accepted for BOTH the access token and the DPoP proof.
 * Symmetric (`HS*`) and `none` are excluded: the access token is signed by the IdP's private
 * key and the proof by the holder's private key, so only asymmetric algorithms are meaningful
 * (RFC 9068 / RFC 9449 §4.2).
 */
const SIGNING_ALGS = [
  "ES256",
  "ES384",
  "ES512",
  "PS256",
  "PS384",
  "PS512",
  "RS256",
  "RS384",
  "RS512",
];

/** Advertised in the `WWW-Authenticate` `algs` parameter (RFC 9449 §5.1). */
const DPOP_ALGS = SIGNING_ALGS;

/** RFC 9068 access-token media type — the `typ` header of a Solid-OIDC access token. */
const ACCESS_TOKEN_TYP = "at+jwt";

/** RFC 9449 DPoP-proof media type. */
const DPOP_PROOF_TYP = "dpop+jwt";

/**
 * DPoP-proof `iat` freshness window (seconds). A proof older/newer than this (± clock
 * tolerance) is rejected. The replay cache remembers a `jti` for at least this long so a
 * captured proof cannot be replayed after the cache forgets it but before the `iat` check would
 * reject it.
 */
const DPOP_PROOF_MAX_AGE_SEC = 300;

/** Default clock skew (seconds) tolerated on token + proof temporal claims. */
const DEFAULT_CLOCK_TOLERANCE_SEC = 5;

// ── Framework-free request surface ──────────────────────────────────────────────

/**
 * A header collection accepted by {@link RequestLike}: a web `Headers`, an iterable of
 * `[name, value]` pairs, or a plain record (array values become repeated headers; `undefined`
 * values are skipped). A web `Request`'s `headers` (a `Headers`) satisfies this directly.
 */
export type HeadersInput =
  | Headers
  | Iterable<readonly [string, string]>
  | Record<string, string | readonly string[] | undefined>;

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

/** The internal canonical request (always a real `Headers`). */
interface NormalizedRequest {
  readonly headers: Headers;
  readonly method: string;
  readonly url: string;
}

/** Coerce any {@link HeadersInput} to a web `Headers`. */
function toHeaders(input: HeadersInput): Headers {
  if (input instanceof Headers) {
    return input;
  }
  const headers = new Headers();
  if (typeof (input as Iterable<unknown>)[Symbol.iterator] === "function") {
    for (const [name, value] of input as Iterable<readonly [string, string]>) {
      headers.append(name, value);
    }
    return headers;
  }
  for (const [name, value] of Object.entries(input as Record<string, unknown>)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, String(item));
      }
    } else {
      headers.set(name, String(value));
    }
  }
  return headers;
}

/** Normalise a {@link RequestLike} (or web `Request`) into the internal canonical form. */
function normalizeRequest(request: RequestLike): NormalizedRequest {
  return {
    headers: toHeaders(request.headers),
    method: request.method,
    url: request.url,
  };
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
export class ApiAuthError extends Error {
  readonly statusCode: number;
  /** The `WWW-Authenticate` header value, or undefined (403/429/503 need no challenge). */
  readonly wwwAuthenticate?: string;
  constructor(message: string, statusCode = 401, wwwAuthenticate?: string) {
    super(message);
    this.name = "ApiAuthError";
    this.statusCode = statusCode;
    if (wwwAuthenticate !== undefined) {
      this.wwwAuthenticate = wwwAuthenticate;
    }
  }
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
export class InProcessReplayStore implements ReplayStore {
  private readonly seen = new Map<string, number>();
  private readonly now: () => number;
  private readonly maxEntries: number;

  constructor(options: { now?: () => number; maxEntries?: number } = {}) {
    this.now = options.now ?? Date.now;
    this.maxEntries = options.maxEntries ?? 100_000;
  }

  async mark(jti: string, ttlSeconds: number): Promise<"new" | "replay"> {
    const now = this.now();
    this.prune(now);
    const existingExpiry = this.seen.get(jti);
    if (existingExpiry !== undefined && existingExpiry > now) {
      return "replay";
    }
    const ttlMs = ttlSeconds * 1000;
    // A non-positive TTL means the proof is already past its window — nothing to remember (the
    // `iat` check rejects it independently).
    if (ttlMs > 0) {
      // Hard cap: if the map is somehow flooded past the cap after pruning, drop the
      // oldest inserted entry so memory stays bounded (fail-safe under abuse).
      if (this.seen.size >= this.maxEntries) {
        const oldest = this.seen.keys().next().value;
        if (oldest !== undefined) {
          this.seen.delete(oldest);
        }
      }
      this.seen.set(jti, now + ttlMs);
    }
    return "new";
  }

  /** Drop expired entries (lazy — bounded work: only when the map has grown). */
  private prune(now: number): void {
    if (this.seen.size === 0) {
      return;
    }
    for (const [jti, expiry] of this.seen) {
      if (expiry <= now) {
        this.seen.delete(jti);
      }
    }
  }
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
export class TokenBucketRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; last: number }>();
  private readonly capacity: number;
  private readonly refillPerSec: number;
  private readonly now: () => number;
  private readonly maxKeys: number;

  /**
   * @param options.capacity     max burst (and the count restored per full window).
   * @param options.refillPerSec tokens restored per second (e.g. `capacity / 60` = `capacity`/min).
   */
  constructor(options: {
    capacity: number;
    refillPerSec: number;
    now?: () => number;
    maxKeys?: number;
  }) {
    this.capacity = Math.max(1, options.capacity);
    this.refillPerSec = Math.max(0, options.refillPerSec);
    this.now = options.now ?? Date.now;
    this.maxKeys = options.maxKeys ?? 10_000;
  }

  /**
   * Attempt to consume one token for `key`. Returns `true` when allowed (a token was
   * available), `false` when the bucket is empty (rate-limited → the caller returns 429).
   */
  tryRemove(key: string): boolean {
    const now = this.now();
    let bucket = this.buckets.get(key);
    if (bucket === undefined) {
      // Bound memory under a flood of distinct keys: evict the oldest-inserted bucket.
      if (this.buckets.size >= this.maxKeys) {
        const oldest = this.buckets.keys().next().value;
        if (oldest !== undefined) {
          this.buckets.delete(oldest);
        }
      }
      bucket = { tokens: this.capacity, last: now };
      this.buckets.set(key, bucket);
    } else {
      const elapsedSec = Math.max(0, (now - bucket.last) / 1000);
      bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSec * this.refillPerSec);
      bucket.last = now;
    }
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }
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
  /**
   * Trust `X-Forwarded-Proto` / `X-Forwarded-Host` when reconstructing the request URL for the
   * DPoP `htu` binding + the same-origin check. Default `false` (SECURITY): forwarded headers
   * are ATTACKER-CONTROLLED unless a trusted TLS-terminating reverse proxy sets them, so honoring
   * them by default would let a direct client redefine the `htu` origin being verified. Enable
   * ONLY when the app is deployed behind a proxy that authoritatively sets these headers (e.g.
   * Vercel / a TLS-terminating load balancer) — then the internal request URL is not the public
   * one and the forwarded headers carry the real external origin.
   */
  readonly trustForwardedHeaders?: boolean;
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
export function isLoopbackHttp(issuer: string): boolean {
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    return false;
  }
  if (url.protocol !== "http:") {
    return false;
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/**
 * DPoP-bound access-token verifier + owner authorizer for an app's own `/api/**` routes.
 * Issuer-agnostic; framework-agnostic. See the module header for the full pipeline. Construct
 * once (per process) and reuse — the issuer discovery + JWKS fetch are cached, and the
 * in-process replay store is shared across requests.
 */
export class DpopApiVerifier {
  private readonly trustedIssuers: readonly string[];
  private readonly ownerWebId: string | undefined;
  private readonly webidClaim: string;
  private readonly clockToleranceSec: number;
  private readonly bidirectionalMode: BidirectionalMode;
  private readonly allowInsecureLoopback: boolean;
  /**
   * Whether `X-Forwarded-*` headers are trusted when reconstructing the request URL (see
   * {@link DpopApiVerifierOptions.trustForwardedHeaders}). Public + readonly so a caller wiring
   * the same-origin CSRF check (e.g. {@link verifyRequest}) uses the SAME posture as the `htu`
   * binding does.
   */
  readonly trustForwardedHeaders: boolean;
  private readonly resolveIssuer: ResolveIssuer;
  private readonly replayStore: ReplayStore;
  private readonly injectedWebidFetch: typeof fetch | undefined;
  private readonly now: () => number;
  private readonly log: Required<AuthLogger>;
  /** Cached per-issuer keys (the promise, so concurrent first-requests share discovery). */
  private readonly issuerKeys = new Map<string, Promise<IssuerKeys>>();
  /** Lazily-built guarded fetch (undici DNS-pinning) — created on first bidirectional check. */
  private lazyWebidFetch: typeof fetch | undefined;

  constructor(options: DpopApiVerifierOptions) {
    if (options.trustedIssuers.length === 0) {
      throw new Error("DpopApiVerifier requires at least one trusted issuer.");
    }
    this.trustedIssuers = options.trustedIssuers;
    this.ownerWebId =
      options.ownerWebId && options.ownerWebId.length > 0 ? options.ownerWebId : undefined;
    this.webidClaim = options.webidClaim ?? "webid";
    this.clockToleranceSec = options.clockToleranceSec ?? DEFAULT_CLOCK_TOLERANCE_SEC;
    this.allowInsecureLoopback = options.allowInsecureLoopback ?? false;
    this.trustForwardedHeaders = options.trustForwardedHeaders ?? false;
    this.resolveIssuer = options.resolveIssuer ?? ((issuer) => this.discoverIssuer(issuer));
    this.replayStore = options.replayStore ?? new InProcessReplayStore({ now: options.now });
    this.injectedWebidFetch = options.webidFetch;
    this.now = options.now ?? Date.now;
    const baseLog = options.log;
    this.log = {
      warn: baseLog?.warn ?? (() => {}),
      info: baseLog?.info ?? (() => {}),
    };
    // Auto-downgrade the bidirectional check to `warn` when every trusted issuer is a
    // loopback-HTTP dev IdP (whose WebIDs the guarded fetch may be unable to reach), unless the
    // caller set the mode explicitly.
    const explicit = options.bidirectionalMode;
    const allLoopback = this.trustedIssuers.every((iss) => isLoopbackHttp(iss));
    this.bidirectionalMode = explicit ?? (allLoopback ? "warn" : "strict");
  }

  /**
   * Verify the request's DPoP-bound token WITHOUT the owner check — returns the caller's
   * verified {@link ApiCredentials}. Throws {@link ApiAuthError} on any failure. Use
   * {@link authorizeOwner} for the full write gate. Accepts any {@link RequestLike} (a web
   * `Request` included).
   */
  async authenticate(request: RequestLike): Promise<ApiCredentials> {
    const normalized = normalizeRequest(request);
    const authorization = normalized.headers.get("authorization") ?? undefined;
    const dpopHeader = normalized.headers.get("dpop") ?? undefined;

    const parsed = parseAuthorization(authorization);
    if (!parsed) {
      throw this.challenge("invalid_request", "Authentication required.");
    }
    if (parsed.scheme === "bearer") {
      // Proof-of-possession model: a bare Bearer token is never accepted.
      throw this.challenge("invalid_request", "DPoP-bound token required; Bearer not accepted.");
    }
    if (parsed.scheme !== "dpop") {
      throw this.challenge(
        "invalid_request",
        `Unsupported Authorization scheme: ${parsed.scheme}.`,
      );
    }
    if (dpopHeader === undefined) {
      throw this.challenge("invalid_request", "Missing DPoP proof header.");
    }

    // Trusted-issuer allowlist FIRST — from the unverified `iss`, before any discovery, so an
    // untrusted issuer never causes us to dereference its discovery document.
    const claimedIssuer = peekIssuer(parsed.token);
    if (!this.trustedIssuers.includes(claimedIssuer)) {
      throw this.challenge("invalid_token", "Token issuer is not trusted.");
    }

    // 1. Access token: signature + typ + iss + temporal (NO audience pin), then cnf.jkt.
    const claims = await this.verifyAccessToken(parsed.token, claimedIssuer);
    const cnfJkt = extractCnfJkt(claims);
    if (cnfJkt === undefined) {
      throw this.challenge(
        "invalid_token",
        "Access token is not DPoP-bound (no cnf.jkt confirmation claim).",
      );
    }

    // 2. DPoP proof: crypto + htm/htu/iat/ath/jti + cnf.jkt binding.
    const proofJti = await this.verifyDpopProof(normalized, dpopHeader, parsed.token, cnfJkt);

    // 3. WebID claim.
    const webId = this.extractWebId(claims);

    // 4. Replay check (cheap, O(1)) BEFORE the bidirectional network fetch — a replayed proof
    //    must never drive the expensive WebID dereference.
    await this.checkReplay(proofJti);

    // 5. Bidirectional WebID↔issuer check (SSRF-guarded; defence-in-depth).
    await this.checkBidirectionalIssuer(webId, claimedIssuer);

    return {
      webId,
      issuer: claimedIssuer,
      ...(typeof claims.client_id === "string" ? { clientId: claims.client_id } : {}),
    };
  }

  /**
   * The full write gate: {@link authenticate} + `webid === ownerWebId`. FAIL-CLOSED when
   * `ownerWebId` is unset (503). Wrong WebID → 403.
   */
  async authorizeOwner(request: RequestLike): Promise<ApiCredentials> {
    // Fail-closed configuration check FIRST — refuse writes when no owner is set, regardless of
    // whether a (valid) token is presented. Never open.
    if (this.ownerWebId === undefined) {
      throw new ApiAuthError(
        "This server is not configured to accept writes (owner WebID is unset).",
        503,
      );
    }
    const credentials = await this.authenticate(request);
    if (credentials.webId !== this.ownerWebId) {
      // Authenticated, but not the owner: 403 (no WWW-Authenticate — re-auth won't help).
      throw new ApiAuthError("You are not authorized to perform this action.", 403);
    }
    return credentials;
  }

  /**
   * Verify the access-token JWS with `jose`: asymmetric alg, `typ=at+jwt`, trusted `iss`,
   * temporal within tolerance. The `aud` is intentionally NOT checked (see the module header —
   * the token's audience is the pod, and the DPoP proof re-binds it to this request). Requires a
   * `sub` as basic sanity.
   */
  private async verifyAccessToken(
    token: string,
    claimedIssuer: string,
  ): Promise<oauth.JWTAccessTokenClaims> {
    let claims: oauth.JWTAccessTokenClaims;
    try {
      const keys = await this.keysFor(claimedIssuer);
      const { payload } = await jwtVerify(token, keys.jwks, {
        typ: ACCESS_TOKEN_TYP,
        algorithms: SIGNING_ALGS,
        issuer: claimedIssuer,
        clockTolerance: this.clockToleranceSec,
        // FAIL-CLOSED temporal enforcement: `jose` validates `exp`/`nbf` only when the claim is
        // PRESENT — a token that OMITS `exp`/`iat` would otherwise pass with no expiry at all.
        // `requiredClaims` makes their absence a hard rejection (401), so a never-expiring /
        // undated token is refused. `cnf` (DPoP binding) + the WebID claim are required here too
        // so a token missing either is rejected before we read it.
        requiredClaims: ["exp", "iat", "cnf", this.webidClaim],
      });
      claims = payload as oauth.JWTAccessTokenClaims;
    } catch (error: unknown) {
      throw this.challenge("invalid_token", `Access token verification failed: ${reason(error)}`);
    }
    if (typeof claims.sub !== "string" || claims.sub.length === 0) {
      throw this.challenge("invalid_token", "Access token is missing the 'sub' claim.");
    }
    return claims;
  }

  /**
   * Verify the DPoP proof (RFC 9449) with `jose`, returning its `jti`. Mirrors the pod
   * resource-server checks: `typ=dpop+jwt`, an asymmetric alg, an embedded PUBLIC JWK verifying
   * the proof signature, `htm`==method, `htu`==reconstructed URL, `iat` fresh, `ath`==access-
   * token hash, and `jkt(jwk)==cnf.jkt`. `jti` presence is asserted here; the caller consumes it
   * against the replay store.
   */
  private async verifyDpopProof(
    request: NormalizedRequest,
    proof: string,
    accessToken: string,
    cnfJkt: string,
  ): Promise<string> {
    let payload: JWTPayload;
    let header: { typ?: string; alg?: string; jwk?: JWK };
    try {
      const result = await jwtVerify(
        proof,
        async (protectedHeader, tok) => EmbeddedJWK(protectedHeader, tok),
        {
          typ: DPOP_PROOF_TYP,
          algorithms: SIGNING_ALGS,
          clockTolerance: this.clockToleranceSec,
        },
      );
      payload = result.payload;
      header = result.protectedHeader as typeof header;
    } catch (error: unknown) {
      throw this.challenge(
        "invalid_token",
        `DPoP proof verification failed: ${reason(error)}`,
        true,
      );
    }

    if (!isJsonObject(header.jwk)) {
      throw this.challenge("invalid_token", "DPoP proof jwk header must be a JSON object.", true);
    }
    // `htm` — must equal the request method.
    if (payload.htm !== request.method) {
      throw this.challenge("invalid_token", "DPoP proof htm mismatch.", true);
    }
    // `htu` — must equal the reconstructed request URL (query/fragment stripped both sides). An
    // unparseable `htu` is a mismatch (a 401 challenge), NOT an unhandled `TypeError` (which
    // would surface as a 500) — `normalizeHtu` returns undefined rather than throwing.
    const expectedHtu = reconstructRequestUrl(request, {
      trustForwardedHeaders: this.trustForwardedHeaders,
    });
    if (typeof payload.htu !== "string" || normalizeHtu(payload.htu) !== expectedHtu) {
      throw this.challenge("invalid_token", "DPoP proof htu mismatch.", true);
    }
    // `iat` — freshness window (± clock tolerance).
    if (typeof payload.iat !== "number") {
      throw this.challenge("invalid_token", "DPoP proof is missing iat.", true);
    }
    const nowSec = Math.floor(this.now() / 1000);
    if (Math.abs(nowSec - payload.iat) > DPOP_PROOF_MAX_AGE_SEC + this.clockToleranceSec) {
      throw this.challenge("invalid_token", "DPoP proof iat is not recent enough.", true);
    }
    // `jti` — must be present (the replay cache consumes it).
    if (typeof payload.jti !== "string" || payload.jti.length === 0) {
      throw this.challenge("invalid_token", "DPoP proof is missing a jti.", true);
    }
    // `ath` — binds the proof to THIS access token (base64url SHA-256 of the token).
    const expectedAth = createHash("sha256").update(accessToken).digest("base64url");
    if (payload.ath !== expectedAth) {
      throw this.challenge(
        "invalid_token",
        "DPoP proof ath does not match the access token.",
        true,
      );
    }
    // Proof-of-possession: the embedded key's thumbprint MUST equal the token's cnf.jkt.
    const proofJkt = await calculateJwkThumbprint(header.jwk, "sha256");
    if (proofJkt !== cnfJkt) {
      throw this.challenge(
        "invalid_token",
        "DPoP proof key does not match the access token confirmation (cnf.jkt).",
        true,
      );
    }
    return payload.jti;
  }

  /** Consume the proof's `jti` against the replay store (a repeat within the window = replay). */
  private async checkReplay(jti: string): Promise<void> {
    const ttlSeconds = DPOP_PROOF_MAX_AGE_SEC + this.clockToleranceSec;
    const result = await this.replayStore.mark(jti, ttlSeconds);
    if (result === "replay") {
      this.log.warn({ event: "api-auth.replay.detected" }, "DPoP jti replay detected — rejecting.");
      throw this.challenge("invalid_token", "DPoP proof has already been used (replay).", true);
    }
  }

  /** The `webid` claim — must be present and an `https:` URL without userinfo. */
  private extractWebId(claims: oauth.JWTAccessTokenClaims): string {
    const raw = (claims as Record<string, unknown>)[this.webidClaim];
    if (typeof raw !== "string" || raw.length === 0) {
      throw this.challenge("invalid_token", `Token is missing the '${this.webidClaim}' claim.`);
    }
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw this.challenge("invalid_token", "WebID claim is not a valid URL.");
    }
    if (url.protocol !== "https:") {
      throw this.challenge("invalid_token", "WebID claim must be an https: URL.");
    }
    if (url.username || url.password) {
      throw this.challenge("invalid_token", "WebID claim must not include userinfo.");
    }
    return raw;
  }

  /**
   * Bidirectional WebID↔issuer check: dereference the WebID profile (SSRF-guarded) and confirm
   * it lists `issuer` via `solid:oidcIssuer`. `strict` → any mismatch or fetch failure is a 401;
   * `warn` → log + accept; `off` → skip. The client-facing message is constant so this cannot be
   * used as a network-reconnaissance oracle.
   */
  private async checkBidirectionalIssuer(webId: string, issuer: string): Promise<void> {
    if (this.bidirectionalMode === "off") {
      return;
    }
    let listed = false;
    let internalReason: string | undefined;
    try {
      const issuers = await this.fetchWebIdIssuers(webId);
      listed = issuers.has(issuer);
      if (!listed) {
        internalReason = `WebID does not list issuer ${issuer} in solid:oidcIssuer.`;
      }
    } catch (error: unknown) {
      internalReason = `WebID profile resolution failed: ${reason(error)}`;
    }
    if (listed) {
      return;
    }
    this.log.warn(
      { webId, issuer, mode: this.bidirectionalMode, reason: internalReason },
      "Bidirectional WebID check failed.",
    );
    if (this.bidirectionalMode === "strict") {
      // Constant client-facing message (no SSRF/network detail leaks to the caller).
      throw this.challenge("invalid_token", "WebID issuer check failed.");
    }
    // warn: accepted (log emitted above).
  }

  /**
   * Fetch the WebID profile through the SSRF-guarded fetch and extract its `solid:oidcIssuer`
   * object set. The WebID is user-influenced, so this NEVER uses a bare `fetch` — it uses
   * `@jeswr/guarded-fetch/node` (DNS-pinned; closes the rebinding TOCTOU) via `@jeswr/fetch-rdf`.
   */
  private async fetchWebIdIssuers(webId: string): Promise<Set<string>> {
    const fetchImpl = await this.webidFetch();
    const { fetchRdf } = await import("@jeswr/fetch-rdf");
    const { dataset } = await fetchRdf(webId, { fetch: fetchImpl });
    const profileUrl = stripFragment(webId);
    const issuers = new Set<string>();
    for (const quad of dataset as Iterable<{
      subject: { termType: string; value: string };
      predicate: { value: string };
      object: { termType: string; value: string };
    }>) {
      if (quad.predicate.value !== SOLID_OIDC_ISSUER) {
        continue;
      }
      if (quad.subject.value !== webId && quad.subject.value !== profileUrl) {
        continue;
      }
      if (quad.object.termType === "NamedNode") {
        issuers.add(quad.object.value);
      }
    }
    return issuers;
  }

  /** The SSRF-guarded fetch for WebID profiles (injected in tests; built lazily otherwise). */
  private async webidFetch(): Promise<typeof fetch> {
    if (this.injectedWebidFetch) {
      return this.injectedWebidFetch;
    }
    if (this.lazyWebidFetch === undefined) {
      const { createNodeGuardedFetch } = await import("@jeswr/guarded-fetch/node");
      this.lazyWebidFetch = createNodeGuardedFetch({ allowLoopback: this.allowInsecureLoopback });
    }
    return this.lazyWebidFetch;
  }

  /** Get (or cache) an issuer's verification keys; a rejected discovery is evicted so it can retry. */
  private async keysFor(issuer: string): Promise<IssuerKeys> {
    let pending = this.issuerKeys.get(issuer);
    if (!pending) {
      pending = Promise.resolve(this.resolveIssuer(issuer));
      this.issuerKeys.set(issuer, pending);
    }
    try {
      return await pending;
    } catch (error) {
      this.issuerKeys.delete(issuer);
      throw error;
    }
  }

  /**
   * The default issuer resolver: OIDC discovery (`${issuer}/.well-known/openid-configuration`,
   * issuer cross-checked) via `oauth4webapi`, then a cached remote JWKS over the discovered
   * `jwks_uri`. The issuer is operator-configured (a trusted-list entry), NOT user-influenced,
   * so discovery does not need the SSRF guard (unlike the WebID fetch, which does).
   */
  private async discoverIssuer(issuer: string): Promise<IssuerKeys> {
    const issuerUrl = new URL(issuer);
    const allowInsecure = this.allowInsecureLoopback && isLoopbackHttp(issuer);
    const res = await oauth.discoveryRequest(issuerUrl, {
      algorithm: "oidc",
      ...(allowInsecure ? { [oauth.allowInsecureRequests]: true } : {}),
    });
    const as = await oauth.processDiscoveryResponse(issuerUrl, res);
    if (as.issuer !== issuer) {
      throw new Error(`OIDC discovery issuer mismatch for ${issuer} (got ${as.issuer}).`);
    }
    if (typeof as.jwks_uri !== "string" || as.jwks_uri.length === 0) {
      throw new Error(`OIDC discovery for ${issuer} has no jwks_uri.`);
    }
    return {
      jwks: createRemoteJWKSet(new URL(as.jwks_uri)),
      allowInsecureRequests: allowInsecure,
    };
  }

  /** Build an {@link ApiAuthError} (401) with an RFC 6750 / 9449-style `WWW-Authenticate`. */
  private challenge(error: string, description: string, dpop = true): ApiAuthError {
    const params = [
      `error="${error}"`,
      `error_description="${escapeQuoted(description)}"`,
      `scope="webid"`,
      `issuer="${escapeQuoted(this.trustedIssuers.join(" "))}"`,
    ];
    if (dpop) {
      params.push(`algs="${DPOP_ALGS.join(" ")}"`);
    }
    // Always advertise DPoP (this is a DPoP-only resource server).
    return new ApiAuthError(description, 401, `DPoP ${params.join(", ")}`);
  }
}

// ── Framework-free top-level entry ──────────────────────────────────────────────

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
export async function verifyRequest(
  headers: HeadersInput,
  method: string,
  url: string,
  opts: VerifyRequestOptions,
): Promise<ApiCredentials> {
  const request: RequestLike = { headers, method, url };
  // CSRF check first (cheap, rejects a forged cross-site browser POST before any crypto work).
  // Use the verifier's forwarded-header posture so the origin is reconstructed identically to
  // the `htu` binding (a mismatch here would otherwise be an inconsistent trust boundary).
  if (opts.assertSameOrigin === true) {
    assertSameOrigin(request, { trustForwardedHeaders: opts.verifier.trustForwardedHeaders });
  }
  const credentials =
    opts.requireOwner === false
      ? await opts.verifier.authenticate(request)
      : await opts.verifier.authorizeOwner(request);
  if (opts.rateLimiter) {
    const key = opts.rateLimitKey ? opts.rateLimitKey(credentials) : credentials.webId;
    if (!opts.rateLimiter.tryRemove(key)) {
      throw new ApiAuthError("Rate limit exceeded. Please try again later.", 429);
    }
  }
  return credentials;
}

// ── Free helpers (exported where consumers / tests need them) ───────────────────

/** Parse an `Authorization` header into `{ scheme (lower-case), token }`, or undefined. */
export function parseAuthorization(
  header: string | undefined,
): { scheme: string; token: string } | undefined {
  if (!header) {
    return undefined;
  }
  const trimmed = header.trim();
  const sp = trimmed.indexOf(" ");
  if (sp === -1) {
    return undefined;
  }
  const scheme = trimmed.slice(0, sp).toLowerCase();
  const token = trimmed.slice(sp + 1).trim();
  if (!token) {
    return undefined;
  }
  return { scheme, token };
}

/** Options for {@link reconstructRequestUrl} + {@link assertSameOrigin}. */
export interface RequestUrlOptions {
  /**
   * Trust `X-Forwarded-Proto` / `X-Forwarded-Host`. Default `false` (SECURITY): these headers are
   * attacker-controlled on a directly-reachable server, so honoring them would let a client
   * redefine the origin the `htu` binding is checked against. Enable only behind a trusted proxy
   * that sets them authoritatively (see {@link DpopApiVerifierOptions.trustForwardedHeaders}).
   */
  readonly trustForwardedHeaders?: boolean;
}

/**
 * Reconstruct the exact request URL the client signed into the DPoP proof's `htu`: scheme + host
 * + (non-default) port + path, query/fragment stripped.
 *
 * The authority (scheme + host) is derived SOLELY from `request.url` — the canonical absolute URL
 * the framework/runtime resolved for the request. A raw `Host` header is DELIBERATELY NOT
 * consulted: it is client-controlled and letting it override `request.url` would be an equivalent
 * `htu`-origin spoofing path (a replay could set `Host` to redefine the verified origin). When
 * {@link RequestUrlOptions.trustForwardedHeaders} is set (the app is behind a trusted
 * TLS-terminating proxy / Vercel, where `request.url` is the INTERNAL address), `X-Forwarded-Proto`
 * / `X-Forwarded-Host` take precedence over `request.url`; by DEFAULT they are IGNORED (they are
 * attacker-controlled on a directly-reachable server). `request.url` MUST be the absolute request
 * URL (the {@link RequestLike} contract). Accepts any {@link RequestLike}.
 */
export function reconstructRequestUrl(request: RequestLike, opts: RequestUrlOptions = {}): string {
  const normalized = normalizeRequest(request);
  const raw = new URL(normalized.url);
  const trustForwarded = opts.trustForwardedHeaders === true;
  const forwardedProto = trustForwarded
    ? firstForwardedValue(normalized.headers.get("x-forwarded-proto"))
    : undefined;
  const forwardedHost = trustForwarded
    ? firstForwardedValue(normalized.headers.get("x-forwarded-host"))
    : undefined;
  // Authority from request.url only (never a client-supplied Host header); forwarded headers
  // override it exclusively in trusted-proxy mode.
  const proto = forwardedProto ?? raw.protocol.replace(/:$/, "");
  const host = forwardedHost ?? raw.host;
  const rebuilt = new URL(`${proto}://${host}`);
  rebuilt.pathname = raw.pathname;
  rebuilt.search = "";
  rebuilt.hash = "";
  return rebuilt.href;
}

/** A forwarded header can be comma-separated (proxy chain); take the first, trimmed. */
function firstForwardedValue(header: string | null): string | undefined {
  if (!header) {
    return undefined;
  }
  const first = header.split(",")[0]?.trim();
  return first && first.length > 0 ? first : undefined;
}

/**
 * Same-origin CSRF check (defence-in-depth alongside the DPoP `htu` binding). Rejects a request
 * whose `Origin` (or, as a fallback, `Referer`) is present but does NOT match the request's own
 * origin (the reconstructed, proxy-aware origin). A same-origin request or a request with
 * neither header is allowed (non-browser clients, and the DPoP proof is the primary control). A
 * forged cross-site browser POST carries the attacker origin and is refused here. Throws
 * {@link ApiAuthError} (403) on mismatch. Accepts any {@link RequestLike}.
 */
export function assertSameOrigin(request: RequestLike, opts: RequestUrlOptions = {}): void {
  const normalized = normalizeRequest(request);
  const expectedOrigin = new URL(reconstructRequestUrl(normalized, opts)).origin;
  const origin = normalized.headers.get("origin");
  if (origin !== null && origin !== "null") {
    if (safeOrigin(origin) !== expectedOrigin) {
      throw new ApiAuthError("Cross-origin request refused.", 403);
    }
    return;
  }
  const referer = normalized.headers.get("referer");
  if (referer !== null && referer.length > 0) {
    if (safeOrigin(referer) !== expectedOrigin) {
      throw new ApiAuthError("Cross-origin request refused.", 403);
    }
  }
  // Neither header present → allow (the DPoP proof-of-possession binding is the real control).
}

/** The `URL.origin` of `raw`, or `undefined` when unparseable / opaque. */
function safeOrigin(raw: string): string | undefined {
  try {
    const origin = new URL(raw).origin;
    return origin === "null" ? undefined : origin;
  } catch {
    return undefined;
  }
}

/** Decode the unverified JWT payload just far enough to read a claim (pre-validation routing). */
function decodeClaims(token: string): Record<string, unknown> | undefined {
  const parts = token.split(".");
  const claimsSegment = parts.length === 3 ? parts[1] : undefined;
  if (claimsSegment === undefined) {
    return undefined;
  }
  try {
    const json = Buffer.from(claimsSegment, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    return isJsonObject(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Read the unverified `iss` (re-asserted by the signature check) to pick the issuer's keys. */
function peekIssuer(token: string): string {
  const claims = decodeClaims(token);
  const iss = claims?.iss;
  if (typeof iss !== "string" || iss.length === 0) {
    throw new ApiAuthError("Malformed access token (no issuer).", 401);
  }
  return iss;
}

/** Extract a string `cnf.jkt` from validated access-token claims, or undefined. */
function extractCnfJkt(claims: oauth.JWTAccessTokenClaims): string | undefined {
  const cnf = (claims as { cnf?: unknown }).cnf;
  if (!isJsonObject(cnf)) {
    return undefined;
  }
  const jkt = (cnf as { jkt?: unknown }).jkt;
  return typeof jkt === "string" && jkt.length > 0 ? jkt : undefined;
}

/**
 * Normalise an `htu` for comparison: strip query + fragment (RFC 9449 §4.2). Returns `undefined`
 * for an UNPARSEABLE `htu` (never throws) so a malformed proof surfaces as an `htu` mismatch (a
 * 401 challenge) rather than an unhandled `TypeError` escaping as a 500.
 */
function normalizeHtu(htu: string): string | undefined {
  let url: URL;
  try {
    url = new URL(htu);
  } catch {
    return undefined;
  }
  url.search = "";
  url.hash = "";
  return url.href;
}

/** Strip the fragment from a WebID → its profile-document URL. */
function stripFragment(webId: string): string {
  try {
    const url = new URL(webId);
    url.hash = "";
    return url.toString();
  } catch {
    return webId.split("#")[0] ?? webId;
  }
}

/** Whether a value is a plain JSON object (not null, not an array). */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A short, non-sensitive reason string from an unknown error. */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

/** Escape a string for safe inclusion inside a quoted `WWW-Authenticate` parameter value. */
function escapeQuoted(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// ── Env-driven wiring (opt-in convenience for the fan-out apps) ─────────────────

let sharedVerifier: DpopApiVerifier | undefined;

/**
 * Parse a trusted-issuer list (comma/space/newline-separated) into a trimmed array. Exported
 * for the fan-out apps + tests.
 */
export function parseTrustedIssuers(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Build {@link DpopApiVerifierOptions} from environment variables (the shared convention across
 * the five products, preserved verbatim from the AccessRadar reference):
 *  - `PSS_TRUSTED_ISSUERS`              — required; the trusted-issuer allowlist.
 *  - `OWNER_WEBID`                      — the single authorized writer (fail-closed if unset).
 *  - `PSS_WEBID_CLAIM`                  — the WebID claim name (default `webid`).
 *  - `PSS_BIDIRECTIONAL_WEBID_MODE`     — `strict` | `warn` | `off`.
 *  - `PSS_AUTH_ALLOW_INSECURE_LOOPBACK` — `1`/`true` to allow loopback-HTTP (dev/CI).
 *  - `PSS_CLOCK_TOLERANCE_SEC`          — clock skew seconds (default 5).
 *  - `PSS_TRUST_FORWARDED_HEADERS`      — `1`/`true` behind a trusted proxy (Vercel / a TLS-
 *                                         terminating LB); default false (see
 *                                         {@link DpopApiVerifierOptions.trustForwardedHeaders}).
 *
 * The `env` param is a plain `Record<string, string | undefined>` (NOT `NodeJS.ProcessEnv`) so a
 * consumer without ambient Node globals still type-checks against the public declaration;
 * `process.env` satisfies it.
 */
export function optionsFromEnv(
  env: Record<string, string | undefined> = process.env,
): DpopApiVerifierOptions {
  const mode = env.PSS_BIDIRECTIONAL_WEBID_MODE;
  const bidirectionalMode: BidirectionalMode | undefined =
    mode === "strict" || mode === "warn" || mode === "off" ? mode : undefined;
  const tolerance = Number(env.PSS_CLOCK_TOLERANCE_SEC);
  return {
    trustedIssuers: parseTrustedIssuers(env.PSS_TRUSTED_ISSUERS),
    ownerWebId: env.OWNER_WEBID,
    webidClaim: env.PSS_WEBID_CLAIM || "webid",
    ...(bidirectionalMode ? { bidirectionalMode } : {}),
    allowInsecureLoopback:
      env.PSS_AUTH_ALLOW_INSECURE_LOOPBACK === "1" ||
      env.PSS_AUTH_ALLOW_INSECURE_LOOPBACK === "true",
    trustForwardedHeaders:
      env.PSS_TRUST_FORWARDED_HEADERS === "1" || env.PSS_TRUST_FORWARDED_HEADERS === "true",
    ...(Number.isFinite(tolerance) && tolerance >= 0 ? { clockToleranceSec: tolerance } : {}),
    log: { warn: (o, m) => console.warn(m ?? "", o) },
  };
}

/**
 * A process-wide verifier built from the environment via {@link optionsFromEnv}. Constructed
 * once and reused so issuer discovery + JWKS + the replay store persist across requests. Throws
 * if the trusted-issuer list is empty — a misconfigured server must not silently accept nothing
 * (or, worse, everything); it should fail loudly at first use.
 */
export function getVerifier(): DpopApiVerifier {
  if (sharedVerifier === undefined) {
    sharedVerifier = new DpopApiVerifier(optionsFromEnv());
  }
  return sharedVerifier;
}

/** Test-only: drop the cached singleton so the next {@link getVerifier} rereads the env. */
export function __resetVerifierForTests(): void {
  sharedVerifier = undefined;
}

let sharedRateLimiter: TokenBucketRateLimiter | undefined;

/** Default sustained rate (per minute) when `PSS_SCAN_RATE_PER_MIN` is unset. */
const DEFAULT_SCAN_RATE_PER_MIN = 10;

/**
 * A process-wide rate limiter, built from `PSS_SCAN_RATE_PER_MIN` (per-minute capacity + refill;
 * default {@link DEFAULT_SCAN_RATE_PER_MIN}). Key it by WebID at the call site so a single
 * compromised owner token is capped rather than able to spawn unbounded work. Single-instance
 * (see {@link TokenBucketRateLimiter}).
 */
export function getScanRateLimiter(): TokenBucketRateLimiter {
  if (sharedRateLimiter === undefined) {
    const parsed = Number(process.env.PSS_SCAN_RATE_PER_MIN);
    const perMin = Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_SCAN_RATE_PER_MIN;
    sharedRateLimiter = new TokenBucketRateLimiter({
      capacity: perMin,
      refillPerSec: perMin / 60,
    });
  }
  return sharedRateLimiter;
}

/** Test-only: drop the cached rate limiter so the next {@link getScanRateLimiter} rereads the env. */
export function __resetRateLimiterForTests(): void {
  sharedRateLimiter = undefined;
}
