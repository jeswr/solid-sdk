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
   * patches the global) — see the recursion note in the class docs. Test-only.
   */
  profileFetch?: typeof fetch;
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
 * The single per-login probe record this provider tracks at a time, captured by
 * {@link WebIdDPoPTokenProvider.beginLoginProbe} just before the login flow fetches
 * its probe. It carries:
 *  - `generation` — the provider generation in effect when the probe began, so a
 *    {@link WebIdDPoPTokenProvider.reset} that supersedes the login invalidates the
 *    record by advancing the generation (the flow snapshots the same generation and
 *    asks {@link WebIdDPoPTokenProvider.wasLoginProbeUpgraded} for it).
 *  - `url` — the probe's URL, the ONLY property that survives the manager's
 *    `new Request(input)` re-wrap; used as a SINGLE-USE fallback channel, consumed
 *    on first match so a later same-URL upgrade cannot reuse it.
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
   * the CURRENT generation, the request URL (the single-use re-wrap fallback), and a
   * {@link WeakRef} to the EXACT Request object (the precise primary channel). There
   * is at most one active probe at a time — the SolidAuthProvider single-flights
   * login, so there is never a competing registration. Cleared by
   * {@link endLoginProbe} / {@link reset}.
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
    // must stay at the new identity's clean baseline.
    if (generation !== this.#generation) {
      throw new ReactiveAuthResetError();
    }
    // Record the identity the OP vouched for, so the login flow can confirm it
    // matches the requested WebID. Set here (not only at session creation) so a
    // cached/in-flight session shared across concurrent 401s also publishes it.
    this.#authenticatedWebId = session.authenticatedWebId;
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
    // A token was minted AND attached: the auth flow ran to completion. Bump the
    // running total (only after the session resolved — a cancelled/failed flow
    // throws above and never reaches here, so the count is not bumped). The login
    // flow reads this count BEFORE and AFTER its probe; the DELTA — not any sticky
    // flag — is what proves a token was attached during THAT attempt.
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
   * `new Request(input)` the object identity is lost, so we fall back to the probe
   * URL — the only property that survives — as a SINGLE-USE channel: consumed on the
   * first match so a later same-URL upgrade in the login window cannot reuse it.
   * Returns false outside the probe's generation (a stale probe after reset).
   */
  #matchActiveLoginProbe(request: Request): boolean {
    const probe = this.#loginProbe;
    if (!probe) return false;
    // A probe is only valid in the generation it was begun in. After a reset()
    // advances the generation, beginLoginProbe must run again for a new login.
    if (probe.generation !== this.#generation) return false;
    if (probe.object.deref() === request) return true;
    if (!probe.urlConsumed && probe.url === request.url) {
      probe.urlConsumed = true; // single-use: this login window's first same-URL upgrade only.
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
  async #authenticate(issuer: URL, signal: AbortSignal): Promise<IssuerSession> {
    const http = this.#httpOptions(issuer, signal);

    const discoveryResponse = await oauth.discoveryRequest(issuer, http);
    const authorizationServer = await oauth.processDiscoveryResponse(
      issuer,
      discoveryResponse,
    );

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
  ): Promise<oauth.Client> {
    if (this.#clientId !== undefined) {
      // A public browser client identified by a dereferenceable URL. `oauth.Client`
      // requires only `client_id`; the rest are accepted via its index signature
      // and consumed by the shared authorization-URL builder below.
      return {
        client_id: this.#clientId,
        token_endpoint_auth_method: "none",
        redirect_uris: [this.#callbackUri],
        response_types: ["code"],
      };
    }
    const registrationResponse = await oauth.dynamicClientRegistrationRequest(
      authorizationServer,
      { redirect_uris: [this.#callbackUri] },
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
