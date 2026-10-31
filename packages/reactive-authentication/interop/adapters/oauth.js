// Standard OAuth 2.0 / OpenID Connect providers through OAuthCodeSource + OAuthBearerTokenProvider:
// authorization code + S256 PKCE in a real browser, Bearer requests to a real API (the provider's own
// read-only API, or a local API validating the provider's tokens), refresh, logout and boundary checks.
import { createMemoryStore } from "@key-value-kit/storage/memory";
import {
  CredentialBoundary,
  OAuthBearerTokenProvider,
  OAuthCodeSource,
  ReactiveFetchManager,
  SessionFence,
} from "../../dist/mod.js";
import { loopbackRedirectProblem } from "../lib/callbackServer.js";
import { recordingFetch } from "../lib/recorder.js";
import { decoy, introspect, introspectingApi } from "../lib/resourceServers.js";

/**
 * @typedef {object} OAuthTargetConfig
 * @property {string} [issuer] discovered issuer (exactly one of issuer / authorizationServer)
 * @property {"oidc"|"oauth2"} [discovery]
 * @property {object} [authorizationServer] trusted explicit metadata for providers without discovery
 * @property {string} clientId
 * @property {string} [clientSecret] confidential (server-side) clients only
 * @property {"client_secret_basic"|"client_secret_post"} [tokenEndpointAuthMethod]
 * @property {string[]} scopes
 * @property {string} redirectUri loopback redirect URI registered for the test client
 * @property {string} [resource]
 * @property {string} [audience]
 * @property {Record<string, string>} [parameters]
 * @property {string} [prompt]
 * @property {{url: string, headers?: Record<string, string>, identity?: {field: string, expected?: string}}
 *   | {local: "introspecting", audience: string, introspection: {clientId: string, clientSecret: string}, identity?: {field: string, expected?: string}}} api
 * @property {{subject?: string}} [oidc] expected ID token subject
 * @property {{clientId: string, clientSecret: string}} [introspection] lets logout checks ask the provider directly
 * @property {number} [tokenLifetimeSeconds] for the expiry scenario
 * @property {boolean} [insecure]
 */

/** Validates an OAuth target configuration before any network request; returns problems. */
export function validateOAuthConfig(config) {
  const problems = [];
  if ((config.issuer === undefined) === (config.authorizationServer === undefined))
    problems.push("configure exactly one of issuer or authorizationServer");
  if (typeof config.clientId !== "string" || config.clientId === "")
    problems.push("clientId is required");
  if (!Array.isArray(config.scopes)) problems.push("scopes must be a list");
  const redirect = loopbackRedirectProblem(config.redirectUri);
  if (redirect !== undefined) problems.push(redirect);
  if (config.api?.local === undefined) {
    try {
      if (new URL(config.api?.url).protocol !== "https:" && config.insecure !== true)
        problems.push("api.url must be https");
    } catch {
      problems.push("api.url (or api.local) is required");
    }
  }
  return problems;
}

/** Presents a refresh token directly to the token endpoint; true when the provider refuses it (invalid_grant). */
async function refreshRefused(tokenEndpoint, config, refreshToken) {
  const headers = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  const form = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
  if (config.clientSecret === undefined) form.set("client_id", config.clientId);
  else
    headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`).toString("base64")}`;
  const response = await fetch(tokenEndpoint, { method: "POST", headers, body: form });
  const result = await response.json().catch(() => ({}));
  return response.status === 400 && result.error === "invalid_grant";
}

const exchanges = (recorder, grant) =>
  recorder.log.filter((e) => e.grantType === grant && e.status === 200).length;

