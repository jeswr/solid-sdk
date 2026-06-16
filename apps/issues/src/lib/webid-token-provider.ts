/**
 * webid-token-provider.ts — a custom @solid/reactive-authentication `TokenProvider`
 * whose OIDC issuer is resolved from the user's WebID profile (via callbacks),
 * instead of the published `DPoPTokenProvider`'s hard-coded host map.
 *
 * Ported from the published `DPoPTokenProvider` (v0.1.2), preserving its
 * authorization-code + PKCE + DPoP flow and its `prompt=none` silent-retry
 * behaviour. The ONE structural change: `#resolveIssuer()` dereferences the
 * WebID and reads `solid:oidcIssuer`, then asks `chooseIssuer` when several are
 * advertised — never silently the first.
 *
 * Two app-supplied callbacks drive identity:
 *  - `getWebId()`   — UI that asks the user for their WebID (see `promptWebIdDialog`).
 *  - `getCode(uri)` — the existing `<authorization-code-flow>` element's `getCode`.
 *
 * `allowInsecureLoopback` is what makes LOCAL CSS work: it flips oauth4webapi's
 * `allowInsecureRequests` ONLY for `localhost`/`127.0.0.1` issuers, so the HTTP
 * issuer of a dev CSS is accepted while remote HTTPS issuers stay strict.
 */
import * as oauth from "oauth4webapi";
import * as DPoP from "dpop";
import type { GetCodeCallback } from "@solid/reactive-authentication";
import { fetchRdf } from "@jeswr/fetch-rdf";
import { resolveIssuers, validateWebId } from "./login-ux";

/**
 * The library's TokenProvider interface. @solid/reactive-authentication 0.1.2
 * does NOT re-export the `TokenProvider` type from its package entrypoint (only
 * the concrete providers), so we restate the (tiny, stable) structural contract
 * here. `ReactiveFetchManager` accepts any `Iterable<TokenProvider>`, and
 * matches structurally — this is the exact shape from the package's
 * `TokenProvider.d.ts`.
 */
export interface TokenProvider {
  matches(request: Request): Promise<boolean>;
  upgrade(request: Request): Promise<Request>;
}

/** Ask the user for their WebID. Resolves to the WebID string, or rejects/cancels. */
export type GetWebIdCallback = () => Promise<string>;

/**
 * Choose one issuer from several advertised on the profile. The default policy
 * is: a single issuer is used directly; more than one is an error (no callback =
 * no UI to choose, and silently picking the first is wrong). Apps that surface a
 * picker pass their own `chooseIssuer`.
 */
export type ChooseIssuerCallback = (issuers: string[]) => Promise<string>;

/**
 * A restorable session emitted after a successful login (or refresh): the
 * issuer + client + DPoP key + refresh token the app persists (IndexedDB) so a
 * later reopen can silently refresh-grant back in without a redirect/popup.
 */
export interface RestorableSession {
  issuer: string;
  client: oauth.Client;
  dpopKey: CryptoKeyPair;
  refreshToken?: string;
  /** Absolute refresh-token expiry (epoch ms), when the IdP advertises one. */
  refreshExpiresAt?: number;
}

/** Material needed to silently re-establish a session via the refresh grant. */
export interface SeedSession {
  issuer: string;
  client: oauth.Client;
  dpopKey: CryptoKeyPair;
  refreshToken: string;
}

// ── Two-phase FULL-PAGE redirect login (Pod-Manager autologin) ───────────────
//
// @solid/reactive-authentication 0.1.3 ships ONLY the POPUP <authorization-code-
// flow> element — there is NO published non-popup/redirect mode. A popup
// auto-opened on page load (no user gesture) is browser-blocked, so the autologin
// deep-link MUST use a full-page redirect. A full-page redirect destroys all
// in-memory state (the popup path keeps the DPoP key, PKCE verifier, state, nonce
// in #authenticate's closure — all lost on navigation), so the redirect path is a
// TWO-PHASE flow that PERSISTS the in-between state to sessionStorage. The popup
// + silent-refresh paths are untouched.

/**
 * The sessionStorage key under which the TWO-PHASE full-page redirect login
 * persists its in-between state ({@link PersistedRedirectFlow}). ONE key holds
 * ONE record (a single in-flight redirect login per tab — autologin is single-shot,
 * see SolidSessionProvider's sentinel). sessionStorage is PER-TAB and same-origin,
 * cleared on tab close — the record never outlives the tab and is never shared
 * across origins.
 */
export const REDIRECT_FLOW_KEY = "solid-issues.autologin.flow";

/**
 * The serialised state a full-page-redirect login persists to sessionStorage
 * between {@link WebIdDPoPTokenProvider.beginRedirectLogin} (before the redirect)
 * and {@link WebIdDPoPTokenProvider.completeRedirectLogin} (after the broker
 * redirects back). It carries the PKCE verifier + the DPoP private+public JWK + the
 * OIDC `state`/`nonce`.
 *
 * SECURITY — why persisting the DPoP private JWK here is acceptable:
 *  - sessionStorage is SAME-ORIGIN and PER-TAB and is cleared when the tab closes,
 *    so the key is reachable only by this origin's own code for the brief duration
 *    of one redirect round-trip;
 *  - this is the STANDARD pattern for redirect-based PKCE+DPoP SPAs: a full-page
 *    redirect has no closure to keep the key in, so the only alternatives are a
 *    persisted extractable key (this) or abandoning DPoP for the redirect path;
 *  - the `state` is verified on return (`oauth.validateAuthResponse`), the PKCE
 *    verifier is single-use against the code, and the record is CLEARED the instant
 *    it is consumed (success OR failure — see `completeRedirectLogin`'s `finally`)
 *    so a refresh/back-button cannot replay it.
 * The popup path keeps its DPoP key NON-extractable (it never leaves the closure);
 * ONLY this redirect path exports the key, and only because the redirect erases
 * the closure.
 */
