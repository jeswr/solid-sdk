/**
 * Solid-OIDC **authorization-code + PKCE + DPoP** flow — the *user-delegated* login that the
 * client-credentials grant in `session.ts` cannot provide. This is the flow five W6.5 prototypes
 * (solid-sync, solid-webdav, slack-solid, hubspot-solid, the apple-health-import CLI) flagged as
 * "design-only", and the `dx` create-solid-app S2 blocker.
 *
 * Standards: RFC 6749 (authorization-code), RFC 7636 (PKCE, S256), RFC 9449 (DPoP — proofs at the
 * token endpoint AND on resource requests), OpenID Connect Discovery 1.0, RFC 7591 (dynamic client
 * registration), and the Solid-OIDC profile (`webid` scope, `offline_access` for refresh tokens,
 * Client Identifier Documents as the static-client alternative to DCR).
 *
 * Shape: this module produces the SAME `authedFetch` resource surface as the client-credentials
 * session (it returns a `SolidSessionState` carrying the DPoP keypair + access token + refresh
 * token), so `authedFetch` / `rdfFetchFor` from `session.ts` work unchanged. Only token ACQUISITION
 * differs (interactive code exchange + refresh rotation vs. a `client_credentials` POST).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE http/loopback ISSUER GUARD — contrast with the @solid/reactive-authentication 0.1.3 bug
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * reactive-auth 0.1.3 rejects ANY `http:` issuer outright, which breaks local development against
 * an in-memory CSS at `http://localhost:3000/` (the `dx` S2 blocker). The correct rule — per
 * RFC 8252 §8.3 (loopback) and the OAuth security BCP — is: `https:` is required for real issuers,
 * but `http:` is permitted *only* for loopback hosts (`127.0.0.1`, `[::1]`, and `localhost`). We
 * implement exactly that rule in {@link assertIssuerTransport}; the unit suite regression-tests
 * this bug class.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createDpopProof, type DpopKeyPair, generateDpopKeyPair } from "./dpop.js";
import type { FetchLike, SolidSessionState } from "./session.js";
import { discoveryUrl } from "./session.js";

/** The default transport: global fetch, narrowed to {@link FetchLike}. */
const defaultFetch: FetchLike = (input, init) =>
  globalThis.fetch(input, init as RequestInit | undefined);

// ─────────────────────────────────────────── issuer transport guard ───────────────────────────

/** Loopback hosts for which `http:` is allowed (RFC 8252 §8.3). `localhost` included per the BCP. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

/** True iff `host` (a URL hostname, no port) is a loopback address. */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

/**
 * Enforce the issuer transport policy: `https:` always allowed; `http:` allowed ONLY for loopback
 * hosts. This is the deliberate fix for the reactive-auth 0.1.3 "rejects all http issuers" bug —
 * it must NOT reject `http://localhost:3000/` while it MUST reject `http://idp.example.com/`.
 *
 * @throws if the issuer uses `http:` against a non-loopback host, or an unsupported scheme.
 */
export function assertIssuerTransport(issuer: string): void {
  const u = new URL(issuer);
  if (u.protocol === "https:") return;
  if (u.protocol === "http:") {
    if (isLoopbackHost(u.hostname)) return;
    throw new Error(
      `Insecure issuer ${issuer}: http is only permitted for loopback hosts ` +
        `(127.0.0.1, [::1], localhost). Use https for ${u.hostname}.`,
    );
  }
  throw new Error(
    `Unsupported issuer scheme ${u.protocol} in ${issuer} (expected https or http-loopback).`,
  );
}

// ─────────────────────────────────────────────────── PKCE (RFC 7636) ──────────────────────────

export interface PkcePair {
  /** High-entropy random verifier (43–128 chars, unreserved alphabet). */
  readonly verifier: string;
  /** `BASE64URL(SHA256(ASCII(verifier)))`. */
  readonly challenge: string;
  /** Always `"S256"` here — `plain` is not used. */
  readonly method: "S256";
}

/**
 * Derive the S256 PKCE challenge from a verifier: `BASE64URL-ENCODE(SHA256(ASCII(verifier)))`
 * (RFC 7636 §4.2). Exposed so the unit suite can assert the RFC 7636 Appendix-B test vector.
 */
export function pkceChallengeS256(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/**
 * Generate a fresh PKCE verifier + S256 challenge. The verifier is 32 random bytes encoded
 * base64url (43 chars), comfortably inside the RFC 7636 43–128 range and using only the
 * unreserved alphabet. node:crypto only — no hand-rolled randomness.
 */
export function generatePkce(): PkcePair {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: pkceChallengeS256(verifier), method: "S256" };
}

