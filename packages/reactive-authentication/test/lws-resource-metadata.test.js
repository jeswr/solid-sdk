// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { createMemoryStore } from "@key-value-kit/storage/memory";
import { test, vi } from "vitest";
import { challengeContext } from "../src/challenge.js";
import { LWS_STORAGE_REL, TOKEN_EXCHANGE_GRANT, TokenType } from "../src/lws/constants.js";
import {
  CredentialBoundary,
  LwsTokenProvider,
  OAuthBearerTokenProvider,
  ReactiveFetchManager,
  SessionFence,
  trustAuthorizationServers,
} from "../src/mod.js";

const origin = "https://storage.example";
const storage = `${origin}/storage_1`;
const issuer = "https://issuer.example/tenant/";
const tokenEndpoint = "https://issuer.example/token";
const prefix = "/.well-known/oauth-protected-resource";
const resource = `${origin}/root/doc?view=full`;
const metadataUrl = `${origin + prefix}/root/doc?view=full`;
const storageLink = `<${storage}>; rel="${LWS_STORAGE_REL}"`;

// Exercise the public reactive client and real discovery/exchange with an injected HTTPS transport.
// No listening socket is needed; record every request, including transport security options.
function fixture({ respond, header, link = storageLink, allowInsecureRequests } = {}) {
  const requests = [];
  const exchanges = [];
  const accepted = [];
  const rejected = new Set();
  let issued = 0;
  const source = {
    id: "alice",
    getCredential: vi.fn(async () => ({
      token: "subject",
      tokenType: TokenType.jwt,
      clientId: "https://client.example/",
    })),
    forget: vi.fn(async () => {}),
  };
  const http = {
    ...(allowInsecureRequests === undefined ? {} : { allowInsecureRequests }),
    fetch: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request.clone());
      const overridden = await respond?.(request);
      if (overridden !== undefined) return overridden;
      const url = new URL(request.url);
      if (url.pathname.startsWith(prefix))
        return Response.json({
          resource: url.origin + url.pathname.slice(prefix.length) + url.search,
          authorization_servers: [issuer],
        });
      if (request.url === storage)
        return Response.json({
          id: storage,
          type: "Storage",
          service: [{ type: "StorageRoot", serviceEndpoint: `${origin}/root/` }],
        });
      if (request.url === "https://issuer.example/.well-known/lws-configuration/tenant")
        return Response.json({ issuer, token_endpoint: tokenEndpoint });
      if (request.url === tokenEndpoint) {
        exchanges.push(Object.fromEntries(new URLSearchParams(await request.text())));
        return Response.json({
          access_token: `access-${++issued}`,
          token_type: "Bearer",
          expires_in: 300,
        });
      }
      const authorization = request.headers.get("authorization");
      if (authorization?.startsWith("Bearer ") && !rejected.has(authorization)) {
        accepted.push(authorization);
        return new Response("protected");
      }
      return new Response(null, {
        status: 401,
        headers: {
          "www-authenticate":
            header ?? `Bearer resource_metadata="${origin}${prefix}${url.pathname}${url.search}"`,
          ...(link === null ? {} : { link }),
        },
      });
    },
  };
  return {
    requests,
    exchanges,
    accepted,
    rejected,
    source,
    http,
    client(options = {}, credentialSource = source) {
      const provider = new LwsTokenProvider(credentialSource, { http, ...options });
      const manager = new ReactiveFetchManager({
        providers: [provider],
        boundary: new CredentialBoundary([`${origin}/root/`]),
        fetch: http.fetch,
      });
      return { provider, manager };
    },
  };
}

