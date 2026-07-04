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
   * patches the global) — see the recursion note in the class docs.
   *
   * ALSO the default for {@link oauthFetch}: the app pins this to the
   * construction-time pristine snapshot, which keeps BOTH the profile read AND
   * the provider's own OIDC traffic out of the patched-global loop.
   */
  profileFetch?: typeof fetch;
  /**
   * The fetch carrying the provider's OWN OIDC/OAuth HTTP requests — discovery,
   * dynamic client registration, and the authorization-code/refresh token grants
   * (threaded through oauth4webapi's `[oauth.customFetch]`). Defaults to
   * {@link profileFetch} (and, like it, ultimately to the construction-time
   * `globalThis.fetch`).
   *
   * MUST be an out-of-loop (pristine) fetch whenever the app patches the global
   * fetch with a reactive/proactive auth transport whose credential boundary
   * includes the ISSUER's origin. If these requests ride the PATCHED global
   * instead, the patched fetch re-enters `provider.upgrade()` for the request,
   * which single-flights onto the very `#authenticate()` promise that ISSUED
   * it — a circular await that stalls interactive login forever, after the
   * WebID profile read and before the OIDC popup ever opens (the login-stall
   * bug). Pinning does not change WHAT is sent (DPoP proofs / tokens are
   * untouched), only WHICH transport carries it.
   */
  oauthFetch?: typeof fetch;
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

/**
 * An in-flight `upgrade()` resolved AFTER a {@link WebIdDPoPTokenProvider.reset}
 * (logout / new login) advanced the provider's generation. The result belongs to
 * a superseded identity, so the upgrade is rejected with this error and writes no
 * provider state — preventing a prior identity's token/claim from contaminating
 * the next attempt.
 */
export class ReactiveAuthResetError extends Error {
  constructor() {
    super("Authentication was reset (logout or a new login started) while this request was upgrading.");
    this.name = "ReactiveAuthResetError";
  }
}

/**
 * Thrown by {@link WebIdDPoPTokenProvider.abortRedirectLogin} ONLY when an OIDC error
 * callback's `state` VALIDATED against the persisted redirect record — i.e. the broker
 * genuinely declined THIS in-flight redirect login (or the user declined). When this
 * is thrown the provider has already cleared the persisted record + reset its state, so
 * the caller may clear the loop-guard sentinel + clean the URL and surface the error.
 *
 * Any OTHER throw from `abortRedirectLogin` (a `state` mismatch — a forged/stray
 * `?error&state`, or a generation reset) means the callback did NOT belong to the
 * pending flow: the record + provider state are LEFT INTACT, and the caller must NOT
 * tear down the legitimate in-flight login. Distinguishing the two by TYPE (not a
 * string match) is what makes the abort path fail-closed against a forged error return.
 */
export class RedirectAbortedError extends Error {
  /** The OAuth `error` code from the validated error response (e.g. `login_required`). */
  readonly oauthError: string;
  constructor(message: string, oauthError: string) {
    super(message);
    this.name = "RedirectAbortedError";
    this.oauthError = oauthError;
  }
}

/** The default issuer policy: single → it; several → throw (never pick silently). */
function defaultChooseIssuer(webId: string): ChooseIssuerCallback {
  return async (issuers: string[]) => {
    if (issuers.length === 1) return issuers[0];
    throw new AmbiguousIssuerError(webId, issuers);
  };
}

/**
 * sessionStorage key under which the two-phase REDIRECT autologin flow persists
 * its in-between state across the full-page Solid-OIDC redirect. Single key, one
 * JSON record ({@link PersistedRedirectFlow}). Cleared as soon as consumed (success
 * OR failure) and by {@link WebIdDPoPTokenProvider.reset}.
 *
 * WHY sessionStorage (and why this is the standard SPA redirect-PKCE+DPoP pattern):
 *  - A FULL-PAGE redirect destroys all in-memory closure state (the DPoP key, PKCE
 *    verifier, state, nonce that `#authenticate()` holds for the popup path). The
 *    redirect path must therefore persist those across the navigation.
 *  - sessionStorage is PER-TAB and SAME-ORIGIN, and is cleared when the tab closes —
 *    so the record never outlives the browsing session and is never shared with
 *    another origin. The `state` is verified on return (oauth.validateAuthResponse
 *    against the persisted state), so a tampered/forged callback cannot be replayed.
 *  - The DPoP private JWK is persisted because the token exchange after the redirect
 *    must reuse the SAME key whose public thumbprint the OP bound the code to; a
 *    fresh key would make the DPoP-bound code exchange fail. The key is generated
 *    EXTRACTABLE (only for this path) so it can round-trip through JWK; the popup
 *    path keeps its key non-extractable.
 *  - The record is consumed and CLEARED immediately (success OR failure), so a stale
 *    pending flow can never satisfy a later, unrelated callback.
 */
export const REDIRECT_FLOW_STORAGE_KEY = "solid.autologin.flow";

/**
 * The persisted in-between state for the two-phase redirect autologin flow, written
 * to sessionStorage under {@link REDIRECT_FLOW_STORAGE_KEY} by
 * {@link WebIdDPoPTokenProvider.beginRedirectLogin} and read back by
 * {@link WebIdDPoPTokenProvider.completeRedirectLogin}. Everything here is what the
 * completion phase needs to finish the DPoP-bound authorization-code exchange after
 * the full-page redirect has destroyed in-memory state.
 */
export interface PersistedRedirectFlow {
  /** The issuer's href; discovery is re-run from it in the completion phase. */
  issuer: string;
  /**
   * The resolved OAuth client used for the authorization request — it MUST be reused
   * verbatim for the token exchange (the broker validated `redirect_uri` against this
   * client's registration). For the dynamic path this is the registration result
   * (registered with BOTH the popup callback and the full-page return URI in
   * `redirect_uris`); for the static path it is the Client Identifier Document client.
   */
  client: oauth.Client;
  /** The exported DPoP private key JWK (re-imported via WebCrypto in the completion). */
  dpopPrivateJwk: JsonWebKey;
  /** The exported DPoP public key JWK (re-imported so `oauth.DPoP` has the pair). */
  dpopPublicJwk: JsonWebKey;
  /** The PKCE code_verifier (S256 challenge was sent in the authorization request). */
  codeVerifier: string;
  /** The OAuth `state` — verified against the callback via oauth.validateAuthResponse. */
  state: string;
  /** The OIDC `nonce` — the expected nonce in processAuthorizationCodeResponse. */
  nonce: string;
  /** The exact full-page `redirect_uri` used in the authorization request. */
  redirectUri: string;
  /** The WebID the user asked to log in as (the deep-link target). */
  webId: string;
}