// ─────────────────────────────────────────────── OIDC discovery + DCR ─────────────────────────

/** The discovery fields this flow needs (OpenID Connect Discovery 1.0 + RFC 7591). */
export interface OidcProviderMetadata {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly registration_endpoint?: string;
  /** Advertised DPoP-binding algs, if any (RFC 9449 §5.1). Informational here. */
  readonly dpop_signing_alg_values_supported?: string[];
}

/** Discover the provider metadata from `.well-known/openid-configuration`. */
export async function discoverProvider(
  issuer: string,
  fetchImpl: FetchLike = defaultFetch,
): Promise<OidcProviderMetadata> {
  assertIssuerTransport(issuer);
  const url = discoveryUrl(issuer);
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`OIDC discovery failed (${res.status}) at ${url}`);
  }
  const meta = (await res.json()) as Partial<OidcProviderMetadata>;
  if (!meta.authorization_endpoint || !meta.token_endpoint) {
    throw new Error(`OIDC config at ${url} is missing authorization_endpoint or token_endpoint.`);
  }
  return meta as OidcProviderMetadata;
}

/** A registered (or statically configured) OAuth client. */
export interface ClientRegistration {
  readonly client_id: string;
  /** Present for confidential clients from DCR; absent for public clients / static Client IDs. */
  readonly client_secret?: string;
  readonly redirect_uris: readonly string[];
}

/**
 * Dynamic Client Registration (RFC 7591). CSS supports anonymous DCR, so no initial access token
 * is sent. We register a PUBLIC native client (no secret) using PKCE — `token_endpoint_auth_method:
 * "none"` — bound to the loopback `redirectUri`.
 *
 * TODO(client-identifier-document): the Solid-OIDC alternative to DCR is a static **Client
 * Identifier Document** — an https URL serving a JSON-LD client doc whose `client_id` equals that
 * URL. {@link staticClient} is the seam for that path; a deployed app SHOULD use it so the consent
 * screen shows a stable app name. DCR is the right default only for CLIs / local dev where no
 * public https client-doc URL exists.
 */
export async function registerClient(
  meta: OidcProviderMetadata,
  redirectUri: string,
  opts: { clientName?: string } = {},
  fetchImpl: FetchLike = defaultFetch,
): Promise<ClientRegistration> {
  if (!meta.registration_endpoint) {
    throw new Error(
      `Provider ${meta.issuer} advertises no registration_endpoint; supply a static client_id ` +
        `(Client Identifier Document) via staticClient() instead.`,
    );
  }
  const body = JSON.stringify({
    client_name: opts.clientName ?? "solid-dpop CLI",
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: "native",
  });
  const res = await fetchImpl(meta.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Dynamic client registration failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const reg = (await res.json()) as {
    client_id?: string;
    client_secret?: string;
    redirect_uris?: string[];
  };
  if (!reg.client_id) {
    throw new Error("DCR response missing client_id.");
  }
  return {
    client_id: reg.client_id,
    ...(reg.client_secret ? { client_secret: reg.client_secret } : {}),
    redirect_uris: reg.redirect_uris ?? [redirectUri],
  };
}

/**
 * Build a {@link ClientRegistration} from a STATIC client id (a Solid-OIDC Client Identifier
 * Document URL, or a pre-registered confidential client). No network call. This is the seam a
 * deployed app uses instead of {@link registerClient}.
 */
export function staticClient(
  clientId: string,
  redirectUri: string,
  clientSecret?: string,
): ClientRegistration {
  return {
    client_id: clientId,
    redirect_uris: [redirectUri],
    ...(clientSecret ? { client_secret: clientSecret } : {}),
  };
}

// ─────────────────────────────────────────── authorization URL (PKCE) ─────────────────────────

export interface AuthUrlParams {
  readonly meta: OidcProviderMetadata;
  readonly client: ClientRegistration;
  readonly redirectUri: string;
  readonly pkce: PkcePair;
  /** Anti-CSRF state echoed back on the redirect. */
  readonly state: string;
  /** OIDC replay nonce bound into the ID token. */
  readonly nonce: string;
  /** Defaults to `openid webid offline_access` (Solid-OIDC + a refresh token). */
  readonly scope?: string;
  /**
   * OIDC `prompt`. Defaults to `"consent"` when the scope requests `offline_access` (so CSS issues
   * a refresh token); pass an explicit value (e.g. `"none"`) to override.
   */
  readonly prompt?: "consent" | "login" | "none" | "select_account";
}

/** Default Solid-OIDC scope set: `openid` (OIDC), `webid` (Solid profile), `offline_access` (refresh). */
export const DEFAULT_SCOPE = "openid webid offline_access" as const;

/** True iff the (space-delimited) scope set requests `offline_access` (a refresh token). */
function requestsOfflineAccess(scope: string): boolean {
  return scope.split(/\s+/).includes("offline_access");
}

/**
 * Construct the authorization-request URL (RFC 6749 §4.1.1 + RFC 7636 §4.3 + OIDC). Includes
 * `response_type=code`, the S256 `code_challenge`, `state`, `nonce`, and the Solid-OIDC scope.
 *
 * When `offline_access` is requested, `prompt` DEFAULTS to `"consent"` (overridable via
 * `params.prompt`): CSS only issues a refresh token when consent is explicitly prompted, so without
 * this default the documented `refreshSession` would run on a tokenless session.
 */
export function buildAuthorizationUrl(params: AuthUrlParams): string {
  const { meta, client, redirectUri, pkce, state, nonce } = params;
  const scope = params.scope ?? DEFAULT_SCOPE;
  const q = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: redirectUri,
    scope,
    state,
    nonce,
    code_challenge: pkce.challenge,
    code_challenge_method: pkce.method,
  });
  const prompt = params.prompt ?? (requestsOfflineAccess(scope) ? "consent" : undefined);
  if (prompt) q.set("prompt", prompt);
  const url = new URL(meta.authorization_endpoint);
  url.search = q.toString();
  return url.toString();
}