interface PersistedRedirectFlow {
  /** The DPoP keypair, exported to JWK so it survives the full-page redirect. */
  dpopPrivateJwk: JsonWebKey;
  dpopPublicJwk: JsonWebKey;
  /** The PKCE code verifier — exchanged (single-use) for the code on return. */
  codeVerifier: string;
  /** Whether PKCE is in use (the AS advertised a challenge method). */
  usePkce: boolean;
  /** The OIDC `state`, verified against the callback by `validateAuthResponse`. */
  state: string;
  /** The OIDC `nonce`, the `expectedNonce` for the token exchange. */
  nonce: string;
  /** The resolved issuer href (the discovery + token endpoints are re-derived). */
  issuer: string;
  /** The `client_id` used (this app's static Client Identifier Document URL). */
  clientId: string;
  /**
   * The redirect_uri sent in BOTH the authorization request AND the token
   * exchange — they MUST be byte-identical or the token exchange is rejected.
   */
  redirectUri: string;
  /** The WebID the user asked to log in as (the deep-link target). */
  webId: string;
}

/** Read the persisted redirect-flow record, or null if absent/unparseable. */
function readPersistedRedirectFlow(): PersistedRedirectFlow | null {
  let raw: string | null;
  try {
    raw = globalThis.sessionStorage?.getItem(REDIRECT_FLOW_KEY) ?? null;
  } catch {
    return null; // sessionStorage unavailable (SSR / disabled) — no pending flow.
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedRedirectFlow;
  } catch {
    return null; // corrupt record — treat as absent (the caller falls back to login).
  }
}

/** Remove the persisted redirect-flow record (idempotent; swallows storage errors). */
function clearPersistedRedirectFlow(): void {
  try {
    globalThis.sessionStorage?.removeItem(REDIRECT_FLOW_KEY);
  } catch {
    // sessionStorage unavailable — nothing to clear.
  }
}

/**
 * Whether a full-page-redirect login is mid-flight (a persisted record exists in
 * sessionStorage). The SolidSessionProvider calls this ON MOUNT to detect a
 * returning autologin (Case A) before deciding whether the `?code&state` on the URL
 * belongs to us. A module function (not an instance method) so it is callable
 * before the provider singleton has resolved.
 */
export function hasPendingRedirectLogin(): boolean {
  return readPersistedRedirectFlow() !== null;
}

/**
 * The WebID a pending redirect login is for, or null when no record exists. The
 * SolidSessionProvider reads this to know which identity the returning autologin is
 * resuming (so it can confirm the OP authenticated AS that WebID).
 */
export function consumePendingRedirectWebId(): string | null {
  return readPersistedRedirectFlow()?.webId ?? null;
}

/** WebCrypto params for an ES256 (P-256 ECDSA) key, used to re-import the DPoP JWK. */
const ES256_IMPORT_ALG = { name: "ECDSA", namedCurve: "P-256" } as const;

/**
 * Compare two WebIDs for IDENTITY equality, tolerant only of trivial URL
 * normalisation (case-insensitive scheme + host, default-port elision), never of
 * a different path/query/fragment. Returns false if either side is missing or
 * unparseable — an unverifiable identity must FAIL closed, not pass. Used by the
 * redirect login flow to confirm the OP authenticated the user as the WebID they
 * asked to log in as (the deep-link target).
 */
export function webIdsEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return (
      ua.protocol === ub.protocol &&
      ua.host.toLowerCase() === ub.host.toLowerCase() &&
      ua.pathname === ub.pathname &&
      ua.search === ub.search &&
      ua.hash === ub.hash
    );
  } catch {
    return false;
  }
}

/**
 * The WebID an id_token authenticated AS. Solid-OIDC carries the WebID in the
 * `webid` claim; when absent (some servers put it in `sub`), `sub` is the WebID.
 * Returns undefined when neither is a usable string — the caller then refuses to
 * treat the login as verified rather than guessing an identity.
 */
export function webIdFromClaims(claims: oauth.IDToken | undefined): string | undefined {
  if (!claims) return undefined;
  const webid = claims.webid;
  if (typeof webid === "string" && webid.length > 0) return webid;
  if (typeof claims.sub === "string" && claims.sub.length > 0) return claims.sub;
  return undefined;
}

export interface WebIdDPoPTokenProviderOptions {
  /**
   * A **Solid-OIDC Client Identifier Document** URL. When set, the provider
   * SKIPS dynamic client registration and authenticates as a public client whose
   * `client_id` IS this URL (the spec's "Client Identifier" — a dereferenceable
   * JSON-LD document; see https://solidproject.org/TR/oidc#clientids). The OP
   * dereferences the URL and matches the redirect_uri against the document's
   * `redirect_uris`, so the document MUST list the {@link callbackUri} passed to
   * the constructor. With `none` token-endpoint auth (a public browser client),
   * no client secret is involved.
   *
   * The URL string MUST equal the document's `client_id` field byte-for-byte;
   * a trailing-slash or scheme/port mismatch makes the OP reject it.
   *
   * When ABSENT (default), the provider falls back to **dynamic client
   * registration** — convenient for local dev, but yields a throwaway client
   * with no stable name on the consent screen.
   */
  clientId?: string;
  /**
   * Pick one issuer when the profile advertises several. Defaults to a policy
   * that throws on ambiguity (see {@link AmbiguousIssuerError}). It is always
   * called with ≥ 1 issuer; with exactly one, the default returns it.
   */
  chooseIssuer?: ChooseIssuerCallback;
  /**
   * Enable oauth4webapi's `allowInsecureRequests` for `localhost` / `127.0.0.1`
   * issuers only (dev CSS over HTTP). Remote HTTPS issuers are unaffected, and
   * non-loopback HTTP issuers are never allowed. Default `false`.
   */
  allowInsecureLoopback?: boolean;
  /**
   * Override the fetch used to dereference the public WebID profile. Defaults to
   * the `globalThis.fetch` captured at CONSTRUCTION time (before
   * {@link https://github.com/solid-contrib/reactive-authentication ReactiveFetchManager}
   * patches the global) — see the recursion note in the class docs. Test-only.
   */
  profileFetch?: typeof fetch;
  /**
   * Called whenever a session is (re)established — after an interactive login or
   * a silent refresh-grant. The app persists this so a later reopen can silently
   * restore (see `session-store.ts`). The refresh token is a possession secret;
   * persist it in IndexedDB scoped to the WebID, never localStorage.
   */
  onSession?: (session: RestorableSession) => void;
}

