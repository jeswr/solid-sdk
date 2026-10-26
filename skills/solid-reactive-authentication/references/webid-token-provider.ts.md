<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# `webid-token-provider.ts` — source example

Preserved from the detailed source snapshot as reading material. Extract the code
block to `webid-token-provider.ts` when adapting the example; sibling `.js` imports refer
to the corresponding extracted TypeScript files. These examples were not executed
as part of this documentation consolidation.

```ts
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
 *
 * PRISTINE-FETCH PINNING (2026-07): every `oauth4webapi` call this provider
 * makes — `discoveryRequest`, dynamic client registration, and the
 * authorization-code token grant — is pinned to `[oauth.customFetch]` via the
 * single `#httpOptions()` chokepoint, defaulting to the SAME construction-time
 * `globalThis.fetch` snapshot used for the WebID profile read. This closes a
 * real deadlock class: an app that patches the global `fetch` with a
 * credential boundary covering the issuer's origin (a proactive authed-fetch
 * wrapper) makes this provider's own OIDC traffic re-enter the patch, which
 * single-flights onto the very `#authenticate()` promise that issued the
 * request — a circular await that stalls login silently, right after the
 * WebID profile read and before any `/authorize` hop or popup, with no thrown
 * error. See the `solid-reactive-authentication` skill's "Login hangs
 * silently AFTER the WebID profile read" gotcha row for the full write-up and
 * a deterministic repro recipe. Pin ALL oauth4webapi call sites through ONE
 * chokepoint (`#httpOptions`), never per-call — a per-call pin is exactly how
 * this bug hides (one call pinned, a sibling call added later is not).
 * Root-caused fixing exactly this stall in the AccessRadar app
 * (`jeswr/product`, branch `fix/login-stall-8575`, commit `7a5461a` —
 * bead `suite-tracker-8575`).
 *
 * ILLUSTRATIVE ONLY — this file is reference/reading material for the
 * internals, not a library to depend on. Apps should import a shared,
 * maintained provider (`@jeswr/solid-auth-core`'s `WebIdDPoPTokenProvider` /
 * `createSolidAuth`, in extraction as of 2026-07) rather than copying this
 * file — see the "token provider is a shared library" gotcha below.
 */
import * as oauth from "oauth4webapi";
import * as DPoP from "dpop";
import type { GetCodeCallback } from "@solid/reactive-authentication";
import { fetchRdf } from "@jeswr/fetch-rdf";
import { resolveIssuers, validateWebId } from "./login-ux.js";

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
  /**
   * Override the fetch pinned to EVERY `oauth4webapi` call this provider makes
   * (`discoveryRequest`, dynamic client registration, the authorization-code
   * token grant) via `[oauth.customFetch]`. Defaults to the SAME
   * construction-time `globalThis.fetch` snapshot as {@link profileFetch} — NOT
   * to whatever `globalThis.fetch` is at call time, which may by then be a
   * patched wrapper whose credential boundary covers the issuer's origin. Do
   * not leave this unset if the app patches the global: an unpinned OIDC call
   * re-enters the patch and deadlocks login (see the class docs). Test-only.
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
   * The fetch pinned to every `oauth4webapi` call (discovery, dynamic client
   * registration, the token grant) via the `#httpOptions()` chokepoint below.
   * Defaults to the SAME construction-time snapshot as `#profileFetch` — one
   * pristine reference backs both, captured before any app-level proactive
   * fetch patch could have run. This is the fix for the discovery-stage
   * circular-await deadlock documented in the class docs above.
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
    // ONE pristine snapshot backs both defaults — captured here, at
    // construction time, before any app-level proactive-fetch patch (which
    // typically installs later, e.g. in a `useEffect`) can have run.
    const pristineFetch = globalThis.fetch.bind(globalThis);
    this.#profileFetch = options.profileFetch ?? pristineFetch;
    this.#oauthFetch = options.oauthFetch ?? pristineFetch;
  }

  /**
   * oauth4webapi request options — the SINGLE chokepoint every oauth4webapi
   * call in this provider goes through (`discoveryRequest`,
   * `dynamicClientRegistrationRequest`, `authorizationCodeGrantRequest`).
   * Enables insecure loopback per the policy, and unconditionally pins
   * `[oauth.customFetch]` to `#oauthFetch` — never per-call-site, which is
   * exactly how the re-entrancy deadlock hides (one call pinned, a sibling
   * call added later silently isn't). See the class docs' PRISTINE-FETCH
   * PINNING note.
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
    http: {
      signal: AbortSignal;
      [oauth.customFetch]: typeof fetch;
      [oauth.allowInsecureRequests]?: true;
    },
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

  /**
   * Client authentication for the token-endpoint grants. Delegates to the pure,
   * FAIL-CLOSED {@link buildClientAuth} (unit-testable in isolation): the
   * EXACT-hostname ESS no-url-encode workaround + a refusal to silently downgrade
   * an unsupported / secret-missing confidential method to `none`. Throws rather
   * than sending the wrong (or no) client credential. The static-Client-Identifier-
   * Document / PKCE default (`none`) is unaffected.
   */
  #clientAuth(issuer: string, client: oauth.Client): oauth.ClientAuth {
    return buildClientAuth(issuer, client);
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
 * The token-endpoint auth methods this provider SUPPORTS — exactly `none`,
 * `client_secret_basic`, and `client_secret_post`. Any other defined value
 * (`client_secret_jwt` / `private_key_jwt` / `tls_client_auth`) is unsupported and
 * must FAIL CLOSED rather than silently downgrade to `none`. Mirrors
 * @jeswr/solid-session-restore's `TokenEndpointAuthMethod`.
 */