// ─────────────────────────────────────────── loopback redirect listener ───────────────────────

export interface LoopbackListener {
  /** The `http://127.0.0.1:<port>/<path>` redirect URI the AS must redirect to. */
  readonly redirectUri: string;
  /** Resolves with the `{code, state}` (or `{error}`) once the browser hits the redirect. */
  readonly waitForCode: (timeoutMs?: number) => Promise<{ code: string; state: string }>;
  /** Close the listener. Idempotent. */
  readonly close: () => Promise<void>;
}

/**
 * Start a one-shot loopback HTTP listener on `127.0.0.1` and an ephemeral port (RFC 8252 §7.3) to
 * catch the authorization-code redirect for CLI / native apps. The browser is sent here; the AS
 * appends `?code=…&state=…`. We resolve on the first matching request and serve a tiny success
 * page so the user can close the tab.
 *
 * Binds to `127.0.0.1` (never `0.0.0.0`) so the listener is never reachable off-host.
 */
export async function startLoopbackListener(path = "/callback"): Promise<LoopbackListener> {
  // The handler RESOLVES this with a success-or-error union (never rejects), so the promise is
  // safe to leave un-awaited until waitForCode reads it — no unhandled-rejection window. waitForCode
  // converts the error variant into a thrown Error.
  type Outcome = { code: string; state: string } | { error: string };
  let settled = false;
  let resolveOutcome: ((v: Outcome) => void) | undefined;
  const outcomePromise = new Promise<Outcome>((resolve) => {
    resolveOutcome = (v) => {
      settled = true;
      resolve(v);
    };
  });

  const server: Server = createServer((req, res) => {
    const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    if (reqUrl.pathname !== path) {
      res.writeHead(404).end("Not found");
      return;
    }
    if (settled) {
      res.writeHead(409, { "content-type": "text/html" }).end("<p>Already completed.</p>");
      return;
    }
    const error = reqUrl.searchParams.get("error");
    const code = reqUrl.searchParams.get("code");
    const state = reqUrl.searchParams.get("state");
    if (error) {
      res.writeHead(400, { "content-type": "text/html" }).end(`<p>Login failed: ${error}</p>`);
      resolveOutcome?.({ error });
      return;
    }
    if (!code || !state) {
      res.writeHead(400, { "content-type": "text/html" }).end("<p>Missing code/state.</p>");
      resolveOutcome?.({ error: "missing_code_or_state" });
      return;
    }
    res
      .writeHead(200, { "content-type": "text/html" })
      .end("<p>Login complete. You can close this tab.</p>");
    resolveOutcome?.({ code, state });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const redirectUri = `http://127.0.0.1:${port}${path}`;

  const close = (): Promise<void> =>
    new Promise<void>((resolve) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });

  const waitForCode = async (timeoutMs = 120_000): Promise<{ code: string; state: string }> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<Outcome>((resolve) => {
      timer = setTimeout(() => resolve({ error: "redirect_timeout" }), timeoutMs);
      if (timer && typeof timer.unref === "function") timer.unref();
    });
    const outcome = await Promise.race([outcomePromise, timeout]);
    if (timer) clearTimeout(timer);
    if ("error" in outcome) {
      throw new Error(`Authorization redirect failed: ${outcome.error}`);
    }
    return outcome;
  };

  return { redirectUri, waitForCode, close };
}