/**
 * Outcome of completing a full-page-redirect (autologin) login. The
 * SolidSessionProvider uses these to drive the SAME post-login landing path the
 * popup + silent-restore flows use (load profile → choose storage → completeLogin).
 */
export interface RedirectLoginResult {
  /** The WebID the OP authenticated as — verified to equal the requested target. */
  webId: string;
  /** The resolved issuer href (so the caller can persist the restorable session). */
  issuer: string;
}

/** A WebID advertises several issuers but no `chooseIssuer` was supplied. */
export class AmbiguousIssuerError extends Error {
  readonly webId: string;
  readonly issuers: string[];
  constructor(webId: string, issuers: string[]) {
    super(
      `This WebID advertises ${issuers.length} OIDC issuers — the app must supply ` +
        `a 'chooseIssuer' callback so the user can pick one (${webId}).`,
    );
    this.name = "AmbiguousIssuerError";
    this.webId = webId;
    this.issuers = issuers;
  }
}

/** The default issuer policy: single → it; several → throw (never pick silently). */
function defaultChooseIssuer(webId: string): ChooseIssuerCallback {
  return async (issuers: string[]) => {
    if (issuers.length === 1) return issuers[0];
    throw new AmbiguousIssuerError(webId, issuers);
  };
}

/** Per-issuer session state cached so repeat upgrades don't re-prompt. */
interface IssuerSession {
  authorizationServer: oauth.AuthorizationServer;
  clientRegistration: oauth.Client;
  dpopKey: CryptoKeyPair;
  accessToken: string;
  /** Refresh token for silent re-establishment, when the IdP granted one. */
  refreshToken?: string;
}

const isLoopback = (host: string): boolean =>
  host === "localhost" || host === "127.0.0.1" || host === "[::1]";

export class WebIdDPoPTokenProvider implements TokenProvider {
  readonly #callbackUri: string;
  readonly #getCode: GetCodeCallback;
  readonly #getWebId: GetWebIdCallback;
  readonly #clientId?: string;
  readonly #chooseIssuer?: ChooseIssuerCallback;
  readonly #allowInsecureLoopback: boolean;
  readonly #onSession?: (session: RestorableSession) => void;
  /**
   * The profile is PUBLIC, so reading it needs no auth. We must not read it
   * through the patched global fetch in a way that recurses back into this
   * provider on a 401. We snapshot `globalThis.fetch` at construction — the
   * provider is built BEFORE `new ReactiveFetchManager([provider])` patches the
   * global, so this snapshot is the original, un-upgrading fetch. (A public
   * profile won't 401 anyway, but this keeps the read provably out of the
   * reactive loop regardless of access-control surprises.)
   */
  readonly #profileFetch: typeof fetch;
  /**
   * Memoised issuer resolution: the user is asked for their WebID ONCE per
   * provider instance, not on every 401 — and concurrent 401s share the same
   * in-flight prompt (single-flight). Cleared on failure so a cancelled or
   * failed prompt can be retried.
   */
  #issuer?: Promise<URL>;
  /** Single-flight session per issuer: parallel 401s share one login flow. */
  readonly #sessions = new Map<string, Promise<IssuerSession>>();
  /**
   * The WebID the most-recently-established session actually authenticated AS
   * (the `webid`/`sub` claim of its id_token), or undefined when no session has
   * been established. The redirect-login flow reads this to PROVE the
   * authenticated identity matches the WebID the user asked to log in as — never
   * inferring "logged in" from merely "a token is attached".
   */
  #authenticatedWebId: string | undefined;
  /**
   * Shared auth work (issuer resolution, login) is provider-owned: it must NOT
   * be tied to any single request's AbortSignal, or aborting one request would
   * cancel the login other concurrent 401 upgrades are waiting on. The user
   * cancels via the dialog/popup themselves, which rejects the shared promise.
   */
  readonly #authSignal = new AbortController().signal;

  constructor(
    callbackUri: string,
    getCode: GetCodeCallback,
    getWebId: GetWebIdCallback,
    options: WebIdDPoPTokenProviderOptions = {},
  ) {
    this.#callbackUri = callbackUri;
    this.#getCode = getCode;
    this.#getWebId = getWebId;
    this.#clientId = options.clientId;
    this.#chooseIssuer = options.chooseIssuer;
    this.#allowInsecureLoopback = options.allowInsecureLoopback ?? false;
    this.#onSession = options.onSession;
    this.#profileFetch =
      options.profileFetch ?? globalThis.fetch.bind(globalThis);
  }