type TokenEndpointAuthMethod = "none" | "client_secret_basic" | "client_secret_post";

/**
 * Whether a token-endpoint auth method is one this provider can honour. Accepts an
 * unknown value because the method comes from a dynamic-registration response / a
 * static client object (loosely typed). An unsupported method → false → fail closed.
 */
export function isSupportedTokenEndpointAuthMethod(
  method: unknown,
): method is TokenEndpointAuthMethod {
  return method === "none" || method === "client_secret_basic" || method === "client_secret_post";
}

/** Whether a (supported) method actually requires a client secret. */
function isConfidentialMethod(
  method: TokenEndpointAuthMethod,
): method is "client_secret_basic" | "client_secret_post" {
  return method === "client_secret_basic" || method === "client_secret_post";
}

/**
 * A variant of oauth4webapi's {@link oauth.ClientSecretBasic} that does NOT
 * URL-encode the client_id / secret before base64. PodSpaces (Inrupt ESS) rejects
 * the spec-compliant `application/x-www-form-urlencoded` form (RFC 6749 §2.3.1 /
 * Appendix B) and expects the raw values — a BESPOKE per-server workaround, scoped
 * to ESS issuers only. The standard, spec-following encoder is used for every other
 * server.
 * @see https://www.rfc-editor.org/rfc/rfc6749.html#section-2.3.1
 */
function noUrlEncodeClientSecretBasic(clientSecret: string): oauth.ClientAuth {
  return (_as, client, _body, headers) => {
    headers.set("Authorization", `Basic ${btoa(`${client.client_id}:${clientSecret}`)}`);
  };
}

/** The ESS host whose token endpoint rejects the spec form-url-encoded Basic creds. */
const ESS_NO_URL_ENCODE_HOST = "login.inrupt.com";

/**
 * Whether an issuer is the Inrupt ESS host that needs the no-url-encode workaround,
 * matched on the EXACT hostname (an unparseable issuer → false, so we never apply the
 * bespoke path to an unknown issuer). This is STRICTER than a substring `includes`
 * check — an exact host match cannot be tricked by a spoofed host whose URL merely
 * CONTAINS the substring (e.g. `login.inrupt.com.attacker.example`, or a path/subdomain
 * segment such as `evil.example/login.inrupt.com`), which would otherwise send a
 * non-standard Basic header to the WRONG server. Mirrors @jeswr/solid-session-restore's
 * `isEssNoUrlEncodeIssuer`.
 */