export function oauthScenarios(config, env) {
  let api;
  let metadata;
  const insecure = config.insecure === true;

  async function setup() {
    if (api !== undefined) return api;
    metadata =
      config.authorizationServer ??
      (await (
        await fetch(
          new URL(".well-known/openid-configuration", `${config.issuer.replace(/\/?$/, "/")}`),
        )
      ).json());
    if (config.api.local === "introspecting") {
      api = await introspectingApi({
        issuer: metadata.issuer,
        audience: config.api.audience,
        jwksUri: metadata.jwks_uri,
        introspection: { endpoint: metadata.introspection_endpoint, ...config.api.introspection },
      });
      api.resource = `${api.url}/me`;
      api.prefix = `${api.url}/`;
    } else {
      const url = new URL(config.api.url);
      // `api.resources`: the credential boundary for the token, when the probe's directory is too broad (e.g. /userinfo at an origin root).
      const prefix =
        config.api.resources?.[0] ??
        `${url.origin}${url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1)}`;
      api = { resource: url.href, prefix, close: async () => {} };
    }
    return api;
  }

  function client({ sessionStore, fence, managerBoundary = [] } = {}) {
    const code = env.codeProvider();
    const recorder = recordingFetch();
    const source = new OAuthCodeSource({
      ...(config.issuer === undefined
        ? { authorizationServer: config.authorizationServer }
        : { issuer: config.issuer }),
      ...(config.discovery === undefined ? {} : { discovery: config.discovery }),
      clientId: config.clientId,
      ...(config.clientSecret === undefined
        ? {}
        : {
            clientSecret: config.clientSecret,
            tokenEndpointAuthMethod: config.tokenEndpointAuthMethod,
          }),
      redirectUri: config.redirectUri,
      scopes: config.scopes,
      ...(config.resource === undefined ? {} : { resource: config.resource }),
      ...(config.audience === undefined ? {} : { audience: config.audience }),
      ...(config.parameters === undefined ? {} : { parameters: config.parameters }),
      ...(config.prompt === undefined ? {} : { prompt: config.prompt }),
      codeProvider: code,
      http: recorder.http(insecure),
      ...(sessionStore === undefined ? {} : { sessionStore, fence, namespace: "ra-interop" }),
    });
    const resources = new CredentialBoundary([api.prefix], { allowInsecureHttp: insecure });
    const bearer = new OAuthBearerTokenProvider(source, { resources });
    const boundary = new CredentialBoundary([api.prefix, ...managerBoundary], {
      allowInsecureHttp: true,
    });
    const manager = new ReactiveFetchManager({
      providers: [bearer],
      boundary,
      fetch: recorder.fetch,
      ...(fence === undefined ? {} : { fence }),
    });
    return { code, recorder, source, manager };
  }

  async function call(manager, signal) {
    const response = await manager.fetch(api.resource, {
      headers: config.api.headers ?? {},
      signal,
    });
    const body = response.headers.get("content-type")?.includes("json")
      ? await response.json()
      : (await response.body?.cancel(), undefined);
    return { status: response.status, body };
  }

  function checkIdentity(ctx, body) {
    const expected = config.api.identity;
    if (expected === undefined) return;
    const value = body?.[expected.field];
    ctx.check(
      value !== undefined && value !== null && value !== "",
      `the API response identifies the user (${expected.field})`,
    );
    if (expected.expected !== undefined)
      ctx.same(
        String(value),
        expected.expected,
        `the API identifies the configured test account (${expected.field})`,
      );
  }

  const shared = () => {
    const sessionStore = createMemoryStore();
    const generations = createMemoryStore();
    return {
      sessionStore,
      fence: () => new SessionFence("ra-interop", { store: generations, broadcast: false }),
    };
  };

  const scenarios = [
    {
      id: "oauth.login-api",
      async run(ctx, state) {
        await setup();
        const c = client();
        state.main = c;
        const mark = c.recorder.mark();
        const { status, body } = await call(c.manager, ctx.signal);
        ctx.equal(status, 200, "API status after reactive authorization");
        checkIdentity(ctx, body);

        const attempts = c.recorder
          .since(mark)
          .filter((e) => `${e.origin}${e.path}` === api.resource.replace(/[?#].*$/, ""));
        ctx.check(
          attempts[0]?.authorization === undefined && attempts[0]?.status === 401,
          "the first attempt carried no credentials and was challenged",
        );
        ctx.equal(
          attempts.at(-1).authorization,
          "Bearer",
          "the retried request used the Bearer scheme",
        );
        ctx.check(!attempts.some((a) => a.dpop), "no DPoP proof was sent to a Bearer API");
        ctx.equal(exchanges(c.recorder, "authorization_code"), 1, "code exchanges");
        const request = c.code.requests.at(-1);
        ctx.equal(request.codeChallengeMethod, "S256", "PKCE method");
        ctx.check(request.hasState, "state sent");
        const oidc = config.scopes.includes("openid");
        ctx.equal(request.hasNonce, oidc, "a nonce is sent exactly when openid is requested");
        const tokenRequest = c.recorder.log.find((e) => e.grantType === "authorization_code");
        ctx.equal(
          tokenRequest.authorization,
          config.clientSecret === undefined
            ? undefined
            : config.tokenEndpointAuthMethod === "client_secret_post"
              ? undefined
              : "Basic",
          "client authentication at the token endpoint",
        );
        ctx.check(!tokenRequest.dpop, "no DPoP proof sent to a generic OAuth server");

        const identity = await c.source.identity();
        if (oidc) {
          ctx.check(
            identity !== undefined,
            "an OpenID Connect session reports the validated ID token identity",
          );
          if (config.oidc?.subject !== undefined)
            ctx.same(
              identity.subject,
              config.oidc.subject,
              "ID token subject is the configured test user",
            );
        } else {
          ctx.equal(identity, undefined, "plain OAuth reports no identity");
        }
        ctx.note({
          oidc,
          scope: request.scope,
          prompt: request.prompt,
          resourceIndicator: request.resource,
          audienceParameter: request.audience,
          refreshTokenIssued: typeof c.recorder.lastTokens?.refresh_token === "string",
        });
      },
    },
    {
      id: "oauth.boundary",
      after: ["oauth.login-api"],
      async run(ctx) {
        // The manager's boundary would allow the decoy; the provider's resources do not include it.
        const other = await decoy();
        try {
          const c = client({ managerBoundary: [`${other.url}/`] });
          ctx.equal((await call(c.manager, ctx.signal)).status, 200, "API status");
          const response = await c.manager.fetch(`${other.url}/steal`, { signal: ctx.signal });
          ctx.equal(
            response.status,
            401,
            "the decoy's challenge was not answered with credentials",
          );
          ctx.check(
            other.seen.length >= 1 && other.seen.every((s) => !s.credentials),
            "the decoy never received credentials",
          );
        } finally {
          await other.close();
        }
      },
    },
    {
      id: "oauth.refresh-restore",
      needs: ["refreshTokens"],
      after: ["oauth.login-api"],
      async run(ctx, state) {
        const { sessionStore, fence } = shared();
        state.shared = { sessionStore, fence };
        const first = client({ sessionStore, fence: fence() });
        ctx.equal((await call(first.manager, ctx.signal)).status, 200, "first instance API status");
        ctx.equal(
          exchanges(first.recorder, "authorization_code"),
          1,
          "the first instance authorized",
        );
        let previous = first.recorder.lastTokens?.refresh_token;
        ctx.check(typeof previous === "string", "the provider issued a refresh token");
        const rotation = ctx.expects(env, "refreshRotation");
        const rounds = rotation ? 2 : 1;
        for (let round = 1; round <= rounds; round++) {
          const restored = client({ sessionStore, fence: fence() });
          const { status, body } = await call(restored.manager, ctx.signal);
          ctx.equal(status, 200, `restored instance ${round} API status`);
          checkIdentity(ctx, body);
          ctx.equal(restored.code.calls, 0, `restored instance ${round} needed no authorization`);
          ctx.equal(
            exchanges(restored.recorder, "refresh_token"),
            1,
            `restored instance ${round} used one refresh grant`,
          );
          const next = restored.recorder.lastTokens?.refresh_token ?? previous;
          if (rotation) ctx.differ(next, previous, `refresh ${round} rotated the refresh token`);
          previous = next;
        }
        let familyRevoked;
        if (rotation && !env.live) {
          // Single use, on disposable local fixtures only (never replay a live account's grant), and on a
          // separate session: providers may revoke the whole token family on reuse (Keycloak does).
          const separate = shared();
          const one = client({ sessionStore: separate.sessionStore, fence: separate.fence() });
          ctx.equal(
            (await call(one.manager, ctx.signal)).status,
            200,
            "reuse check: first instance API status",
          );
          const spent = one.recorder.lastTokens?.refresh_token;
          const two = client({ sessionStore: separate.sessionStore, fence: separate.fence() });
          ctx.equal(
            (await call(two.manager, ctx.signal)).status,
            200,
            "reuse check: restored instance API status",
          );
          ctx.differ(
            two.recorder.lastTokens?.refresh_token,
            spent,
            "reuse check: the refresh rotated the token",
          );
          ctx.check(
            await refreshRefused(metadata.token_endpoint, config, spent),
            "a spent refresh token is refused on reuse (invalid_grant)",
          );
          const three = client({ sessionStore: separate.sessionStore, fence: separate.fence() });
          familyRevoked =
            (await call(three.manager, ctx.signal)).status !== 200 || three.code.calls > 0;
        }
        ctx.note({
          restoredInstances: rounds,
          rotationVerified: rotation,
          reuseRefusalVerified: rotation && !env.live,
          familyRevokedOnReuse: familyRevoked,
        });
      },
    },
    {
      id: "oauth.expiry-renewal",
      needs: ["shortLivedTokens"],
      after: ["oauth.login-api"],
      timeoutMs: 180_000,
      async run(ctx, { main }) {
        const lifetime = Number(config.tokenLifetimeSeconds);
        ctx.check(lifetime > 0 && lifetime < 60, "the target declares a short token lifetime");
        const before = exchanges(main.recorder, "refresh_token");
        await new Promise((resolve) => setTimeout(resolve, (lifetime + 1) * 1000));
        ctx.equal(
          (await call(main.manager, ctx.signal)).status,
          200,
          "API status after the access token expired",
        );
        ctx.check(
          exchanges(main.recorder, "refresh_token") > before,
          "the expired access token was renewed with a refresh grant",
        );
        ctx.equal(
          exchanges(main.recorder, "authorization_code"),
          1,
          "no new authorization was needed",
        );
      },
    },
    {
      id: "oauth.concurrent-refresh",
      // Single-flight refresh matters for any provider; rotation itself is checked in oauth.refresh-restore.
      needs: ["refreshTokens"],
      after: ["oauth.refresh-restore"],
      async run(ctx, { shared: { sessionStore, fence } }) {
        // A restored instance has no access token: six concurrent requests must share one refresh grant,
        // because a rotating provider rejects (and may revoke the family on) a reused refresh token.
        const c = client({ sessionStore, fence: fence() });
        const results = await Promise.all(
          Array.from({ length: 6 }, () => call(c.manager, ctx.signal)),
        );
        ctx.check(
          results.every((r) => r.status === 200),
          `concurrent API statuses ${results.map((r) => r.status).join(",")}`,
        );
        ctx.equal(
          c.recorder.log.filter((e) => e.grantType === "refresh_token").length,
          1,
          "refresh grants for six concurrent requests",
        );
        ctx.equal(c.code.calls, 0, "no authorization was needed");
      },
    },
    {
      id: "oauth.logout",
      after: ["oauth.login-api"],
      async run(ctx) {
        const c = client();
        ctx.equal((await call(c.manager, ctx.signal)).status, 200, "API status before logout");
        const refreshToken = c.recorder.lastTokens?.refresh_token;
        const mark = c.recorder.mark();
        await c.manager.logout();
        const revocations = c.recorder
          .since(mark)
          .filter((e) => e.method === "POST" && /revoke|revocation/i.test(e.path));
        if (ctx.expects(env, "revocation")) {
          ctx.check(
            typeof refreshToken === "string",
            "revocation is expected, so a refresh token must have been issued to revoke",
          );
          ctx.check(
            revocations.length === 1 && revocations[0].status === 200,
            "the refresh token was revoked at the provider",
          );
          if (config.introspection !== undefined) {
            const endpoint = metadata.introspection_endpoint;
            ctx.equal(
              await introspect(
                { endpoint, ...config.introspection },
                refreshToken,
                "refresh_token",
              ),
              false,
              "the provider reports the refresh token inactive after logout",
            );
          }
        }
        ctx.note({ revocationRequests: revocations.length });
        ctx.equal(
          (await call(c.manager, ctx.signal)).status,
          200,
          "API status after logout (re-authorized)",
        );
        ctx.equal(
          exchanges(c.recorder, "authorization_code"),
          2,
          "logout forgot the session: a new authorization was needed",
        );
      },
    },
    {
      id: "oauth.audience-mismatch",
      needs: ["audienceRestriction"],
      async run(ctx) {
        // Tokens for another audience are refused by the API: the client must give up after a bounded retry.
        await setup();
        const c = client();
        const seen = api.seen.length;
        const { status } = await call(c.manager, ctx.signal);
        ctx.equal(status, 401, "final status for a token the API does not accept");
        const attempts = api.seen.slice(seen).filter((s) => s.scheme === "Bearer").length;
        ctx.check(attempts >= 1 && attempts <= 2, `bounded Bearer attempts (${attempts})`);
        ctx.equal(exchanges(c.recorder, "authorization_code"), 1, "one authorization");
      },
    },
  ];
  return {
    scenarios,
    close: async () => {
      await api?.close();
    },
  };
}