/** Per-issuer session state cached so repeat upgrades don't re-prompt. */
interface IssuerSession {
  authorizationServer: oauth.AuthorizationServer;
  clientRegistration: oauth.Client;
  dpopKey: CryptoKeyPair;
  accessToken: string;
  /**
   * The WebID this session actually authenticated AS — the `webid` claim of the
   * id_token (Solid-OIDC), falling back to `sub`. This is the identity the OP
   * vouched for, NOT the WebID the user typed; the login flow MUST confirm the
   * two agree before flipping to logged-in (see {@link WebIdDPoPTokenProvider.authenticatedWebId}).
   */
  authenticatedWebId: string | undefined;
}

const isLoopback = (host: string): boolean =>
  host === "localhost" || host === "127.0.0.1" || host === "[::1]";

/**
 * Stamp a URL with a unique, unguessable login-probe FRAGMENT
 * (`#probe-<uuid>`) — an UNFORGEABLE, off-the-wire marker that identifies the
 * single login probe to {@link WebIdDPoPTokenProvider.beginLoginProbe} /
 * {@link WebIdDPoPTokenProvider#matchActiveLoginProbe}.
 *
 * WHY A FRAGMENT (the round-4b roborev fix). The round-4 URL fallback matched a
 * probe by `probe.url === request.url`, which is FORGEABLE: any unrelated fetch
 * to the same base URL during the login window (e.g. a data-layer read of the
 * storage root) would consume the single-use fallback and spuriously satisfy
 * `wasLoginProbeUpgraded`. A fragment closes that hole because it is:
 *  - **unguessable** — a `crypto.randomUUID()`, so a non-probe request to the
 *    same resource has a DIFFERENT (or absent) fragment and cannot collide;
 *  - **survives the manager re-wrap** — `new Request(input)` preserves the URL
 *    fragment (verified), so the fallback still matches across the
 *    `ReactiveFetchManager` re-wrap that drops object identity;
 *  - **never sent on the wire** — fragments are client-side only (RFC 3986
 *    §3.5): no header, no query, no CORS preflight, and the OP fetches the exact
 *    same resource. So this is purely an in-process marker that rides safely on
 *    the URL the manager already preserves.
 *
 * Exported so the (browser-only) login flow and the unit tests build probes the
 * same way.
 */
export function withProbeFragment(url: string): string {
  const u = new URL(url);
  u.hash = `probe-${crypto.randomUUID()}`;
  return u.toString();
}

/**
 * RFC 9449 §4.2 `htu`: the request URI with query AND fragment removed. The probe
 * carries a `#probe-<uuid>` in-process marker ({@link withProbeFragment}) that is
 * NEVER sent on the wire (RFC 3986 §3.5); it MUST be stripped here or the DPoP
 * proof's `htu` claim won't match the `htu` the resource server computes from the
 * received request URI (which it derives with query and fragment removed). The
 * `dpop` package uses its second argument as the `htu` VERBATIM (no stripping), so
 * a fragment/query left on the URL would leak into the proof and the server would
 * reject the retried probe's token in production.
 */
export function httpUri(url: string): string {
  const u = new URL(url);
  u.hash = "";
  u.search = "";
  return u.toString();
}

/**
 * The single per-login probe record this provider tracks at a time, captured by
 * {@link WebIdDPoPTokenProvider.beginLoginProbe} just before the login flow fetches
 * its probe. It carries:
 *  - `generation` — the provider generation in effect when the probe began, so a
 *    {@link WebIdDPoPTokenProvider.reset} that supersedes the login invalidates the
 *    record by advancing the generation (the flow snapshots the same generation and
 *    asks {@link WebIdDPoPTokenProvider.wasLoginProbeUpgraded} for it).
 *  - `url` — the probe's FULL URL INCLUDING its unguessable `#probe-<uuid>`
 *    fragment ({@link withProbeFragment}), the only property that survives the
 *    manager's `new Request(input)` re-wrap. Because the fragment is unguessable
 *    and never sent on the wire, an unrelated same-resource request CANNOT forge
 *    a match. Used as a SINGLE-USE fallback channel, consumed on first match
 *    (defence-in-depth) so even a same-fragment upgrade fires at most once.
 *  - `object` — a {@link WeakRef} to the EXACT Request object, the precise primary
 *    channel that matches when no re-wrap happens (unit tests / non-wrapping
 *    managers). Weak so it never pins the Request in memory.
 *  - `urlConsumed` — set once the single-use URL fallback has matched, so the URL
 *    channel fires for exactly one upgrade.
 */
interface LoginProbe {
  generation: number;
  url: string;
  object: WeakRef<Request>;
  urlConsumed: boolean;
}