test("ordinary OAuth resource_metadata challenges reach the OAuth provider after LWS declines", async () => {
  const f = fixture({ link: null });
  const { provider: lws } = f.client();
  const source = {
    id: "oauth-api",
    getAccessToken: vi.fn(async () => ({ token: "oauth-access" })),
  };
  const oauth = new OAuthBearerTokenProvider(source, { resources: [`${origin}/root/`] });
  const manager = new ReactiveFetchManager({
    providers: [lws, oauth],
    boundary: new CredentialBoundary([`${origin}/root/`]),
    fetch: f.http.fetch,
  });

  assert.equal(await (await manager.fetch(resource)).text(), "protected");
  assert.equal(source.getAccessToken.mock.calls.length, 1);
  assert.equal(f.source.getCredential.mock.calls.length, 0);
  assert.deepEqual(f.accepted, ["Bearer oauth-access"]);
  assert.deepEqual(f.exchanges, []);
  assert.deepEqual(
    f.requests.map((request) => request.url),
    [resource, resource],
    "no LWS discovery is attempted",
  );
});

for (const [name, link, matches] of [
  ["missing storage Link", null, false],
  ["wrong storage relation", `<${storage}>; rel="storage"`, false],
  ["malformed Link", "not a Link", false],
  ["LWS storage Link", storageLink, true],
  [
    "relative target and multiple relations",
    `</storage_1>; rel="alternate ${LWS_STORAGE_REL}"`,
    true,
  ],
  ["matching anchor", `${storageLink}; anchor="${resource}#section"`, true],
  ["foreign anchor", `${storageLink}; anchor="${origin}/root/other"`, false],
]) {
  test(`resource_metadata matching requires LWS evidence: ${name}`, async () => {
    const f = fixture({ link });
    const { provider, manager } = f.client();
    const request = new Request(resource);
    const challenge = challengeContext(await f.http.fetch(request));
    assert.equal(await provider.matches(request, challenge), matches);
    if (!matches) {
      await assert.rejects(
        provider.upgrade(request, challenge),
        /challenge lacks valid as_uri\/realm/,
      );
      assert.equal((await manager.fetch(resource)).status, 401);
      assert.ok(
        f.requests.every((r) => r.url === resource),
        "no discovery without LWS evidence",
      );
    }
    assert.equal(f.source.getCredential.mock.calls.length, 0);
    assert.equal(f.exchanges.length, 0);
  });
}

test("RFC 9728 validates discovery before exchange, presents Bearer, caches, renews and forgets", async () => {
  const f = fixture();
  const { provider, manager } = f.client({ legacyLwsChallenge: false });
  assert.equal(await (await manager.fetch(resource)).text(), "protected");
  assert.deepEqual(f.exchanges[0], {
    grant_type: TOKEN_EXCHANGE_GRANT,
    resource: storage,
    subject_token: "subject",
    subject_token_type: TokenType.jwt,
    client_id: "https://client.example/",
  });
  assert.equal(f.source.getCredential.mock.calls[0][0].authorizationServer.href, issuer);
  assert.equal(f.source.getCredential.mock.calls[0][0].resource.href, storage);
  assert.equal(f.source.getCredential.mock.calls[0][0].expectedGeneration, 0);
  const firstToken = f.accepted[0];
  assert.equal((await manager.fetch(`${origin}/root/another`)).status, 200);
  assert.equal(f.exchanges.length, 1, "same storage and credential share a token");
  assert.equal(f.source.getCredential.mock.calls.length, 1);
  for (const request of f.requests.filter(
    (r) => r.url === metadataUrl || r.url === storage || r.method === "HEAD",
  )) {
    assert.equal(request.credentials, "omit");
    assert.equal(request.redirect, "manual");
    assert.equal(request.headers.has("authorization"), false);
    assert.equal(request.headers.has("cookie"), false);
  }
  const discovery = f.requests.find((r) => r.url.includes("lws-configuration"));
  assert.equal(discovery.credentials, "omit");
  assert.equal(discovery.redirect, "error");
  assert.equal(f.requests.find((r) => r.url === metadataUrl).method, "GET");

  f.rejected.add(firstToken);
  assert.equal((await manager.fetch(resource)).status, 200);
  assert.equal(f.exchanges.length, 2, "a server rejection renews the cached token");
  await provider.invalidate(new Request(resource, { headers: { authorization: firstToken } }));
  assert.equal((await manager.fetch(resource)).status, 200);
  assert.equal(f.exchanges.length, 2, "a late rejection keeps the replacement");
  await provider.forget();
  assert.equal(f.source.forget.mock.calls.length, 1);
  assert.equal((await manager.fetch(resource)).status, 200);
  assert.equal(f.exchanges.length, 3, "logout fences cached tokens");
});