export function isEssNoUrlEncodeIssuer(issuer: string): boolean {
  try {
    return new URL(issuer).hostname === ESS_NO_URL_ENCODE_HOST;
  } catch {
    return false;
  }
}

/**
 * Pick the `client_secret_basic` constructor for an issuer: the BESPOKE
 * non-URL-encoding variant for Inrupt ESS (`login.inrupt.com`, EXACT host) — which
 * rejects the spec encoding — and the standard, RFC-6749-§2.3.1-compliant
 * {@link oauth.ClientSecretBasic} for every other server.
 */
function clientSecretBasicFor(issuer: string): (secret: string) => oauth.ClientAuth {
  return isEssNoUrlEncodeIssuer(issuer) ? noUrlEncodeClientSecretBasic : oauth.ClientSecretBasic;
}

/**
 * Build the oauth4webapi {@link oauth.ClientAuth} for a resolved client, FAIL-CLOSED.
 * PUBLIC clients (`none`, the static-Client-Identifier-Document / PKCE default) → no
 * client auth. CONFIDENTIAL clients present their secret per the declared method (RFC
 * 6749 §2.3.1 / OIDC Core §9): `client_secret_basic` via the Basic header (with the
 * exact-host ESS no-url-encode workaround), `client_secret_post` via the form body.
 *
 * THROWS rather than silently downgrading to `none` when (a) the declared method is a
 * DEFINED-but-UNSUPPORTED one (`client_secret_jwt` / `private_key_jwt` /
 * `tls_client_auth`, etc.), or (b) a confidential method is declared but NO secret is
 * present — either silent `none` would mis-authenticate, and on some servers
 * succeed-as-public when the user intended a confidential client. Mirrors
 * @jeswr/solid-session-restore's fail-closed `buildClientAuth`.
 *
 * When `token_endpoint_auth_method` is OMITTED the spec default is NOT `none`: OIDC
 * Discovery / RFC 6749 §2.3.1 default an omitted method to `client_secret_basic`. So a
 * confidential client (one carrying a non-empty `client_secret`) with no declared method
 * is treated as `client_secret_basic` — NOT silently downgraded to public `none`, which
 * would drop the secret and mis-authenticate. A method-omitted client with no secret
 * stays public `none` (a Client-Identifier-Document / PKCE public client).
 */
export function buildClientAuth(issuer: string, client: oauth.Client): oauth.ClientAuth {
  // The spec default for an OMITTED method is `client_secret_basic`, not `none` — but
  // only for a confidential client (one that actually carries a secret). A method-omitted
  // client with no secret is a public client → `none`. An EXPLICIT `none` always stays
  // public; a DEFINED but unsupported method must fail closed, never fall through.
  //
  // Apply the omitted-default ONLY when the field is genuinely `undefined` — a PRESENT but
  // invalid value (e.g. `null` from malformed/untrusted metadata) must NOT be coalesced to
  // the default (a naive `?? "none"` would do exactly that); it falls through to the
  // unsupported-method guard below and fails closed. Compare `=== undefined`, never `??`.
  const rawMethod = client.token_endpoint_auth_method;
  const hasSecret = typeof client.client_secret === "string" && client.client_secret !== "";
  const method = rawMethod === undefined ? (hasSecret ? "client_secret_basic" : "none") : rawMethod;
  if (!isSupportedTokenEndpointAuthMethod(method)) {
    throw new Error(
      `Unsupported token_endpoint_auth_method "${String(
        method,
      )}" — refusing to authenticate (fail-closed; will not downgrade to "none").`,
    );
  }
  if (!isConfidentialMethod(method)) return oauth.None();
  const secret = client.client_secret;
  if (typeof secret !== "string" || secret === "") {
    throw new Error(
      `Confidential client declared "${method}" but no client_secret is available — ` +
        "refusing to authenticate (fail-closed).",
    );
  }
  return method === "client_secret_post"
    ? oauth.ClientSecretPost(secret)
    : clientSecretBasicFor(issuer)(secret);
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
```
