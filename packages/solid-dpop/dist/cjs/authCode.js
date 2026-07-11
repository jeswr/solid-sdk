"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SCOPE = void 0;
exports.isLoopbackHost = isLoopbackHost;
exports.assertIssuerTransport = assertIssuerTransport;
exports.assertEndpointTransport = assertEndpointTransport;
exports.pkceChallengeS256 = pkceChallengeS256;
exports.generatePkce = generatePkce;
exports.discoverProvider = discoverProvider;
exports.registerClient = registerClient;
exports.staticClient = staticClient;
exports.buildAuthorizationUrl = buildAuthorizationUrl;
exports.startLoopbackListener = startLoopbackListener;
exports.exchangeCode = exchangeCode;
exports.refreshSession = refreshSession;
exports.cliLogin = cliLogin;
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
const node_crypto_1 = require("node:crypto");
const node_http_1 = require("node:http");
const dpop_js_1 = require("./dpop.js");
const session_js_1 = require("./session.js");
/** The default transport: global fetch, narrowed to {@link FetchLike}. */
const defaultFetch = (input, init) => globalThis.fetch(input, init);
// ─────────────────────────────────────────── issuer transport guard ───────────────────────────
/** Loopback hosts for which `http:` is allowed (RFC 8252 §8.3). `localhost` included per the BCP. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);
/** True iff `host` (a URL hostname, no port) is a loopback address. */
function isLoopbackHost(host) {
    return LOOPBACK_HOSTS.has(host.toLowerCase());
}
/**
 * Centralized transport policy: `https:` always allowed; `http:` allowed ONLY for loopback hosts;
 * any other scheme rejected. This is the single source of truth for "is this URL safe to send
 * credentials to" — the reactive-auth D11 loopback rule. It backs BOTH the input-issuer guard
 * ({@link assertIssuerTransport}) AND the per-endpoint guard applied to discovered metadata
 * ({@link assertEndpointTransport}), so a discovered `token_endpoint` is held to the same bar as
 * the issuer the caller typed.
 *
 * @param url   the URL to validate.
 * @param label a human label (e.g. `"issuer"`, `"token_endpoint"`) used in the thrown error.
 * @throws if the URL uses `http:` against a non-loopback host, or an unsupported scheme.
 */
function assertSecureTransport(url, label) {
    let u;
    try {
        u = new URL(url);
    }
    catch {
        throw new Error(`Invalid ${label} URL: ${url}`);
    }
    if (u.protocol === "https:")
        return;
    if (u.protocol === "http:") {
        if (isLoopbackHost(u.hostname))
            return;
        throw new Error(`Insecure ${label} ${url}: http is only permitted for loopback hosts ` +
            `(127.0.0.1, [::1], localhost). Use https for ${u.hostname}.`);
    }
    throw new Error(`Unsupported ${label} scheme ${u.protocol} in ${url} (expected https or http-loopback).`);
}
/**
 * Enforce the issuer transport policy: `https:` always allowed; `http:` allowed ONLY for loopback
 * hosts. This is the deliberate fix for the reactive-auth 0.1.3 "rejects all http issuers" bug —
 * it must NOT reject `http://localhost:3000/` while it MUST reject `http://idp.example.com/`.
 *
 * @throws if the issuer uses `http:` against a non-loopback host, or an unsupported scheme.
 */
function assertIssuerTransport(issuer) {
    assertSecureTransport(issuer, "issuer");
}
/**
 * Enforce the SAME https-or-loopback transport policy on a single DISCOVERED endpoint URL
 * (`authorization_endpoint`, `token_endpoint`, `registration_endpoint`, …). A malicious or
 * misconfigured discovery document could point an endpoint at an insecure non-loopback `http:` URL
 * (or a different origin) and siphon authorization codes, refresh tokens, or client secrets — so
 * every endpoint we will actually contact is validated, not just the input issuer.
 *
 * @throws if the endpoint uses `http:` against a non-loopback host, or an unsupported scheme.
 */
function assertEndpointTransport(endpoint, name) {
    assertSecureTransport(endpoint, name);
}
/**
 * Derive the S256 PKCE challenge from a verifier: `BASE64URL-ENCODE(SHA256(ASCII(verifier)))`
 * (RFC 7636 §4.2). Exposed so the unit suite can assert the RFC 7636 Appendix-B test vector.
 */
function pkceChallengeS256(verifier) {
    return (0, node_crypto_1.createHash)("sha256").update(verifier, "ascii").digest("base64url");
}
/**
 * Generate a fresh PKCE verifier + S256 challenge. The verifier is 32 random bytes encoded
 * base64url (43 chars), comfortably inside the RFC 7636 43–128 range and using only the
 * unreserved alphabet. node:crypto only — no hand-rolled randomness.
 */