test("RFC 9728 token stores isolate credential contexts and renew at exp minus 30 seconds", async () => {
  const f = fixture();
  const fence = new SessionFence("lws-prm-cache", { broadcast: false });
  const shared = { namespace: "lws-prm-cache", tokenStore: createMemoryStore(), fence };
  const alice = f.client(shared);
  const bob = f.client(shared, { ...f.source, id: "bob" });
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  try {
    await alice.manager.fetch(resource);
    await bob.manager.fetch(resource);
    assert.equal(f.exchanges.length, 2, "another subject cannot reuse alice's token");
    clock.mockReturnValue(now + 269_999);
    await alice.manager.fetch(resource);
    assert.equal(f.exchanges.length, 2);
    clock.mockReturnValue(now + 270_000);
    await alice.manager.fetch(resource);
    assert.equal(f.exchanges.length, 3, "renew at the 30 second safety window");
    await bob.provider.forget();
    await alice.manager.fetch(resource);
    assert.equal(f.exchanges.length, 4, "shared logout invalidates the other instance");
  } finally {
    clock.mockRestore();
    fence.close();
  }
});

test("PRM resource comparison strips the request fragment and keeps the exact query and encoding", async () => {
  const f = fixture();
  const { manager } = f.client();
  assert.equal((await manager.fetch(`${resource}#section`)).status, 200);
  assert.equal((await manager.fetch(`${origin}/root/a%7Eb?q=%7e&x=1`)).status, 200);
  assert.ok(f.requests.some((r) => r.url === `${origin + prefix}/root/a%7Eb?q=%7e&x=1`));
});

test("same-origin HTTP PRM requires allowInsecureRequests before any discovery or credential acquisition", async () => {
  const localOrigin = origin.replace("https:", "http:");
  const localStorage = `${localOrigin}/storage_1`;
  const localResource = resource.replace("https:", "http:");
  const link = `<${localStorage}>; rel="${LWS_STORAGE_REL}"`;
  for (const allowInsecureRequests of [false, true]) {
    const f = fixture({
      allowInsecureRequests,
      respond: (request) => {
        if (request.url === localStorage)
          return Response.json({
            id: localStorage,
            type: "Storage",
            service: [{ type: "StorageRoot", serviceEndpoint: `${localOrigin}/root/` }],
          });
        if (request.url === `${localOrigin}/root/`)
          return new Response(null, { headers: { link } });
      },
    });
    const { provider } = f.client();
    const challenge = challengeContext(
      new Response(null, {
        status: 401,
        headers: {
          link,
          "www-authenticate": `Bearer resource_metadata="${metadataUrl.replace("https:", "http:")}"`,
        },
      }),
    );
    const pending = provider.upgrade(new Request(localResource), challenge);
    if (allowInsecureRequests) {
      assert.match((await pending).headers.get("authorization"), /^Bearer /);
      assert.equal(f.source.getCredential.mock.calls.length, 1);
      assert.equal(f.exchanges[0].resource, localStorage);
    } else {
      await assert.rejects(pending, /non-HTTPS/);
      assert.equal(f.requests.length, 0);
      assert.equal(f.source.getCredential.mock.calls.length, 0);
    }
  }
});

const prm = (fields) => Response.json({ resource, authorization_servers: [issuer], ...fields });
const at = (url, response) => (request) => (request.url === url ? response() : undefined);
const opaqueRedirect = () => {
  const response = new Response(null);
  Object.defineProperty(response, "type", { value: "opaqueredirect" });
  return response;
};
const followed = () => {
  const response = prm({});
  Object.defineProperty(response, "redirected", { value: true });
  return response;
};