// ─────────────────────────────────────────── token exchange (code + DPoP) ─────────────────────

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
}

/**
 * Fired by {@link refreshSession} after the session adopts rotated tokens. The callback receives the
 * SAME mutated session (refreshed access token, rotated refresh token, same DPoP keypair), so a
 * consumer can re-persist it — e.g. re-write the chmod-600 session JSON so a restart loads the
 * rotated (still-valid) refresh token rather than the invalidated old one.
 *
 * The DPoP `jkt`/private-JWK binding is preserved across refresh (the keypair is reused), so
 * re-persisting via `saveSession` keeps the refresh token usable.
 */
export type OnTokensRefreshed = (session: AuthCodeSession) => void | Promise<void>;

/** The result of a successful code-exchange or refresh: an `authedFetch`-ready session + tokens. */
export interface AuthCodeSession extends SolidSessionState {
  /** The refresh token (RFC 6749 §6), if the AS issued one (requires `offline_access`). */
  refreshToken?: string;
  /** The provider metadata, retained so refresh can re-hit the token endpoint. */
  readonly providerMetadata: OidcProviderMetadata;
  /** The client used, retained for the refresh request. */
  readonly client: ClientRegistration;
  /**
   * Optional hook invoked AFTER each successful refresh (token rotation applied). Consumers set it
   * to re-persist the rotated tokens. NOT serialised by the session store; re-attach after load.
   */
  onRefresh?: OnTokensRefreshed;
}

/**
 * POST to the token endpoint with a DPoP proof, handling the RFC 9449 §8 `use_dpop_nonce`
 * challenge (a 400 carrying `DPoP-Nonce`) by retrying once with the supplied nonce. Returns the
 * parsed token response plus the latest server nonce.
 */
async function postTokenWithDpop(
  meta: OidcProviderMetadata,
  keyPair: DpopKeyPair,
  body: URLSearchParams,
  client: ClientRegistration,
  fetchImpl: FetchLike,
): Promise<{ token: TokenResponse; nonce?: string }> {
  const headers = (dpop: string): Record<string, string> => {
    const h: Record<string, string> = {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      dpop,
    };
    // Confidential clients (DCR with a secret) authenticate with Basic; public clients send
    // client_id in the body (already set by callers) and authenticate via PKCE only.
    if (client.client_secret) {
      h.authorization =
        "Basic " +
        Buffer.from(
          `${encodeURIComponent(client.client_id)}:${encodeURIComponent(client.client_secret)}`,
        ).toString("base64");
    }
    return h;
  };

  const attempt = async (nonce?: string): Promise<Response> => {
    const dpop = await createDpopProof({
      keyPair,
      htm: "POST",
      htu: meta.token_endpoint,
      ...(nonce !== undefined ? { nonce } : {}),
    });
    return fetchImpl(meta.token_endpoint, {
      method: "POST",
      headers: headers(dpop),
      body: body.toString(),
    });
  };

  let res = await attempt();
  let nonce = res.headers.get("DPoP-Nonce") ?? undefined;
  if (res.status === 400 && nonce) {
    res = await attempt(nonce);
    nonce = res.headers.get("DPoP-Nonce") ?? nonce;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const token = (await res.json()) as TokenResponse;
  return { token, ...(nonce ? { nonce } : {}) };
}

/**
 * Exchange an authorization `code` (+ PKCE `verifier`) for a DPoP-bound access token (and a refresh
 * token when `offline_access` was granted). RFC 6749 §4.1.3 + RFC 7636 §4.5 + RFC 9449.
 */
export async function exchangeCode(args: {
  readonly meta: OidcProviderMetadata;
  readonly client: ClientRegistration;
  readonly redirectUri: string;
  readonly code: string;
  readonly codeVerifier: string;
  readonly keyPair?: DpopKeyPair;
  readonly fetchImpl?: FetchLike;
}): Promise<AuthCodeSession> {
  const fetchImpl = args.fetchImpl ?? defaultFetch;
  const keyPair = args.keyPair ?? (await generateDpopKeyPair());
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
    code_verifier: args.codeVerifier,
    client_id: args.client.client_id,
  });
  const { token, nonce } = await postTokenWithDpop(
    args.meta,
    keyPair,
    body,
    args.client,
    fetchImpl,
  );
  const expiresAt = Date.now() + (token.expires_in ?? 300) * 1000;
  return {
    keyPair,
    accessToken: token.access_token,
    expiresAt,
    providerMetadata: args.meta,
    client: args.client,
    ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
    ...(nonce ? { nonce } : {}),
  };
}