function generatePkce() {
    const verifier = (0, node_crypto_1.randomBytes)(32).toString("base64url");
    return { verifier, challenge: pkceChallengeS256(verifier), method: "S256" };
}
/**
 * Discover the provider metadata from `.well-known/openid-configuration`.
 *
 * Hardening (defence against a malicious / misconfigured discovery document):
 *  1. The INPUT issuer is transport-checked BEFORE the fetch (https-or-loopback).
 *  2. The RETURNED `issuer` MUST equal the requested issuer exactly — OIDC Discovery 1.0 §4.3
 *     requires issuer equality, and this stops a document that claims to speak for a different
 *     origin.
 *  3. EVERY endpoint we will actually contact (`authorization_endpoint`, `token_endpoint`, and
 *     `registration_endpoint` when present) is held to the SAME https-or-loopback bar as the
 *     issuer, so authorization codes / refresh tokens / client secrets cannot be redirected to an
 *     insecure non-loopback `http:` URL.
 *
 * All checks run BEFORE the metadata is returned (and before any downstream request is made).
 */
async function discoverProvider(issuer, fetchImpl = defaultFetch) {
    assertIssuerTransport(issuer);
    const url = (0, session_js_1.discoveryUrl)(issuer);
    const res = await fetchImpl(url);
    if (!res.ok) {
        throw new Error(`OIDC discovery failed (${res.status}) at ${url}`);
    }
    const meta = (await res.json());
    if (!meta.authorization_endpoint || !meta.token_endpoint) {
        throw new Error(`OIDC config at ${url} is missing authorization_endpoint or token_endpoint.`);
    }
    // OIDC Discovery 1.0 §4.3: the metadata `issuer` MUST be identical to the requested issuer.
    if (meta.issuer !== issuer) {
        throw new Error(`OIDC issuer mismatch: discovery document at ${url} declares issuer ` +
            `${meta.issuer ?? "<missing>"} but ${issuer} was requested.`);
    }
    // Apply the issuer's https-or-loopback policy to every discovered endpoint we will contact, so a
    // malicious document cannot point a sensitive endpoint at an insecure / off-origin URL.
    assertEndpointTransport(meta.authorization_endpoint, "authorization_endpoint");
    assertEndpointTransport(meta.token_endpoint, "token_endpoint");
    if (meta.registration_endpoint) {
        assertEndpointTransport(meta.registration_endpoint, "registration_endpoint");
    }
    return meta;
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
async function registerClient(meta, redirectUri, opts = {}, fetchImpl = defaultFetch) {
    if (!meta.registration_endpoint) {
        throw new Error(`Provider ${meta.issuer} advertises no registration_endpoint; supply a static client_id ` +
            `(Client Identifier Document) via staticClient() instead.`);
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
    const reg = (await res.json());
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
function staticClient(clientId, redirectUri, clientSecret) {
    return {
        client_id: clientId,
        redirect_uris: [redirectUri],
        ...(clientSecret ? { client_secret: clientSecret } : {}),
    };
}
/** Default Solid-OIDC scope set: `openid` (OIDC), `webid` (Solid profile), `offline_access` (refresh). */
exports.DEFAULT_SCOPE = "openid webid offline_access";
/** True iff the (space-delimited) scope set requests `offline_access` (a refresh token). */
function requestsOfflineAccess(scope) {
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
function buildAuthorizationUrl(params) {
    const { meta, client, redirectUri, pkce, state, nonce } = params;
    const scope = params.scope ?? exports.DEFAULT_SCOPE;
    const url = new URL(meta.authorization_endpoint);
    // Preserve any query params the provider published on its authorization_endpoint (some require
    // them) by seeding the params from the URL, then ADDING the OAuth/OIDC params.
    const q = url.searchParams;
    q.set("response_type", "code");
    q.set("client_id", client.client_id);
    q.set("redirect_uri", redirectUri);
    q.set("scope", scope);
    q.set("state", state);
    q.set("nonce", nonce);
    q.set("code_challenge", pkce.challenge);
    q.set("code_challenge_method", pkce.method);
    const prompt = params.prompt ?? (requestsOfflineAccess(scope) ? "consent" : undefined);
    if (prompt)
        q.set("prompt", prompt);
    url.search = q.toString();
    return url.toString();
}
/**
 * Start a one-shot loopback HTTP listener on `127.0.0.1` and an ephemeral port (RFC 8252 §7.3) to
 * catch the authorization-code redirect for CLI / native apps. The browser is sent here; the AS
 * appends `?code=…&state=…`. We resolve on the first matching request and serve a tiny success
 * page so the user can close the tab.
 *
 * Binds to `127.0.0.1` (never `0.0.0.0`) so the listener is never reachable off-host.
 */
async function startLoopbackListener(path = "/callback") {
    let settled = false;
    let resolveOutcome;
    const outcomePromise = new Promise((resolve) => {
        resolveOutcome = (v) => {
            settled = true;
            resolve(v);
        };
    });
    const server = (0, node_http_1.createServer)((req, res) => {
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
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const redirectUri = `http://127.0.0.1:${port}${path}`;
    const close = () => new Promise((resolve) => {
        if (!server.listening) {
            resolve();
            return;
        }
        server.close(() => resolve());
    });
    const waitForCode = async (timeoutMs = 120_000) => {
        let timer;
        const timeout = new Promise((resolve) => {
            timer = setTimeout(() => resolve({ error: "redirect_timeout" }), timeoutMs);
            if (timer && typeof timer.unref === "function")
                timer.unref();
        });
        const outcome = await Promise.race([outcomePromise, timeout]);
        if (timer)
            clearTimeout(timer);
        if ("error" in outcome) {
            throw new Error(`Authorization redirect failed: ${outcome.error}`);
        }
        return outcome;
    };
    return { redirectUri, waitForCode, close };
}
/**
 * POST to the token endpoint with a DPoP proof, handling the RFC 9449 §8 `use_dpop_nonce`
 * challenge (a 400 carrying `DPoP-Nonce`) by retrying once with the supplied nonce. Returns the
 * parsed token response plus the latest server nonce.
 */
async function postTokenWithDpop(meta, keyPair, body, client, fetchImpl) {
    const headers = (dpop) => {
        const h = {
            "content-type": "application/x-www-form-urlencoded",
            accept: "application/json",
            dpop,
        };
        // Confidential clients (DCR with a secret) authenticate with Basic; public clients send
        // client_id in the body (already set by callers) and authenticate via PKCE only.
        if (client.client_secret) {
            h.authorization =
                "Basic " +
                    Buffer.from(`${encodeURIComponent(client.client_id)}:${encodeURIComponent(client.client_secret)}`).toString("base64");
        }
        return h;
    };
    const attempt = async (nonce) => {
        const dpop = await (0, dpop_js_1.createDpopProof)({
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
    const token = (await res.json());
    return { token, ...(nonce ? { nonce } : {}) };
}
/**
 * Exchange an authorization `code` (+ PKCE `verifier`) for a DPoP-bound access token (and a refresh
 * token when `offline_access` was granted). RFC 6749 §4.1.3 + RFC 7636 §4.5 + RFC 9449.
 */
async function exchangeCode(args) {
    const fetchImpl = args.fetchImpl ?? defaultFetch;
    const keyPair = args.keyPair ?? (await (0, dpop_js_1.generateDpopKeyPair)());
    const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: args.code,
        redirect_uri: args.redirectUri,
        code_verifier: args.codeVerifier,
        client_id: args.client.client_id,
    });
    const { token, nonce } = await postTokenWithDpop(args.meta, keyPair, body, args.client, fetchImpl);
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
async function refreshSession(session, fetchImpl = defaultFetch) {
    if (!session.refreshToken) {
        throw new Error("Session has no refresh token; request the offline_access scope to enable refresh.");
    }
    const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: session.refreshToken,
        client_id: session.client.client_id,
    });
    const { token, nonce } = await postTokenWithDpop(session.providerMetadata, session.keyPair, body, session.client, fetchImpl);
    session.accessToken = token.access_token;
    session.expiresAt = Date.now() + (token.expires_in ?? 300) * 1000;
    // Rotation: adopt the new refresh token if the AS rotated it; otherwise keep the old one.
    if (token.refresh_token)
        session.refreshToken = token.refresh_token;
    if (nonce)
        session.nonce = nonce;
    // Notify the consumer so it can re-persist the rotated tokens (DPoP jkt binding preserved).
    await session.onRefresh?.(session);
    return session;
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
async function cliLogin(opts) {
    const fetchImpl = opts.fetchImpl ?? defaultFetch;
    const meta = await discoverProvider(opts.issuer, fetchImpl);
    const listener = await startLoopbackListener(opts.callbackPath ?? "/callback");
    try {
        const client = opts.clientId
            ? staticClient(opts.clientId, listener.redirectUri, opts.clientSecret)
            : await registerClient(meta, listener.redirectUri, opts.clientName ? { clientName: opts.clientName } : {}, fetchImpl);
        const pkce = generatePkce();
        const state = (0, node_crypto_1.randomBytes)(16).toString("base64url");
        const nonce = (0, node_crypto_1.randomUUID)();
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
        }
        else {
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
    }
    finally {
        await listener.close();
    }
}
//# sourceMappingURL=authCode.js.map