const invalidDiscovery = [
  [
    "cross-origin resource_metadata",
    { header: 'Bearer resource_metadata="https://evil.example/prm"' },
    /origin/,
  ],
  ["invalid resource_metadata URL", { header: 'Bearer resource_metadata="invalid"' }, /origin/],
  [
    "insecure metadata downgrade",
    { header: 'Bearer resource_metadata="http://storage.example/prm"' },
    /origin/,
  ],
  [
    "PRM resource mismatch",
    { respond: at(metadataUrl, () => prm({ resource: `${origin}/root/other` })) },
    /resource does not match/,
  ],
  [
    "PRM loses query",
    { respond: at(metadataUrl, () => prm({ resource: `${origin}/root/doc` })) },
    /resource does not match/,
  ],
  [
    "PRM adds fragment",
    { respond: at(metadataUrl, () => prm({ resource: `${resource}#section` })) },
    /resource does not match/,
  ],
  [
    "PRM normalizes query",
    { respond: at(metadataUrl, () => prm({ resource: `${origin}/root/doc?view=%66ull` })) },
    /resource does not match/,
  ],
  ["PRM null", { respond: at(metadataUrl, () => Response.json(null)) }, /resource does not match/],
  [
    "PRM missing resource",
    { respond: at(metadataUrl, () => Response.json({})) },
    /resource does not match/,
  ],
  ["PRM non-JSON", { respond: at(metadataUrl, () => new Response("not JSON")) }, /JSON/],
  [
    "PRM not ok",
    { respond: at(metadataUrl, () => new Response(null, { status: 500 })) },
    /retrieved/,
  ],
  [
    "PRM 302 redirect",
    {
      respond: at(
        metadataUrl,
        () => new Response(null, { status: 302, headers: { location: `${origin}/leak` } }),
      ),
    },
    /retrieved/,
  ],
  [
    "PRM 399 redirect",
    { respond: at(metadataUrl, () => new Response(null, { status: 399 })) },
    /retrieved/,
  ],
  ["PRM opaque redirect", { respond: at(metadataUrl, opaqueRedirect) }, /retrieved/],
  ["PRM followed redirect", { respond: at(metadataUrl, followed) }, /retrieved/],
  [
    "missing authorization_servers",
    { respond: at(metadataUrl, () => Response.json({ resource })) },
    /authorization_servers/,
  ],
  [
    "non-array authorization_servers",
    { respond: at(metadataUrl, () => prm({ authorization_servers: issuer })) },
    /authorization_servers/,
  ],
  [
    "empty authorization_servers",
    { respond: at(metadataUrl, () => prm({ authorization_servers: [] })) },
    /No trusted/,
  ],
  [
    "invalid authorization_servers",
    {
      respond: at(metadataUrl, () =>
        prm({
          authorization_servers: [
            null,
            17,
            {},
            "invalid",
            "ftp://evil.example/",
            "https://u:p@evil.example/",
          ],
        }),
      ),
    },
    /No trusted/,
  ],
  [
    "insecure AS",
    { respond: at(metadataUrl, () => prm({ authorization_servers: ["http://issuer.example/"] })) },
    /non-HTTPS/,
  ],
  ["ambiguous storage Link", { link: `${storageLink}, ${storageLink}` }, /StorageRoot/],
  [
    "cross-origin storage Link",
    { link: `<https://evil.example/storage>; rel="${LWS_STORAGE_REL}"` },
    /StorageRoot/,
  ],
  [
    "StorageRoot origin mismatch",
    {
      respond: at(storage, () =>
        Response.json({
          id: storage,
          type: "Storage",
          service: [{ type: "StorageRoot", serviceEndpoint: "https://evil.example/root/" }],
        }),
      ),
    },
    /StorageRoot/,
  ],
  [
    "unconfirmed StorageRoot",
    {
      respond: at(
        `${origin}/root/`,
        () =>
          new Response(null, {
            headers: { link: `<https://storage.example/other>; rel="${LWS_STORAGE_REL}"` },
          }),
      ),
    },
    /StorageRoot/,
  ],
  [
    "metadata issuer mismatch",
    {
      respond: (r) =>
        r.url.includes("lws-configuration")
          ? Response.json({ issuer: origin, token_endpoint: tokenEndpoint })
          : undefined,
    },
    /issuer/,
  ],
  [
    "metadata redirect",
    {
      respond: (r) =>
        r.url.includes("lws-configuration")
          ? new Response(null, { status: 302, headers: { location: `${origin}/leak` } })
          : undefined,
    },
    /unexpected HTTP status/,
  ],
  [
    "metadata opaque redirect",
    { respond: (r) => (r.url.includes("lws-configuration") ? opaqueRedirect() : undefined) },
    /redirect/,
  ],
  [
    "metadata followed redirect",
    { respond: (r) => (r.url.includes("lws-configuration") ? followed() : undefined) },
    /redirect/,
  ],
];
for (const [name, options, error] of invalidDiscovery) {
  test(`RFC 9728 fails before credential acquisition: ${name}`, async () => {
    const f = fixture(options);
    const { manager } = f.client();
    await assert.rejects(manager.fetch(resource), error);
    assert.equal(f.source.getCredential.mock.calls.length, 0);
    assert.equal(f.exchanges.length, 0);
    assert.equal(
      f.requests.some((r) => r.url === tokenEndpoint),
      false,
    );
    assert.equal(
      f.requests.some(
        (r) => new URL(r.url).hostname === "evil.example" || new URL(r.url).pathname === "/leak",
      ),
      false,
    );
  });
}