/**
 * Refresh an {@link AuthCodeSession} using its refresh token (RFC 6749 §6) with a DPoP proof, and
 * apply refresh-token ROTATION: if the AS returns a new `refresh_token`, the session adopts it and
 * the old one is discarded. Mutates `session` in place and returns it.
 *
 * The DPoP keypair is REUSED across refreshes — the access token stays bound to the same `jkt`.
 */
export async function refreshSession(
  session: AuthCodeSession,
  fetchImpl: FetchLike = defaultFetch,
): Promise<AuthCodeSession> {
  if (!session.refreshToken) {
    throw new Error(
      "Session has no refresh token; request the offline_access scope to enable refresh.",
    );
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: session.refreshToken,
    client_id: session.client.client_id,
  });
  const { token, nonce } = await postTokenWithDpop(
    session.providerMetadata,
    session.keyPair,
    body,
    session.client,
    fetchImpl,
  );
  session.accessToken = token.access_token;
  session.expiresAt = Date.now() + (token.expires_in ?? 300) * 1000;
  // Rotation: adopt the new refresh token if the AS rotated it; otherwise keep the old one.
  if (token.refresh_token) session.refreshToken = token.refresh_token;
  if (nonce) session.nonce = nonce;
  // Notify the consumer so it can re-persist the rotated tokens (DPoP jkt binding preserved).
  await session.onRefresh?.(session);
  return session;
}

// ─────────────────────────────────────────── orchestrated CLI login ───────────────────────────

export interface CliLoginOptions {
  readonly issuer: string;
  /** Open the authorization URL in a browser. Defaults to printing it. CLIs pass a real opener. */
  readonly openBrowser?: (url: string) => void | Promise<void>;
  /** Static client id (Client Identifier Document); when omitted, anonymous DCR is used. */
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly clientName?: string;
  readonly scope?: string;
  readonly prompt?: AuthUrlParams["prompt"];
  /** Loopback callback path. Defaults to `/callback`. */
  readonly callbackPath?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: FetchLike;
}

/**
 * The full user-delegated CLI login: discover → (register | static client) → start loopback
 * listener → build the authorization URL → open it → await the redirect → verify `state` →
 * exchange the code for a DPoP-bound session. Returns an {@link AuthCodeSession} usable with
 * `authedFetch` / `rdfFetchFor`.
 *
 * Headless test drivers can skip {@link cliLogin} and call the primitives directly (discover,
 * startLoopbackListener, buildAuthorizationUrl, exchangeCode) — that is what the live CSS spec does.
 */
export async function cliLogin(opts: CliLoginOptions): Promise<AuthCodeSession> {
  const fetchImpl = opts.fetchImpl ?? defaultFetch;
  const meta = await discoverProvider(opts.issuer, fetchImpl);
  const listener = await startLoopbackListener(opts.callbackPath ?? "/callback");
  try {
    const client = opts.clientId
      ? staticClient(opts.clientId, listener.redirectUri, opts.clientSecret)
      : await registerClient(
          meta,
          listener.redirectUri,
          opts.clientName ? { clientName: opts.clientName } : {},
          fetchImpl,
        );

    const pkce = generatePkce();
    const state = randomBytes(16).toString("base64url");
    const nonce = randomUUID();
    const authUrl = buildAuthorizationUrl({
      meta,
      client,
      redirectUri: listener.redirectUri,
      pkce,
      state,
      nonce,
      ...(opts.scope ? { scope: opts.scope } : {}),
      ...(opts.prompt ? { prompt: opts.prompt } : {}),
    });

    if (opts.openBrowser) {
      await opts.openBrowser(authUrl);
    } else {
      process.stdout.write(`\nOpen this URL to log in:\n  ${authUrl}\n\n`);
    }

    const { code, state: returnedState } = await listener.waitForCode(opts.timeoutMs);
    if (returnedState !== state) {
      throw new Error("State mismatch on authorization redirect (possible CSRF); aborting.");
    }
    return await exchangeCode({
      meta,
      client,
      redirectUri: listener.redirectUri,
      code,
      codeVerifier: pkce.verifier,
      fetchImpl,
    });
  } finally {
    await listener.close();
  }
}