  /** oauth4webapi request options, enabling insecure loopback per the policy. */
  #httpOptions(
    issuer: URL,
    signal: AbortSignal,
  ): { signal: AbortSignal; [oauth.allowInsecureRequests]?: true } {
    if (this.#allowInsecureLoopback && isLoopback(issuer.hostname)) {
      return { signal, [oauth.allowInsecureRequests]: true };
    }
    return { signal };
  }

  /**
   * WebID-driven issuer resolution — the one structural change from the
   * published provider. Ask the app for a WebID, validate it, dereference its
   * public profile (out-of-loop fetch), read every `solid:oidcIssuer`, then let
   * the app choose when several are advertised.
   */
  async #resolveIssuer(signal: AbortSignal): Promise<URL> {
    const webId = validateWebId(await this.#getWebId());
    signal.throwIfAborted();
    const { dataset } = await fetchRdf(webId, { fetch: this.#profileFetch });
    const issuers = resolveIssuers(webId, dataset);
    const choose = this.#chooseIssuer ?? defaultChooseIssuer(webId);
    const chosen = await choose(issuers);
    return new URL(chosen);
  }

  async matches(): Promise<boolean> {
    return true;
  }

  /**
   * The WebID the current authenticated session was issued FOR — the `webid`
   * claim of the id_token (Solid-OIDC), falling back to `sub` — or undefined when
   * nothing has authenticated. The redirect-login flow compares this against the
   * WebID the user asked to log in as; they MUST match before the app treats the
   * user as logged in (a token being attached is NOT, by itself, proof of THIS
   * WebID — a stale session from a prior identity would otherwise pass). The
   * returned string is the issuer-vouched identity, not the user's typed input.
   */
  authenticatedWebId(): string | undefined {
    return this.#authenticatedWebId;
  }

  /**
   * Run OIDC discovery for an issuer and return its authorization server metadata
   * — the shared first step of the popup, refresh-grant, and full-page-redirect
   * flows. Refactored out so the paths cannot drift on discovery handling.
   */
  async #discover(
    issuer: URL,
    http: { signal: AbortSignal; [oauth.allowInsecureRequests]?: true },
  ): Promise<oauth.AuthorizationServer> {
    const discoveryResponse = await oauth.discoveryRequest(issuer, http);
    return oauth.processDiscoveryResponse(issuer, discoveryResponse);
  }

  async upgrade(request: Request): Promise<Request> {
    this.#issuer ??= this.#resolveIssuer(this.#authSignal).catch((e) => {
      this.#issuer = undefined; // allow retry after cancel/failure
      throw e;
    });
    const issuer = await this.#issuer;
    const session = await this.#getSession(issuer, this.#authSignal);
    const headers = new Headers(request.headers);
    headers.set(
      "DPoP",
      await DPoP.generateProof(
        session.dpopKey,
        request.url,
        request.method,
        undefined,
        session.accessToken,
      ),
    );
    headers.set("Authorization", ["DPoP", session.accessToken].join(" "));
    return new Request(request, { headers });
  }

  /** Reuse the (possibly in-flight) session for the issuer, else run the code flow once. */
  async #getSession(issuer: URL, signal: AbortSignal): Promise<IssuerSession> {
    const cached = this.#sessions.get(issuer.href);
    if (cached) return cached;
    const pending = this.#authenticate(issuer, signal).catch((e) => {
      this.#sessions.delete(issuer.href); // failed login is retryable
      throw e;
    });
    this.#sessions.set(issuer.href, pending);
    return pending;
  }

  /**
   * The published DPoPTokenProvider flow, verbatim except for two changes
   * threaded through: the insecure-loopback option on every oauth4webapi call,
   * and a STATIC-vs-DYNAMIC client branch. Flow: discovery → client identity
   * (static Client Identifier Document when {@link WebIdDPoPTokenProviderOptions.clientId}
   * is set, else dynamic client registration) → PKCE/DPoP authorization-code
   * grant, with the `prompt=none` silent retry preserved.
   */
  async #authenticate(issuer: URL, signal: AbortSignal): Promise<IssuerSession> {
    const http = this.#httpOptions(issuer, signal);

    const authorizationServer = await this.#discover(issuer, http);

    const clientRegistration = await this.#resolveClient(
      authorizationServer,
      http,
    );

    const [registeredRedirectUri] = clientRegistration.redirect_uris as
      | string[]
      | undefined ?? [this.#callbackUri];
    const [registeredResponseType] = (clientRegistration.response_types as
      | string[]
      | undefined) ?? ["code"];

    const dpopKey = await oauth.generateKeyPair("ES256", { extractable: false });
    const dpop = oauth.DPoP({}, dpopKey);
    const codeVerifier = oauth.generateRandomCodeVerifier();
    const nonce = oauth.generateRandomNonce();
    const state = oauth.generateRandomState();

    const buildAuthorizationUrl = (withPrompt: boolean): URL => {
      const url = new URL(authorizationServer.authorization_endpoint as string);
      url.searchParams.set("client_id", clientRegistration.client_id);
      url.searchParams.set("redirect_uri", registeredRedirectUri);
      url.searchParams.set("response_type", registeredResponseType);
      // `offline_access` asks the IdP for a refresh token, so a later reopen can
      // silently refresh-grant a fresh access token (no redirect/popup). An IdP
      // that doesn't support it simply omits the refresh token — login still works.
      url.searchParams.set("scope", "openid webid offline_access");
      if (withPrompt) url.searchParams.set("prompt", "none");
      url.searchParams.set("state", state);
      url.searchParams.set("nonce", nonce);
      if (authorizationServer.code_challenge_methods_supported !== undefined) {
        if (
          authorizationServer.code_challenge_methods_supported.includes("S256")
        ) {
          url.searchParams.set("code_challenge_method", "S256");
          // challenge set asynchronously below
        } else {
          url.searchParams.set("code_challenge_method", "plain");
          url.searchParams.set("code_challenge", codeVerifier);
        }
      }
      return url;
    };

    // PKCE challenge (async) computed once and reused across prompt/no-prompt URLs.
    const usePkce =
      authorizationServer.code_challenge_methods_supported !== undefined;
    const useS256 =
      usePkce &&
      authorizationServer.code_challenge_methods_supported!.includes("S256");
    const codeChallenge = useS256
      ? await oauth.calculatePKCECodeChallenge(codeVerifier)
      : codeVerifier;

    const authorizationUrl = buildAuthorizationUrl(true);
    if (usePkce) authorizationUrl.searchParams.set("code_challenge", codeChallenge);

    let authorizationCodeParams: URLSearchParams;
    const authorizationCodeResponse = await this.#getCode(authorizationUrl, signal);
    try {
      authorizationCodeParams = oauth.validateAuthResponse(
        authorizationServer,
        clientRegistration,
        new URL(authorizationCodeResponse),
        state,
      );
    } catch (e) {
      if (
        (e instanceof oauth.AuthorizationResponseError &&
          (e.error === "interaction_required" ||
            e.error === "consent_required" ||
            e.error === "login_required")) ||
        isEssMissingIssInteractionNeeded(e)
      ) {
        // The IdP needs the user to interact: retry once without `prompt=none`.
        const retryUrl = buildAuthorizationUrl(false);
        if (usePkce) retryUrl.searchParams.set("code_challenge", codeChallenge);
        const retryResponse = await this.#getCode(retryUrl, signal);
        authorizationCodeParams = oauth.validateAuthResponse(
          authorizationServer,
          clientRegistration,
          new URL(retryResponse),
          state,
        );
      } else {
        throw e;
      }
    }

    const tokenResponse = await oauth.authorizationCodeGrantRequest(
      authorizationServer,
      clientRegistration,
      this.#clientAuth(authorizationServer.issuer, clientRegistration),
      authorizationCodeParams,
      this.#callbackUri,
      usePkce ? codeVerifier : oauth.nopkce,
      { DPoP: dpop, ...http },
    );
    const tokenResult = await oauth.processAuthorizationCodeResponse(
      authorizationServer,
      clientRegistration,
      tokenResponse,
      { expectedNonce: this.#nonceVerification(authorizationServer.issuer, nonce) },
    );

    const session: IssuerSession = {
      authorizationServer,
      clientRegistration,
      dpopKey,
      accessToken: tokenResult.access_token,
      refreshToken: tokenResult.refresh_token,
    };
    // Record the identity the OP vouched for (the popup path), so a caller that
    // wants to confirm identity can read authenticatedWebId() consistently with
    // the redirect path. The popup path's own callers gate on the probe result.
    this.#authenticatedWebId = webIdFromClaims(oauth.getValidatedIdTokenClaims(tokenResult));
    this.#emitSession(session);
    return session;
  }

  /**
   * Re-establish a session SILENTLY from a previously persisted refresh token
   * (pss-203m): a refresh-grant token request bound to the SAME DPoP key — no
   * redirect, no popup, no iframe. On success the issuer session is seeded so the
   * next pod fetch is already authenticated; the (possibly rotated) refresh token
   * is re-emitted for persistence. Throws on a dead/invalid token so the caller
   * can fall back to a fresh login (see `classifyRestoreError`).
   */
  async restore(seed: SeedSession): Promise<void> {
    const issuer = new URL(seed.issuer);
    const pending = this.#refreshGrant(issuer, seed).catch((e) => {
      this.#sessions.delete(issuer.href); // a failed restore is retryable / falls back
      throw e;
    });
    this.#sessions.set(issuer.href, pending);
    // Pre-seed issuer resolution so `upgrade()` doesn't re-prompt for the WebID.
    this.#issuer ??= Promise.resolve(issuer);
    await pending;
  }

  /** The refresh-grant exchange: refresh token → fresh DPoP-bound access token. */
  async #refreshGrant(issuer: URL, seed: SeedSession): Promise<IssuerSession> {
    const http = this.#httpOptions(issuer, this.#authSignal);
    const authorizationServer = await this.#discover(issuer, http);
    const dpop = oauth.DPoP({}, seed.dpopKey);
    const response = await oauth.refreshTokenGrantRequest(
      authorizationServer,
      seed.client,
      this.#clientAuth(authorizationServer.issuer, seed.client),
      seed.refreshToken,
      { DPoP: dpop, ...http },
    );
    const result = await oauth.processRefreshTokenResponse(authorizationServer, seed.client, response);
    const session: IssuerSession = {
      authorizationServer,
      clientRegistration: seed.client,
      dpopKey: seed.dpopKey,
      accessToken: result.access_token,
      // The IdP MAY rotate the refresh token; keep the new one if present, else reuse.
      refreshToken: result.refresh_token ?? seed.refreshToken,
    };
    this.#emitSession(session);
    return session;
  }

  /** Hand the app a restorable snapshot of a freshly established session. */
  #emitSession(session: IssuerSession): void {
    if (!this.#onSession) return;
    this.#onSession({
      issuer: session.authorizationServer.issuer,
      client: session.clientRegistration,
      dpopKey: session.dpopKey,
      refreshToken: session.refreshToken,
    });
  }

  // ── Two-phase FULL-PAGE redirect login (Pod-Manager autologin) ─────────────
  //
  // These are NEW code paths for the autologin deep-link; the popup #authenticate
  // / upgrade / refresh-grant are untouched. A full-page redirect destroys all
  // in-memory state, so the two phases PERSIST the in-between state (the DPoP key
  // exported to JWK + PKCE verifier + state + nonce) to sessionStorage.

  /**
   * PHASE 1 of the full-page-redirect (autologin) login. Resolves the issuer from
   * the pending WebID (via the same `#resolveIssuer` path the popup uses), runs
   * discovery + client resolution, generates an **EXTRACTABLE** ES256 DPoP keypair
   * + PKCE verifier + `state` + `nonce`, builds the authorization URL with
   * `prompt=none` (silent SSO), and PERSISTS to sessionStorage everything
   * {@link completeRedirectLogin} needs to resume after the redirect erases all
   * in-memory state. Returns the authorization URL the caller navigates to
   * (`location.assign`).
   *
   * Differences from the popup `#authenticate` (deliberate, per the redirect path):
   *  - the DPoP key is `extractable: true` so it can be exported to JWK + persisted
   *    + re-imported after the redirect (the popup key stays `extractable: false`);
   *  - scope is `openid webid offline_access` so the redirect path obtains a refresh
   *    token (the app already persists it for silent restore);
   *  - redirect_uri is the app-root `redirectReturnUri` the caller passes (the page
   *    that re-runs SolidSessionProvider and can read `?code&state`), NOT the popup's
   *    `#callbackUri` (callback.html only does postMessage and does not run the app).
   *
   * @param redirectReturnUri the app-root URL the broker redirects back to; it MUST
   *   be one of the client document's registered `redirect_uris`, and is persisted +
   *   reused VERBATIM in the token exchange (the two must match byte-for-byte).
   */
  async beginRedirectLogin(redirectReturnUri: string): Promise<{ authorizationUrl: string }> {
    const signal = this.#authSignal;
    const issuer = await this.#resolveIssuer(signal);
    const http = this.#httpOptions(issuer, signal);
    const authorizationServer = await this.#discover(issuer, http);
    // Register the app-root return URI (the redirect lands on the app, not
    // callback.html) so the OP accepts it on the dynamic-registration path.
    const clientRegistration = await this.#resolveClient(
      authorizationServer,
      http,
      redirectReturnUri,
    );

    // EXTRACTABLE so the key survives the full-page redirect (exported to JWK,
    // persisted, re-imported in completeRedirectLogin). The popup path's key stays
    // non-extractable — this is the ONE place we export a DPoP key, and only because
    // the redirect erases the closure that would otherwise hold it.
    const dpopKey = await oauth.generateKeyPair("ES256", { extractable: true });
    const dpopPrivateJwk = await crypto.subtle.exportKey("jwk", dpopKey.privateKey);
    const dpopPublicJwk = await crypto.subtle.exportKey("jwk", dpopKey.publicKey);

    const codeVerifier = oauth.generateRandomCodeVerifier();
    const nonce = oauth.generateRandomNonce();
    const state = oauth.generateRandomState();

    const usePkce = authorizationServer.code_challenge_methods_supported !== undefined;
    const useS256 =
      usePkce && authorizationServer.code_challenge_methods_supported!.includes("S256");
    const codeChallenge = useS256
      ? await oauth.calculatePKCECodeChallenge(codeVerifier)
      : codeVerifier;

    const authorizationUrl = new URL(authorizationServer.authorization_endpoint as string);
    authorizationUrl.searchParams.set("client_id", clientRegistration.client_id);
    authorizationUrl.searchParams.set("redirect_uri", redirectReturnUri);
    authorizationUrl.searchParams.set("response_type", "code");
    // offline_access so the redirect path can mint a refresh token (silent restore).
    authorizationUrl.searchParams.set("scope", "openid webid offline_access");
    // prompt=none makes autologin SILENT-with-fallback: a live OP session returns
    // the code without showing an interactive page; an ABSENT session makes the OP
    // return ?error=login_required (or interaction_required/consent_required) which
    // SolidSessionProvider's OIDC-error abort path catches to clean up + fall back to
    // the normal interactive login. Without it the redirect would render an
    // interactive IdP page on autologin (no SSO session), and that abort path would
    // be unreachable. The popup path keeps its own two-attempt prompt=none→retry
    // logic (buildAuthorizationUrl) and is intentionally NOT touched here.
    authorizationUrl.searchParams.set("prompt", "none");
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("nonce", nonce);
    if (usePkce) {
      authorizationUrl.searchParams.set("code_challenge_method", useS256 ? "S256" : "plain");
      authorizationUrl.searchParams.set("code_challenge", codeChallenge);
    }

    const flow: PersistedRedirectFlow = {
      dpopPrivateJwk,
      dpopPublicJwk,
      codeVerifier,
      usePkce,
      state,
      nonce,
      issuer: issuer.href,
      clientId: clientRegistration.client_id,
      redirectUri: redirectReturnUri,
      webId: validateWebId(await this.#getWebId()),
    };
    try {
      globalThis.sessionStorage.setItem(REDIRECT_FLOW_KEY, JSON.stringify(flow));
    } catch (e) {
      throw new Error(
        `Could not persist the redirect login state to sessionStorage: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    return { authorizationUrl: authorizationUrl.toString() };
  }

  /**
   * ABORT a pending full-page-redirect login WITHOUT attempting a token exchange.
   * Called when the broker bounces back with an OAuth `?error` (it declined silent
   * SSO, or the user declined): there is no `code` to exchange, so the only work is
   * to DROP the persisted record — which carries the single-use PKCE verifier + the
   * exported DPoP private key — so neither can be replayed. Idempotent + side-effect
   * free beyond clearing sessionStorage; no network call (distinct from
   * {@link completeRedirectLogin}, which would needlessly run discovery first).
   */
  abortRedirectLogin(): void {
    clearPersistedRedirectFlow();
  }

  /**
   * PHASE 2 of the full-page-redirect (autologin) login, run on the page the broker
   * redirected back to (the app root, carrying `?code&state`). Reads the persisted
   * record, RE-IMPORTS the DPoP JWK + reconstructs `oauth.DPoP`, validates the auth
   * response against the persisted `state`, exchanges the code (DPoP-bound, with the
   * persisted `nonce` expected), ENFORCES that the OP authenticated AS the requested
   * WebID (fail-closed THROW before any session/issuer state is written), then
   * ESTABLISHES the session in `#sessions` (so the patched global fetch upgrades
   * subsequent reads) and seeds `#issuer` + `#authenticatedWebId`, emitting the
   * restorable session for persistence.
   *
   * It CLEARS the persisted record in a `finally` (success OR failure) so a refresh
   * / back-button cannot replay it. On any failure it throws and leaves NO
   * half-established session.
   *
   * @param callbackUrl the full return URL (`location.href`) with `?code&state`.
   * @returns the verified WebID + issuer, so the caller can land the session.
   */
  async completeRedirectLogin(callbackUrl: string): Promise<RedirectLoginResult> {
    const flow = readPersistedRedirectFlow();
    if (!flow) {
      throw new Error("No pending redirect login to complete (no persisted state found).");
    }
    const signal = this.#authSignal;
    try {
      const issuer = new URL(flow.issuer);
      const http = this.#httpOptions(issuer, signal);
      const authorizationServer = await this.#discover(issuer, http);

      const clientRegistration: oauth.Client = {
        client_id: flow.clientId,
        token_endpoint_auth_method: "none",
        redirect_uris: [flow.redirectUri],
        response_types: ["code"],
      };

      // Re-import the persisted ES256 DPoP key (extractable so it survived the
      // redirect) and rebuild the DPoP handle for the token exchange.
      const privateKey = await crypto.subtle.importKey(
        "jwk",
        flow.dpopPrivateJwk,
        ES256_IMPORT_ALG,
        true,
        ["sign"],
      );
      const publicKey = await crypto.subtle.importKey(
        "jwk",
        flow.dpopPublicJwk,
        ES256_IMPORT_ALG,
        true,
        ["verify"],
      );
      const dpopKey: CryptoKeyPair = { privateKey, publicKey };
      const dpop = oauth.DPoP(clientRegistration, dpopKey);

      // Validate the auth response against the PERSISTED state (CSRF/mix-up guard).
      const authorizationCodeParams = oauth.validateAuthResponse(
        authorizationServer,
        clientRegistration,
        new URL(callbackUrl),
        flow.state,
      );

      const tokenResponse = await oauth.authorizationCodeGrantRequest(
        authorizationServer,
        clientRegistration,
        this.#clientAuth(authorizationServer.issuer, clientRegistration),
        authorizationCodeParams,
        // The redirect_uri MUST match the one sent in the authorization request.
        flow.redirectUri,
        flow.usePkce ? flow.codeVerifier : oauth.nopkce,
        { DPoP: dpop, ...http },
      );
      const tokenResult = await oauth.processAuthorizationCodeResponse(
        authorizationServer,
        clientRegistration,
        tokenResponse,
        { expectedNonce: this.#nonceVerification(authorizationServer.issuer, flow.nonce) },
      );

      const authenticatedWebId = webIdFromClaims(oauth.getValidatedIdTokenClaims(tokenResult));
      // SECURITY (invariant a — cross-identity guard, fail-closed): the OP may have
      // an active session for a DIFFERENT account that satisfies this deep-link, so
      // the id_token's WebID is NOT necessarily the one the user asked to log in as.
      // PROVE the OP authenticated AS the persisted requested WebID (`flow.webId`)
      // BEFORE writing ANY provider state. `webIdsEqual` returns false if either side
      // is missing/unparseable, so an absent webId (token OR persisted record) fails
      // closed. The `finally` clears the persisted record, so this throw leaves the
      // provider with NO seeded session / issuer / authenticatedWebId.
      if (!webIdsEqual(authenticatedWebId, flow.webId)) {
        throw new Error(
          "Login did not complete — the identity provider authenticated a different " +
            `WebID (${authenticatedWebId ?? "unknown"}) than the one requested ` +
            `(${flow.webId}). For your security you were not logged in.`,
        );
      }

      const session: IssuerSession = {
        authorizationServer,
        clientRegistration,
        dpopKey,
        accessToken: tokenResult.access_token,
        refreshToken: tokenResult.refresh_token,
      };
      // INVARIANT (b): seed BOTH the per-issuer SESSION and the resolved ISSUER
      // before publishing, so later upgrades (data fetches on the now-authenticated
      // page) REUSE this session instead of falling into #resolveIssuer → getWebId()
      // (which has no pending WebID after the full-page redirect and would throw).
      this.#sessions.set(issuer.href, Promise.resolve(session));
      this.#issuer = Promise.resolve(issuer);
      this.#authenticatedWebId = authenticatedWebId;
      // Emit the restorable session so the app persists the refresh token for a
      // later silent restore (same channel the popup + refresh-grant paths use).
      this.#emitSession(session);
      return { webId: authenticatedWebId as string, issuer: issuer.href };
    } finally {
      // Clear the persisted record whether we succeeded OR failed, so a refresh /
      // back-button can never replay the (single-use) code + verifier + key.
      clearPersistedRedirectFlow();
    }
  }

  /**
   * Resolve the OAuth client used for this issuer.
   *
   * - **Static (a Client Identifier Document):** when `clientId` is set, return a
   *   public {@link oauth.Client} whose `client_id` IS that URL, with
   *   `token_endpoint_auth_method: "none"`. No network call is made here — the OP
   *   dereferences the document itself at the authorization/token endpoints and
   *   matches the redirect_uri against the document's `redirect_uris`. The
   *   document must therefore list this provider's `callbackUri`. `redirect_uris`
   *   and `response_types` are seeded locally so the shared URL-building code
   *   below has the values it needs.
   * - **Dynamic (the default):** dynamic client registration, exactly as the
   *   published provider does — a throwaway client per session, no stable name.
   */
  async #resolveClient(
    authorizationServer: oauth.AuthorizationServer,
    http: { signal: AbortSignal; [oauth.allowInsecureRequests]?: true },
    /**
     * An EXTRA redirect URI to register alongside the popup `#callbackUri`. The
     * full-page-redirect (autologin) flow returns to the APP ROOT, not callback.html,
     * so it passes that app-root URI here — the OP rejects a redirect_uri it was
     * never told about, so for the DYNAMIC-registration (localhost) path it must be
     * registered. For the STATIC client-id path the document itself must list it
     * (see clientid.jsonld/route.ts FIX-1); the locally-seeded list is mirrored here
     * for the URL builder, but the OP is authoritative off the document.
     */
    extraRedirectUri?: string,
  ): Promise<oauth.Client> {
    const redirectUris =
      extraRedirectUri && extraRedirectUri !== this.#callbackUri
        ? [this.#callbackUri, extraRedirectUri]
        : [this.#callbackUri];
    if (this.#clientId !== undefined) {
      // A public browser client identified by a dereferenceable URL. `oauth.Client`
      // requires only `client_id`; the rest are accepted via its index signature
      // and consumed by the shared authorization-URL builder below.
      return {
        client_id: this.#clientId,
        token_endpoint_auth_method: "none",
        redirect_uris: redirectUris,
        response_types: ["code"],
      };
    }
    const registrationResponse = await oauth.dynamicClientRegistrationRequest(
      authorizationServer,
      { redirect_uris: redirectUris },
      http,
    );
    return oauth.processDynamicClientRegistrationResponse(registrationResponse);
  }

  /** Client authentication, mirroring the published provider's ESS workaround. */
  #clientAuth(issuer: string, client: oauth.Client): oauth.ClientAuth {
    if (client.token_endpoint_auth_method === "client_secret_basic") {
      return clientSecretBasicFor(issuer)(client.client_secret as string);
    }
    return oauth.None();
  }

  /** Some servers (NSS/ESS variants) omit the nonce; expect none for them. */
  #nonceVerification(issuer: string, nonce: string): string | typeof oauth.expectNoNonce {
    if (issuer === "https://datapod.igrant.io" || issuer === "https://solidweb.org") {
      return oauth.expectNoNonce;
    }
    return nonce;
  }
}

function isEssMissingIssInteractionNeeded(e: unknown): boolean {
  try {
    return (
      (e as { cause: { parameters: URLSearchParams } }).cause.parameters.get(
        "error",
      ) === "interaction_required"
    );
  } catch {
    return false;
  }
}

/**
 * A variant of oauth4webapi's ClientSecretBasic that does NOT url-encode id and
 * secret — PodSpaces (ESS) fails when the spec is followed.
 * @see https://www.rfc-editor.org/rfc/rfc6749.html#section-2.3.1
 */
function noUrlEncodeClientSecretBasic(clientSecret: string): oauth.ClientAuth {
  return (_as, client, _body, headers) => {
    headers.set(
      "Authorization",
      `Basic ${btoa(`${client.client_id}:${clientSecret}`)}`,
    );
  };
}

function clientSecretBasicFor(issuer: string): (secret: string) => oauth.ClientAuth {
  if (issuer.includes("login.inrupt.com")) return noUrlEncodeClientSecretBasic;
  return oauth.ClientSecretBasic;
}

/**
 * Reference default `getWebId`: a native `<dialog>` + `<input type="url">` asking
 * for the user's WebID (the WebID-first entry from the skill UX spec). Returns
 * the entered WebID, or rejects if the user cancels. Browser-only.
 */
export function promptWebIdDialog(initialValue = ""): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("part", "webid dialog");
    dialog.innerHTML = `
      <form method="dialog" style="display:flex;flex-direction:column;gap:.75rem;min-width:20rem">
        <label for="webid-input" style="font-weight:600">Your WebID</label>
        <input id="webid-input" name="webid" type="url" required
          placeholder="https://you.example/profile/card#me"
          style="padding:.5rem;border:1px solid #ccc;border-radius:.375rem" />
        <div style="display:flex;gap:.5rem;justify-content:flex-end">
          <button type="button" value="cancel" data-action="cancel">Cancel</button>
          <button type="submit" value="continue" data-action="continue">Continue</button>
        </div>
      </form>`;
    const input = dialog.querySelector<HTMLInputElement>("#webid-input")!;
    input.value = initialValue;
    let settled = false;
    const cleanup = () => {
      dialog.remove();
    };
    dialog
      .querySelector<HTMLButtonElement>('[data-action="cancel"]')!
      .addEventListener("click", () => {
        settled = true;
        dialog.close();
        cleanup();
        reject(new DOMException("WebID entry cancelled", "AbortError"));
      });
    dialog.addEventListener("cancel", () => {
      // Escape key: a cancellation, never a submission (even with a prefilled value).
      settled = true;
      cleanup();
      reject(new DOMException("WebID entry cancelled", "AbortError"));
    });
    dialog.addEventListener("close", () => {
      if (settled) return;
      settled = true;
      const value = dialog.returnValue === "continue" ? input.value.trim() : "";
      cleanup();
      if (value) resolve(value);
      else reject(new DOMException("WebID entry cancelled", "AbortError"));
    });
    document.body.appendChild(dialog);
    dialog.showModal();
  });
}