test("RFC 9728 selects the first listed AS accepted by the explicit trust policy", async () => {
  const f = fixture({
    respond: at(metadataUrl, () =>
      prm({
        authorization_servers: ["https://untrusted.example/", issuer, "https://unused.example/"],
      }),
    ),
  });
  const bindings = [];
  const trust = trustAuthorizationServers([issuer]);
  const { manager } = f.client({
    trustAuthorizationServer: async (binding) => {
      bindings.push(binding);
      return trust(binding);
    },
  });
  assert.equal((await manager.fetch(resource)).status, 200);
  assert.deepEqual(
    bindings.map((b) => b.authorizationServer.href),
    ["https://untrusted.example/", issuer],
  );
  assert.ok(bindings.every((b) => b.realm.href === storage && b.resource.href === resource));
  assert.equal(
    f.requests.some((r) => r.url.includes("untrusted.example")),
    false,
  );
});

test("RFC 9728 fails closed when no listed AS passes the policy", async () => {
  const f = fixture();
  const { manager } = f.client({ trustAuthorizationServer: trustAuthorizationServers([]) });
  await assert.rejects(manager.fetch(resource), /No trusted/);
  assert.equal(f.source.getCredential.mock.calls.length, 0);
  assert.equal(f.exchanges.length, 0);
  assert.equal(
    f.requests.some((r) => r.url.includes("issuer.example")),
    false,
  );
});

test("RFC 9728 works with the default non-reactive transport", async () => {
  const f = fixture();
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(f.http.fetch);
  try {
    const { manager } = f.client({ http: undefined });
    assert.equal((await manager.fetch(resource)).status, 200);
  } finally {
    fetch.mockRestore();
  }
});

test("legacyLwsChallenge disables legacy matching and direct upgrades; default legacy behavior remains", async () => {
  const header = `Bearer as_uri="${origin}/", realm="${origin}/root/"`;
  const f = fixture({
    header,
    respond: (r) =>
      r.url === `${origin}/.well-known/lws-configuration`
        ? Response.json({ issuer: `${origin}/`, token_endpoint: tokenEndpoint })
        : undefined,
  });
  const { provider, manager } = f.client({ legacyLwsChallenge: false });
  const request = new Request(resource);
  const challenge = challengeContext(await f.http.fetch(request));
  assert.equal(await provider.matches(request, challenge), false);
  assert.equal(await provider.matches(request), false);
  await assert.rejects(provider.upgrade(request, challenge), /challenge/);
  assert.equal((await manager.fetch(resource)).status, 401);
  assert.equal(f.source.getCredential.mock.calls.length, 0);
  const legacy = f.client();
  assert.equal(await legacy.provider.matches(request, challenge), true);
  assert.equal((await legacy.manager.fetch(resource)).status, 200);
  assert.equal(f.exchanges[0].resource, `${origin}/root/`);
});