export class WebIdDPoPTokenProvider implements TokenProvider {
  readonly #callbackUri: string;
  readonly #getCode: GetCodeCallback;
  readonly #getWebId: GetWebIdCallback;
  readonly #clientId?: string;
  readonly #chooseIssuer?: ChooseIssuerCallback;
  readonly #allowInsecureLoopback: boolean;
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
   * The out-of-loop fetch for the provider's OWN OIDC requests (discovery /
   * registration / token grant) — see
   * {@link WebIdDPoPTokenProviderOptions.oauthFetch}. Passed to every
   * oauth4webapi call as `[oauth.customFetch]` so none of them ride a patched
   * global fetch back into `upgrade()` (the login-stall deadlock).
   */
  readonly #oauthFetch: typeof fetch;
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
   * Monotonic count of how many times {@link upgrade} has actually MINTED +
   * ATTACHED a DPoP/Authorization header to a request. This is the proof that an
   * auth flow ran — but, crucially, it is a *running total*, NOT a sticky "ever
   * established" flag.
   *
   * Why a counter and not a boolean: a boolean is sticky — once any prior
   * `upgrade()` set it, it stays set forever, so a LATER login attempt whose
   * probe hits a PUBLIC 200 (no `upgrade()` ran for THAT probe) would still see
   * the flag set by the earlier session and be wrongly accepted as logged in
   * (the "public 200 = logged in" bug, reintroduced after logout→re-login or a
   * prior rejected probe). With a counter, a login attempt snapshots the count
   * BEFORE its probe and checks it INCREASED after — proving a token was attached
   * during THIS attempt, never inferring it from a flag a previous session left.
   */
  #tokensAttached = 0;
  /**
   * The WebID the most-recently-established session actually authenticated AS
   * (the `webid`/`sub` claim of its id_token), or undefined when no session has
   * been established since the last {@link reset}. The login flow reads this to
   * PROVE the authenticated identity matches the WebID the user asked to log in
   * as — never inferring "logged in" from merely "a token is attached". Cleared
   * by {@link reset} so a prior identity cannot survive a logout / re-login.
   */
  #authenticatedWebId: string | undefined;
  /**
   * The single ACTIVE login probe, captured by {@link beginLoginProbe} right before
   * the login flow fetches its probe and cleared by {@link endLoginProbe} (and by
   * {@link reset}). There is at most one because the SolidAuthProvider single-flights
   * login — overlapping/double-clicked logins can no longer register competing
   * probes. {@link upgrade} matches the request it is handed against this record (by
   * object identity first, else a single-use, generation-scoped URL fallback) and,
   * on a real token attach, records the generation into
   * {@link #probeUpgradedGeneration}. Null when no login is in flight.
   */
  #loginProbe: LoginProbe | null = null;
  /**
   * The generation in which the active login probe was actually token-upgraded, or
   * null if it has not been (yet). The login flow snapshots its generation via
   * {@link loginGeneration} after {@link reset} and asserts
   * {@link wasLoginProbeUpgraded} for that snapshot — so a probe upgrade only counts
   * within its own login's generation, and a {@link reset} (which advances the
   * generation AND nulls this) cannot let a stale upgrade satisfy a new login.
   */
  #probeUpgradedGeneration: number | null = null;
  /**
   * A per-attempt GENERATION (epoch) counter that fences in-flight auth work
   * across a {@link reset}. {@link reset} increments it; an `upgrade()` /
   * `#authenticate()` already running captures the generation at its start and,
   * before mutating ANY provider state (`#sessions`, `#authenticatedWebId`,
   * `#tokensAttached`, `#upgradedProbeIds`), checks the generation is still
   * current. If a logout / new-login `reset()` advanced it mid-flight, the stale
   * result is discarded and NO state is written (`#sessions`, `#authenticatedWebId`,
   * `#tokensAttached`, `#probeUpgradedGeneration`) — so a login or upgrade that
   * began before the reset cannot contaminate the next identity's clean baseline.
   */
  #generation = 0;
  /**
   * Shared auth work (issuer resolution, login) is provider-owned: it must NOT
   * be tied to any single request's AbortSignal, or aborting one request would
   * cancel the login other concurrent 401 upgrades are waiting on. The user
   * cancels via the dialog/popup themselves, which rejects the shared promise.
   *
   * It is replaced on every {@link reset} (and any controller it replaces is
   * aborted) so in-flight auth work spawned by a prior identity is actively
   * cancelled, not merely fenced out after the fact.
   */
  #authController = new AbortController();

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
    this.#profileFetch =
      options.profileFetch ?? globalThis.fetch.bind(globalThis);
    this.#oauthFetch = options.oauthFetch ?? this.#profileFetch;
  }

  /**
   * oauth4webapi request options: pin every OIDC request to the out-of-loop
   * {@link #oauthFetch} (NEVER the patched global — the re-entrancy deadlock),
   * and enable insecure loopback per the policy.
   */
  #httpOptions(
    issuer: URL,
    signal: AbortSignal,
  ): {
    signal: AbortSignal;
    [oauth.customFetch]: typeof fetch;
    [oauth.allowInsecureRequests]?: true;
  } {
    if (this.#allowInsecureLoopback && isLoopback(issuer.hostname)) {
      return {
        signal,
        [oauth.customFetch]: this.#oauthFetch,
        [oauth.allowInsecureRequests]: true,
      };
    }
    return { signal, [oauth.customFetch]: this.#oauthFetch };
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
   * The running total of requests this provider has minted + attached a token to
   * via {@link upgrade}. NOT a boolean "ever logged in" flag — it is read as a
   * BEFORE/AFTER pair around a single login attempt: a login attempt snapshots
   * this count, runs its probe, and re-reads it; an INCREASE proves a token was
   * attached during THAT attempt. This is what makes login detection
   * per-attempt rather than sticky — a prior session's attachments are already
   * counted, so they do not make a later token-less probe look authenticated.
   */
  tokensAttachedCount(): number {
    return this.#tokensAttached;
  }

  /**
   * The WebID the current authenticated session was issued FOR — the `webid`
   * claim of the id_token (Solid-OIDC), falling back to `sub` — or undefined
   * when nothing has authenticated since the last {@link reset}. The login flow
   * compares this against the WebID the user asked to log in as; they MUST match
   * before the app treats the user as logged in (a token being attached is NOT,
   * by itself, proof of THIS WebID — a stale session from a prior identity would
   * otherwise pass). The returned string is the issuer-vouched identity, not the
   * user's typed input.
   */
  authenticatedWebId(): string | undefined {
    return this.#authenticatedWebId;
  }

  /**
   * The CURRENT provider generation. The login flow snapshots this AFTER its
   * {@link reset} (so it gets the new identity's clean generation) and passes the
   * snapshot to {@link wasLoginProbeUpgraded} — making the per-probe proof scoped to
   * THIS login's generation, immune to a later {@link reset}.
   */
  loginGeneration(): number {
    return this.#generation;
  }

  /**
   * Register the active login probe just before the login flow fetches it. Captures
   * the CURRENT generation, the FULL request URL — which MUST include the
   * unguessable `#probe-<uuid>` fragment ({@link withProbeFragment}) so the URL
   * fallback is unforgeable — and a {@link WeakRef} to the EXACT Request object
   * (the precise primary channel). There is at most one active probe at a time —
   * the SolidAuthProvider single-flights login, so there is never a competing
   * registration. Cleared by {@link endLoginProbe} / {@link reset}.
   */
  beginLoginProbe(request: Request): void {
    this.#loginProbe = {
      generation: this.#generation,
      url: request.url,
      object: new WeakRef(request),
      urlConsumed: false,
    };
  }

  /**
   * Clear the active login probe. Called by the login flow in its `finally` (like
   * the old `discardProbeRegistration`) so a probe that never reached {@link upgrade}
   * — e.g. a public 200 with no 401 — leaves no stale record a later same-URL
   * upgrade could consume. {@link reset} also clears it.
   */
  endLoginProbe(): void {
    this.#loginProbe = null;
  }

  /**
   * Whether THIS login's probe was actually token-upgraded by this provider, scoped
   * to the GENERATION the login captured via {@link loginGeneration}. This is the
   * PRIMARY, per-probe proof of login — strictly stronger than the provider-wide
   * token-attach count, which a concurrent upgrade for the SAME requested WebID (a
   * different request) could bump spuriously. {@link reset} advances the generation
   * AND nulls the record, so a stale upgrade can never satisfy a new login's check.
   */
  wasLoginProbeUpgraded(generation: number): boolean {
    return this.#probeUpgradedGeneration === generation;
  }

  /**
   * Drop EVERY piece of per-identity state so nothing from a prior login can be
   * reused by the next one: the memoised issuer resolution, every cached
   * per-issuer session (its DPoP key pair + access/refresh tokens), the
   * authenticated-WebID claim, the active login probe + its upgrade record, and the
   * running token-attachment count. Also ADVANCES the generation and aborts any in-flight
   * auth controller, so an `upgrade()`/`#authenticate()` already running for the
   * prior identity is both cancelled AND fenced from writing state after it
   * resolves (see {@link #generation}).
   *
   * MUST be called on logout AND at the start of a new login. Without it, the
   * provider keeps the previous user's issuer + DPoP-bound token in memory, so a
   * login as a DIFFERENT WebID would silently reuse the prior identity's session
   * (a cross-user session leak), and a login-detection probe that only checks
   * "is a token attached" would look authenticated with the STALE token. Resetting
   * `#tokensAttached` to 0 also guarantees the per-attempt before/after delta the
   * login flow relies on starts from a clean baseline for the new identity.
   */
  reset(): void {
    // Advance the generation FIRST so any in-flight work that resolves after this
    // point sees a stale generation and writes nothing.
    this.#generation += 1;
    // Actively cancel in-flight auth work spawned by the prior identity.
    this.#authController.abort();
    this.#authController = new AbortController();
    this.#issuer = undefined;
    this.#sessions.clear();
    this.#authenticatedWebId = undefined;
    this.#loginProbe = null;
    this.#probeUpgradedGeneration = null;
    this.#tokensAttached = 0;
    // Drop any PENDING two-phase redirect-login record too: a logout or a new login
    // must abandon a stale in-flight redirect flow (its persisted DPoP key + PKCE
    // verifier + state) so a later callback can't resume a superseded identity's flow.
    clearPendingRedirectLogin();
  }

  async upgrade(request: Request): Promise<Request> {
    // Decide whether THIS request is the active login probe — on the ORIGINAL
    // request we were handed, BEFORE any clone we make below to add Authorization (a
    // clone is a different object and would not match by identity). No header is on
    // the wire; this is a pure in-process check against the per-login record, so a
    // cross-origin probe stays a "simple" request and triggers no CORS preflight.
    const isLoginProbe = this.#matchActiveLoginProbe(request);
    // Capture the generation + controller for THIS attempt up front. A concurrent
    // reset() advances the generation and swaps the controller; comparing against
    // the captured generation before any state write fences this attempt out.
    const generation = this.#generation;
    const controller = this.#authController;
    if (this.#issuer === undefined) {
      // Capture the EXACT promise we install so the catch only clears state it
      // actually owns. Without this, an OLD aborted issuer resolution rejecting
      // LATER (after a reset() advanced the generation and a NEW resolution is in
      // flight) would blindly clear `#issuer = undefined`, destroying the current
      // generation's single-flight — later requests would re-prompt or fail. The
      // catch below clears ONLY if the generation is unchanged AND `#issuer` is
      // still this same pending promise; a superseded/aborted resolution clears
      // nothing.
      const resolution: Promise<URL> = this.#resolveIssuer(controller.signal).catch((e) => {
        if (this.#generation === generation && this.#issuer === resolution) {
          this.#issuer = undefined; // allow retry after cancel/failure, current gen only
        }
        throw e;
      });
      this.#issuer = resolution;
    }
    const issuer = await this.#issuer;
    const session = await this.#getSession(issuer, generation, controller.signal);
    // FENCE: if a reset() (logout / new-login) advanced the generation while this
    // upgrade was in flight, the result belongs to a SUPERSEDED identity. Mutate
    // NO provider state and reject — the request must not carry a stale identity's
    // token, and #authenticatedWebId / #tokensAttached / #probeUpgradedGeneration
    // must stay at the new identity's clean baseline. Kept as a fail-fast BEFORE the
    // awaited proof generation below; the post-await re-fence is the load-bearing one.
    if (generation !== this.#generation) {
      throw new ReactiveAuthResetError();
    }
    // RFC 9449 §4.2: the proof's `htu` is the request URI with query AND fragment
    // removed. We strip BOTH via httpUri() because the in-process login probe carries
    // a `#probe-<uuid>` marker that never reaches the wire (RFC 3986 §3.5), so the
    // server computes `htu` from a fragment/query-less request URI; the `dpop` package
    // uses arg 2 as `htu` verbatim, so an un-stripped URL would mint a proof whose
    // `htu` the server rejects. The FULL `request.url` (fragment intact) is kept ONLY
    // for in-process probe matching (#matchActiveLoginProbe / #loginProbe.url) — the
    // returned `new Request(request, …)` below preserves the fragment on `.url`, but
    // the browser strips it on the wire, so it matches the stripped htu.
    const htu = httpUri(request.url);
    const proof = await DPoP.generateProof(
      session.dpopKey,
      htu,
      request.method,
      undefined,
      session.accessToken,
    );
    // RE-FENCE: a reset() (logout / new-login) may have fired DURING the awaited
    // proof generation above. Re-check the generation BEFORE any state write so a
    // superseded attempt attaches NO token, publishes NO identity, bumps NO counter
    // and records NO probe upgrade — leaving the next identity's baseline clean. The
    // pre-await fence stays as a fail-fast; THIS one closes the race across the await.
    if (generation !== this.#generation) {
      throw new ReactiveAuthResetError();
    }
    // Record the identity the OP vouched for, so the login flow can confirm it
    // matches the requested WebID. Set here (not only at session creation) so a
    // cached/in-flight session shared across concurrent 401s also publishes it — and
    // only AFTER the post-proof re-fence, so a raced reset publishes no identity.
    this.#authenticatedWebId = session.authenticatedWebId;
    const headers = new Headers(request.headers);
    headers.set("DPoP", proof);
    headers.set("Authorization", ["DPoP", session.accessToken].join(" "));
    // A token was minted AND attached: the auth flow ran to completion. Bump the
    // running total (only after the session resolved AND the post-proof re-fence
    // passed — a cancelled/failed/superseded flow throws above and never reaches
    // here, so the count is not bumped). The login flow reads this count BEFORE and
    // AFTER its probe; the DELTA — not any sticky flag — is what proves a token was
    // attached during THAT attempt.
    this.#tokensAttached += 1;
    // PER-PROBE PROOF: if THIS request IS the active login probe (matched at the top
    // of upgrade() on the original request), record the generation it was upgraded
    // in. The login flow asserts wasLoginProbeUpgraded(gen) for the generation it
    // captured after reset() — proving THIS probe was upgraded in THIS login's
    // generation, not merely that some request was. No header was ever on the wire,
    // so cross-origin login is unaffected.
    if (isLoginProbe) this.#probeUpgradedGeneration = generation;
    return new Request(request, { headers });
  }

  /**
   * Whether `request` is the active login probe ({@link beginLoginProbe}), matched
   * IN the active probe's own generation only. Object identity is the PRIMARY,
   * collision-proof channel — it matches when the manager passes the SAME object
   * (unit tests / non-rewrapping managers). When the manager re-wraps via
   * `new Request(input)` the object identity is lost, so we fall back to the FULL
   * probe URL — which carries the unguessable `#probe-<uuid>` fragment
   * ({@link withProbeFragment}) and survives the re-wrap. The fragment is what
   * makes this fallback UNFORGEABLE (round-4b roborev fix): an unrelated fetch to
   * the same base URL has a different/absent fragment, so its `request.url` does
   * not equal `probe.url` and it cannot consume the channel. The single-use
   * `urlConsumed` latch + generation scope are kept as defence-in-depth. Returns
   * false outside the probe's generation (a stale probe after reset).
   */
  #matchActiveLoginProbe(request: Request): boolean {
    const probe = this.#loginProbe;
    if (!probe) return false;
    // A probe is only valid in the generation it was begun in. After a reset()
    // advances the generation, beginLoginProbe must run again for a new login.
    if (probe.generation !== this.#generation) return false;
    if (probe.object.deref() === request) return true;
    // The full URL includes the unguessable #probe-<uuid> fragment, so this
    // comparison is unforgeable: only the real probe (or its faithful re-wrap)
    // carries that exact fragment. Single-use latch is defence-in-depth.
    if (!probe.urlConsumed && probe.url === request.url) {
      probe.urlConsumed = true; // single-use: this login window's first match only.
      return true;
    }
    return false;
  }

  /** Reuse the (possibly in-flight) session for the issuer, else run the code flow once. */
  async #getSession(
    issuer: URL,
    generation: number,
    signal: AbortSignal,
  ): Promise<IssuerSession> {
    // A reset() between issuer resolution and here means this attempt is already
    // superseded — run the login NOT cached, so a stale attempt can never seed the
    // current generation's #sessions map. The upgrade() fence then discards it.
    if (generation !== this.#generation) {
      return this.#authenticate(issuer, signal);
    }
    const cached = this.#sessions.get(issuer.href);
    if (cached) return cached;
    const pending = this.#authenticate(issuer, signal).catch((e) => {
      // Only retract THIS generation's cache entry. If a reset() advanced the
      // generation, #sessions was already cleared and may hold the NEXT identity's
      // in-flight login — deleting blindly here could evict it. Guard on the
      // captured generation so a superseded attempt's failure cannot disturb the
      // current one's cache.
      if (generation === this.#generation) this.#sessions.delete(issuer.href);
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
  /**
   * Run OIDC discovery for an issuer and return its {@link oauth.AuthorizationServer}.
   * Shared by the popup ({@link #authenticate}) and redirect
   * ({@link beginRedirectLogin} / {@link completeRedirectLogin}) paths so discovery
   * is expressed once. The completion phase re-runs this from the PERSISTED issuer
   * href, which is why we persist the href rather than the whole AS object.
   */
  async #discover(
    issuer: URL,
    http: {
      signal: AbortSignal;
      [oauth.customFetch]: typeof fetch;
      [oauth.allowInsecureRequests]?: true;
    },
  ): Promise<oauth.AuthorizationServer> {
    const discoveryResponse = await oauth.discoveryRequest(issuer, http);
    return oauth.processDiscoveryResponse(issuer, discoveryResponse);
  }

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
      url.searchParams.set("scope", "openid webid");
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

    return {
      authorizationServer,
      clientRegistration,
      dpopKey,
      accessToken: tokenResult.access_token,
      // The identity the OP actually vouched for. The login flow checks this
      // against the requested WebID before treating the user as logged in.
      authenticatedWebId: webIdFromClaims(oauth.getValidatedIdTokenClaims(tokenResult)),
    };
  }

  /**
   * PHASE 1 of the full-page REDIRECT autologin flow (the Pod-Manager deep-link).
   *
   * Published @solid/reactive-authentication 0.1.3 has NO redirect (non-popup) mode —
   * only the popup via `<authorization-code-flow>`. A popup auto-opened on page load
   * (no user gesture) is browser-blocked, so the deep-link autologin MUST use a
   * full-page redirect, which this method begins. It:
   *   1. resolves the issuer from the pending WebID (the existing
   *      `#resolveIssuer`/getWebId path), runs discovery, and resolves the client —
   *      RE-REGISTERING the dynamic client with BOTH the popup callback AND the
   *      full-page `redirectReturnUri` in `redirect_uris` (the broker validates
   *      `redirect_uri` against the registration; the popup path's registration
   *      doesn't include the return URI). For the static-clientId path the Client
   *      Identifier Document must already list the return URI.
   *   2. generates an EXTRACTABLE ES256 DPoP keypair (so it can be exported to JWK,
   *      persisted across the redirect, and re-imported) + PKCE verifier + state +
   *      nonce, and builds the authorization URL (response_type=code, scope
   *      `openid webid offline_access`, `prompt=none` for SILENT-with-fallback
   *      autologin, S256 code_challenge, state, nonce,
   *      redirect_uri = `redirectReturnUri`).
   *   3. PERSISTS everything {@link completeRedirectLogin} needs to sessionStorage
   *      ({@link REDIRECT_FLOW_STORAGE_KEY}) — see {@link PersistedRedirectFlow}.
   *
   * Returns the authorization URL; the caller does the full-page `location.assign`.
   *
   * Obeys the generation fence: a {@link reset} during the awaits supersedes this
   * begin, so it throws {@link ReactiveAuthResetError} and persists NOTHING.
   */
  async beginRedirectLogin(
    redirectReturnUri: string,
  ): Promise<{ authorizationUrl: string }> {
    const generation = this.#generation;
    const controller = this.#authController;
    const issuer = await this.#resolveIssuer(controller.signal);
    if (generation !== this.#generation) throw new ReactiveAuthResetError();
    // The WebID we are authenticating as — resolved via the same getWebId path the
    // popup flow uses (pendingWebIdHolder), validated by #resolveIssuer above.
    const webId = validateWebId(await this.#getWebId());
    if (generation !== this.#generation) throw new ReactiveAuthResetError();

    const http = this.#httpOptions(issuer, controller.signal);
    const authorizationServer = await this.#discover(issuer, http);
    if (generation !== this.#generation) throw new ReactiveAuthResetError();

    // Re-register (dynamic) / declare (static) the client so the full-page return
    // URI is an accepted redirect_uri — the SAME client is reused for the token
    // exchange after the redirect, so we persist it below.
    const client = await this.#resolveClient(authorizationServer, http, [
      redirectReturnUri,
    ]);
    if (generation !== this.#generation) throw new ReactiveAuthResetError();

    // EXTRACTABLE so the private key can be exported to JWK, persisted across the
    // full-page redirect, and re-imported in completeRedirectLogin. (The popup path
    // keeps extractable:false — its key never leaves memory.)
    const dpopKey = await oauth.generateKeyPair("ES256", { extractable: true });
    if (generation !== this.#generation) throw new ReactiveAuthResetError();
    const codeVerifier = oauth.generateRandomCodeVerifier();
    const nonce = oauth.generateRandomNonce();
    const state = oauth.generateRandomState();

    const usePkce =
      authorizationServer.code_challenge_methods_supported !== undefined;
    const useS256 =
      usePkce &&
      authorizationServer.code_challenge_methods_supported!.includes("S256");
    const codeChallenge = useS256
      ? await oauth.calculatePKCECodeChallenge(codeVerifier)
      : codeVerifier;
    if (generation !== this.#generation) throw new ReactiveAuthResetError();

    const authorizationUrl = new URL(
      authorizationServer.authorization_endpoint as string,
    );
    authorizationUrl.searchParams.set("client_id", client.client_id);
    authorizationUrl.searchParams.set("redirect_uri", redirectReturnUri);
    authorizationUrl.searchParams.set("response_type", "code");
    // offline_access requests a refresh token; webid is the Solid-OIDC claim.
    authorizationUrl.searchParams.set("scope", "openid webid offline_access");
    // prompt=none makes the full-page AUTOLOGIN truly SILENT-with-fallback. The
    // deep-link autologin fires on PAGE LOAD with no user gesture (CASE B), so it
    // must NEVER show an interactive consent/login screen: a live OP session +
    // prior app authorization redirects back ALREADY authenticated (`?code&state`),
    // and ANY case requiring interaction comes back as an OIDC ERROR
    // (`?error=login_required|interaction_required|consent_required&state=...`) that
    // the autologin's state-validating ABORT path (CASE A' / abortRedirectLogin)
    // then handles by falling back to the login panel. Without prompt=none the OP
    // would render its own UI mid-redirect (defeating the silent SSO) AND would
    // never return the `?error&state` that makes the abort path reachable. The popup
    // (interactive) login keeps its OWN two-attempt prompt=none→retry logic in
    // #authenticate and is untouched.
    authorizationUrl.searchParams.set("prompt", "none");
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("nonce", nonce);
    if (usePkce) {
      authorizationUrl.searchParams.set(
        "code_challenge_method",
        useS256 ? "S256" : "plain",
      );
      authorizationUrl.searchParams.set("code_challenge", codeChallenge);
    }

    // Export the keypair to JWK so it survives the full-page navigation. The
    // EXTRACTABLE flag set above is what permits exportKey here.
    const [dpopPrivateJwk, dpopPublicJwk] = await Promise.all([
      crypto.subtle.exportKey("jwk", dpopKey.privateKey),
      crypto.subtle.exportKey("jwk", dpopKey.publicKey),
    ]);
    if (generation !== this.#generation) throw new ReactiveAuthResetError();

    const record: PersistedRedirectFlow = {
      issuer: authorizationServer.issuer,
      client,
      dpopPrivateJwk,
      dpopPublicJwk,
      codeVerifier,
      state,
      nonce,
      redirectUri: redirectReturnUri,
      webId,
    };
    sessionStorage.setItem(REDIRECT_FLOW_STORAGE_KEY, JSON.stringify(record));

    return { authorizationUrl: authorizationUrl.toString() };
  }

  /**
   * PHASE 2 of the full-page REDIRECT autologin flow: complete the DPoP-bound
   * authorization-code exchange after the broker redirects back. Reads the persisted
   * record ({@link REDIRECT_FLOW_STORAGE_KEY}), re-runs discovery from the persisted
   * issuer href, re-imports the DPoP JWK, validates the auth response against the
   * persisted `state`, exchanges the code, then — after PROVING the OP authenticated
   * AS the persisted requested WebID — ESTABLISHES the session in `#sessions` for the
   * issuer AND seeds `#issuer` with the resolved issuer URL AND sets
   * `#authenticatedWebId` from the id_token AND bumps `#tokensAttached`.
   *
   * SECURITY: the authenticated WebID (id_token `webid`/`sub`) is compared against the
   * persisted `record.webId` with {@link webIdsEqual} BEFORE any provider state is
   * written; a mismatch (or either WebID missing — webIdsEqual fails closed) throws and
   * seeds NOTHING, so a live IdP session for a DIFFERENT account can never log the app
   * in as the wrong identity. This mirrors the popup path's "prove the requested WebID"
   * invariant, and is the AUTHORITATIVE check (independent of any caller-side one).
   *
   * `#issuer` is seeded on success so a later `upgrade()` (a data fetch on the now-
   * authenticated page, after the redirect reset pendingWebIdHolder to null) reuses
   * this completed session's issuer instead of re-resolving via getWebId() and failing.
   *
   * Clears the sessionStorage record in a `finally` (success OR failure), so a stale
   * pending flow can never satisfy a later callback. On failure throws and leaves the
   * provider clean — no half-session is written. Obeys the generation fence: a
   * {@link reset} during the awaits supersedes the completion, which then writes NO
   * provider state.
   */
  async completeRedirectLogin(callbackUrl: string): Promise<void> {
    const generation = this.#generation;
    const controller = this.#authController;
    const raw = sessionStorage.getItem(REDIRECT_FLOW_STORAGE_KEY);
    if (!raw) {
      throw new Error("No pending redirect login to complete.");
    }
    try {
      const record = JSON.parse(raw) as PersistedRedirectFlow;
      const issuer = new URL(record.issuer);
      const http = this.#httpOptions(issuer, controller.signal);
      // Rebuild the AuthorizationServer from the persisted issuer href — avoids
      // persisting the whole AS object, and the metadata may have refreshed.
      const authorizationServer = await this.#discover(issuer, http);
      if (generation !== this.#generation) throw new ReactiveAuthResetError();

      // Re-import the SAME DPoP key the authorization code was bound to.
      const [privateKey, publicKey] = await Promise.all([
        crypto.subtle.importKey(
          "jwk",
          record.dpopPrivateJwk,
          { name: "ECDSA", namedCurve: "P-256" },
          true,
          ["sign"],
        ),
        crypto.subtle.importKey(
          "jwk",
          record.dpopPublicJwk,
          { name: "ECDSA", namedCurve: "P-256" },
          true,
          [],
        ),
      ]);
      if (generation !== this.#generation) throw new ReactiveAuthResetError();
      const dpopKey: CryptoKeyPair = { privateKey, publicKey };
      const dpop = oauth.DPoP({}, dpopKey);
      const client = record.client;

      const usePkce =
        authorizationServer.code_challenge_methods_supported !== undefined;
      const authorizationCodeParams = oauth.validateAuthResponse(
        authorizationServer,
        client,
        new URL(callbackUrl),
        record.state,
      );
      const tokenResponse = await oauth.authorizationCodeGrantRequest(
        authorizationServer,
        client,
        this.#clientAuth(authorizationServer.issuer, client),
        authorizationCodeParams,
        record.redirectUri,
        usePkce ? record.codeVerifier : oauth.nopkce,
        { DPoP: dpop, ...http },
      );
      const tokenResult = await oauth.processAuthorizationCodeResponse(
        authorizationServer,
        client,
        tokenResponse,
        {
          expectedNonce: this.#nonceVerification(
            authorizationServer.issuer,
            record.nonce,
          ),
        },
      );
      // RE-FENCE before writing ANY provider state: a reset() during the awaits
      // means this completion belongs to a superseded identity — write nothing.
      if (generation !== this.#generation) throw new ReactiveAuthResetError();

      const authenticatedWebId = webIdFromClaims(
        oauth.getValidatedIdTokenClaims(tokenResult),
      );
      // SECURITY (finding 2 — cross-identity hole): the OP may have a LIVE session
      // for a DIFFERENT account that satisfies this deep-link, so the id_token can
      // vouch for a WebID we never requested. Mirror the popup path's invariant —
      // PROVE the OP authenticated AS the persisted requested WebID before seeding
      // ANY provider state. On mismatch (or either side missing — webIdsEqual fails
      // closed) throw BEFORE any #sessions/#issuer/#authenticatedWebId/#tokensAttached
      // write, so a session for an unrequested identity is NEVER established. The
      // `finally` below still clears the persisted record. This is the AUTHORITATIVE
      // check: the provider must never seed a session for an unrequested identity,
      // regardless of any (defence-in-depth) caller-side check.
      if (!webIdsEqual(authenticatedWebId, record.webId)) {
        throw new Error(
          "Autologin did not complete — the identity provider authenticated a " +
            `different WebID (${authenticatedWebId ?? "unknown"}) than the one ` +
            `requested (${record.webId}). For your security you were not logged in.`,
        );
      }

      const session: IssuerSession = {
        authorizationServer,
        clientRegistration: client,
        dpopKey,
        accessToken: tokenResult.access_token,
        authenticatedWebId,
      };
      // Establish the session for the issuer so subsequent upgrade()s reuse it,
      // and publish the authenticated identity + bump the attach counter exactly
      // like the popup path does on a successful token mint.
      this.#sessions.set(issuer.href, Promise.resolve(session));
      this.#authenticatedWebId = session.authenticatedWebId;
      // FINDING 1: seed #issuer with the resolved issuer URL too. The full-page
      // redirect reset pendingWebIdHolder to null, so a later upgrade() (a data
      // fetch on the now-authenticated page) would re-resolve the issuer via
      // getWebId() and FAIL ("No WebID set for login"). Seeding #issuer here lets
      // upgrade() reuse this completed session's issuer (and thus #sessions) WITHOUT
      // calling getWebId. Done AFTER the authoritative re-fence (a superseded
      // completion publishes nothing), consistent with #sessions/#authenticatedWebId.
      this.#issuer = Promise.resolve(issuer);
      this.#tokensAttached += 1;
    } finally {
      // Consume the record immediately — success OR failure — so a stale pending
      // flow can never satisfy a later, unrelated callback.
      try {
        sessionStorage.removeItem(REDIRECT_FLOW_STORAGE_KEY);
      } catch {
        // sessionStorage may be unavailable (private mode / SSR) — non-fatal.
      }
    }
  }

  /**
   * Handle a FULL-PAGE redirect that returned an OIDC ERROR (`?error&state` — the
   * broker declined silent SSO, or the user declined) — but ONLY after PROVING the
   * callback belongs to THIS pending redirect flow.
   *
   * SECURITY (roborev MEDIUM finding): an error return must NOT be trusted on the
   * mere presence of `error`+`state`. The caller used to {@link reset} the provider
   * (clearing the persisted record — its single-use DPoP key + PKCE verifier +
   * state) for ANY `?error&state` URL, so a forged/stray `https://app/?error=…&state=…`
   * (a CSRF/mix-up) could destroy a legitimate in-flight redirect login. Here we run
   * the SAME state check the success path relies on — {@link oauth.validateAuthResponse}
   * compares the callback `state` against the PERSISTED `record.state` (and the `iss`,
   * when advertised) BEFORE it surfaces the error:
   *   - state MATCHES + an `error` is present → `validateAuthResponse` throws
   *     {@link oauth.AuthorizationResponseError}. This IS our flow declining: clear the
   *     persisted record + reset() the provider, then throw a descriptive error.
   *   - state MISMATCH / missing (a forged or unrelated callback) → `validateAuthResponse`
   *     throws an {@link oauth.OperationProcessingError} (NOT AuthorizationResponseError).
   *     We DO NOT consume the record and DO NOT reset — the pending flow is left intact —
   *     and re-throw so the caller leaves the in-flight login untouched.
   * The persisted record is therefore cleared ONLY when the callback genuinely belongs
   * to this flow, exactly mirroring how `completeRedirectLogin` validates `?code&state`.
   *
   * @param callbackUrl the full return URL (`location.href`) carrying `?error&state`.
   * @throws {@link RedirectAbortedError} on a VALIDATED error return (record consumed +
   *   provider reset — the caller may then clean up). Throws the underlying
   *   state-mismatch error (or {@link ReactiveAuthResetError}) on a forged/unrelated
   *   callback, leaving the record + provider state fully INTACT.
   */
  async abortRedirectLogin(callbackUrl: string): Promise<void> {
    const generation = this.#generation;
    const controller = this.#authController;
    const raw = sessionStorage.getItem(REDIRECT_FLOW_STORAGE_KEY);
    if (!raw) {
      throw new Error("No pending redirect login to abort.");
    }
    const record = JSON.parse(raw) as PersistedRedirectFlow;
    const issuer = new URL(record.issuer);
    const http = this.#httpOptions(issuer, controller.signal);
    // Discovery is needed so validateAuthResponse can assert `iss` (when the AS
    // advertises it). A reset() during discovery supersedes this — leave the record
    // for the next pass to reconcile.
    const authorizationServer = await this.#discover(issuer, http);
    if (generation !== this.#generation) throw new ReactiveAuthResetError();
    try {
      // Throws OperationProcessingError on a state MISMATCH/missing (BEFORE the error
      // check), or AuthorizationResponseError when state matched AND an `error` is set.
      oauth.validateAuthResponse(
        authorizationServer,
        record.client,
        new URL(callbackUrl),
        record.state,
      );
    } catch (e) {
      if (e instanceof oauth.AuthorizationResponseError) {
        // State VALIDATED and the response is a genuine error for THIS flow. Now — and
        // only now — it is safe to consume the persisted record + drop provider state.
        this.reset(); // clears the persisted record + all per-identity state.
        const params = e.cause instanceof URLSearchParams ? e.cause : undefined;
        const code = params?.get("error") ?? "login_failed";
        const description = params?.get("error_description");
        throw new RedirectAbortedError(
          description
            ? `${code}: ${description}`
            : `Sign-in was declined by the identity provider (${code}).`,
          code,
        );
      }
      // State MISMATCH / missing / any other validation failure: the callback does NOT
      // belong to this pending flow. Leave the persisted record + provider state intact
      // so a forged/stray `?error&state` cannot destroy a legitimate in-flight login.
      throw e;
    }
    // No error in the response (e.g. only `?state` with no `error`/`code`) — not an
    // abortable error return. Do NOT consume the record; let the caller decide.
    throw new Error("Redirect callback is not an OIDC error response.");
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
    http: {
      signal: AbortSignal;
      [oauth.customFetch]: typeof fetch;
      [oauth.allowInsecureRequests]?: true;
    },
    extraRedirectUris: string[] = [],
  ): Promise<oauth.Client> {
    // The popup callback is always registerable; any extra (e.g. the full-page
    // autologin return URI) is appended and de-duplicated so the broker accepts
    // BOTH the popup post-back and the redirect return. Order is preserved.
    const redirectUris = [...new Set([this.#callbackUri, ...extraRedirectUris])];
    if (this.#clientId !== undefined) {
      // A public browser client identified by a dereferenceable URL. `oauth.Client`
      // requires only `client_id`; the rest are accepted via its index signature
      // and consumed by the shared authorization-URL builder below. The Client
      // Identifier Document itself must list every redirect_uri the OP will see.
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

/**
 * Whether a two-phase REDIRECT autologin flow is mid-flight — i.e. a
 * {@link PersistedRedirectFlow} record is in sessionStorage under
 * {@link REDIRECT_FLOW_STORAGE_KEY}. The SolidAuthProvider reads this on mount to
 * decide CASE A (returning from the broker redirect, when `?code&state` is also
 * present) vs CASE B (a fresh deep-link with no pending record). Returns false in
 * any environment without sessionStorage (SSR / private mode).
 */
export function hasPendingRedirectLogin(): boolean {
  try {
    return sessionStorage.getItem(REDIRECT_FLOW_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * The WebID a pending redirect-login flow targets (the deep-link WebID persisted by
 * {@link WebIdDPoPTokenProvider.beginRedirectLogin}), or `null` when no flow is
 * pending or the record is unreadable/corrupt. NON-DESTRUCTIVE — it does NOT clear
 * the record (the completion phase's `finally` owns the clear). Named "consume" only
 * because the caller treats the pending WebID as one-shot context.
 */
export function consumePendingRedirectWebId(): string | null {
  try {
    const raw = sessionStorage.getItem(REDIRECT_FLOW_STORAGE_KEY);
    if (!raw) return null;
    const record = JSON.parse(raw) as Partial<PersistedRedirectFlow>;
    return typeof record.webId === "string" ? record.webId : null;
  } catch {
    return null;
  }
}

/**
 * Clear any persisted pending redirect-login record. Used by
 * {@link WebIdDPoPTokenProvider.reset} (logout / new login drops a stale flow) and by
 * the SolidAuthProvider when it abandons a redirect attempt (a failed completion, or
 * the loop-guard fallback). Safe to call when no record / no sessionStorage exists.
 */
export function clearPendingRedirectLogin(): void {
  try {
    sessionStorage.removeItem(REDIRECT_FLOW_STORAGE_KEY);
  } catch {
    // sessionStorage unavailable (SSR / private mode) — nothing to clear.
  }
}

/**
 * Compare two WebIDs for IDENTITY equality, tolerant only of trivial URL
 * normalisation (case-insensitive scheme + host, default-port elision), never of
 * a different path/fragment. Returns false if either side is missing or unparseable
 * — an unverifiable identity must FAIL closed, not pass. Used by the login flow to
 * confirm the OP authenticated the user as the WebID they asked to log in as.
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
function webIdFromClaims(claims: oauth.IDToken | undefined): string | undefined {
  if (!claims) return undefined;
  const webid = claims.webid;
  if (typeof webid === "string" && webid.length > 0) return webid;
  if (typeof claims.sub === "string" && claims.sub.length > 0) return claims.sub;
  return undefined;
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