test("resource_metadata takes precedence within a Bearer challenge and across separate challenges", async () => {
  for (const header of [
    'Bearer as_uri="https://evil.example/", realm="' +
      storage +
      '", resource_metadata="' +
      metadataUrl +
      '"',
    'Bearer as_uri="https://evil.example/", realm="' +
      storage +
      '", Bearer resource_metadata="' +
      metadataUrl +
      '"',
  ]) {
    const f = fixture({ header });
    assert.equal((await f.client().manager.fetch(resource)).status, 200);
    assert.equal(
      f.requests.some((r) => r.url.includes("evil.example")),
      false,
    );
  }
  const f = fixture({
    header:
      'Bearer as_uri="' +
      origin +
      '/", realm="' +
      origin +
      '/root/", resource_metadata="https://evil.example/prm"',
  });
  await assert.rejects(f.client().manager.fetch(resource), /origin/);
  assert.equal(
    f.source.getCredential.mock.calls.length,
    0,
    "invalid PRM cannot fall back to legacy",
  );
  assert.equal(f.exchanges.length, 0);
});

test("without an LWS storage Link, resource_metadata leaves legacy matching and upgrades in control", async () => {
  const legacy = `Bearer as_uri="${origin}/", realm="${origin}/root/"`;
  for (const header of [
    `${legacy}, resource_metadata="https://evil.example/prm"`,
    `${legacy}, Bearer resource_metadata="https://evil.example/prm"`,
  ]) {
    for (const legacyLwsChallenge of [true, false]) {
      const f = fixture({
        header,
        link: null,
        respond: at(`${origin}/.well-known/lws-configuration`, () =>
          Response.json({ issuer: `${origin}/`, token_endpoint: tokenEndpoint }),
        ),
      });
      const { provider, manager } = f.client({ legacyLwsChallenge });
      const request = new Request(resource);
      const challenge = challengeContext(await f.http.fetch(request));
      assert.equal(await provider.matches(request, challenge), legacyLwsChallenge);
      if (legacyLwsChallenge) {
        assert.equal((await manager.fetch(resource)).status, 200);
        assert.equal(f.source.getCredential.mock.calls.length, 1);
        assert.equal(f.exchanges[0].resource, `${origin}/root/`);
      } else {
        await assert.rejects(
          provider.upgrade(request, challenge),
          /challenge lacks valid as_uri\/realm/,
        );
        assert.equal((await manager.fetch(resource)).status, 401);
        assert.equal(f.source.getCredential.mock.calls.length, 0);
        assert.equal(f.exchanges.length, 0);
      }
      assert.equal(
        f.requests.some((r) => r.url.includes(prefix) || r.url.includes("evil.example")),
        false,
        "resource_metadata is ignored without LWS evidence",
      );
    }
  }
});

test("logout during RFC 9728 discovery or exchange fences late results", async () => {
  for (const blockAt of [metadataUrl, tokenEndpoint]) {
    const started = Promise.withResolvers();
    const gate = Promise.withResolvers();
    let block = true;
    const f = fixture({
      respond: async (request) => {
        if (block && request.url === blockAt) {
          block = false;
          started.resolve();
          await gate.promise;
        }
      },
    });
    const { provider, manager } = f.client();
    const pending = manager.fetch(resource);
    const failed = assert.rejects(
      pending,
      (e) => e.name === "AbortError" || e.name === "SessionSupersededError",
    );
    await started.promise;
    await provider.forget();
    gate.resolve();
    await failed;
    assert.equal(f.accepted.length, 0, "late credentials are never attached");
    if (blockAt === metadataUrl) assert.equal(f.source.getCredential.mock.calls.length, 0);
    const count = f.exchanges.length;
    assert.equal((await manager.fetch(resource)).status, 200);
    assert.equal(f.exchanges.length, count + 1, "no late access token was cached");
  }
});
