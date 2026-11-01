// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { createMemoryStore } from "@key-value-kit/storage/memory";
import { beforeEach, test, vi } from "vitest";
import { challengeContext } from "../src/challenge.js";
import {
  ClientCredentialsTokenProvider,
  CredentialBoundary,
  DPoPTokenProvider,
  LwsTokenProvider,
  OAuthBearerTokenProvider,
  OAuthCodeSource,
  ReactiveAuthenticationClient,
  SessionFence,
  SolidUmaTokenProvider,
} from "../src/mod.js";
import { OidcSession } from "../src/OidcSession.js";

beforeEach(async () => {
  // Credential acquisition is covered by the protocol suites. Keep presentation, provider fences,
  // request cloning, challenge cleanup and transport real while controlling the acquired session.
  vi.spyOn(OidcSession.prototype, "get").mockResolvedValue({
    generation: 0,
    tokenResult: { access_token: "access", id_token: "id-token" },
    client: { client_id: "client" },
    dpopKey: await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
      "sign",
      "verify",
    ]),
  });
});

const kinds = ["OAuth Bearer", "LWS", "DPoP", "client credentials", "UMA"];

async function fixture(kind, fence) {
  const options = fence === undefined ? {} : { fence };
  const url = "https://storage.example/private";
  const issuer = "https://storage.example";
  const as = { getAuthorizationServer: async () => ({ issuer }) };
  const http = {
    fetch: async (input) => {
      if (new URL(input).pathname.includes(".well-known")) {
        return Response.json({
          issuer,
          token_endpoint: `${issuer}/token`,
          uma_profiles_supported: ["http://openid.net/specs/openid-connect-core-1_0.html#IDToken"],
        });
      }
      return Response.json({
        access_token: "exchanged",
        token_type: kind === "LWS" ? "Bearer" : "DPoP",
      });
    },
  };
  let challenge = "Bearer";
  let provider;
  if (kind === "OAuth Bearer") {
    provider = new OAuthBearerTokenProvider(
      { id: "api", getAccessToken: async () => ({ token: "access" }) },
      { resources: [url], ...options },
    );
  } else if (kind === "client credentials") {
    provider = new ClientCredentialsTokenProvider(
      {
        getAuthorizationServer: async () => ({
          issuer: "https://issuer.example/",
          token_endpoint: "https://issuer.example/token",
        }),
      },
      "client",
      "secret",
      {
        ...options,
        http: {
          fetch: async () => Response.json({ access_token: "client-access", token_type: "DPoP" }),
        },
      },
    );
  } else if (kind === "LWS") {
    provider = new LwsTokenProvider(
      {
        id: "subject",
        getCredential: async () => ({
          token: "subject-token",
          tokenType: "urn:ietf:params:oauth:token-type:jwt",
          clientId: "client",
        }),
      },
      { http, ...options },
    );
    challenge = `Bearer as_uri="${issuer}", realm="${issuer}/"`;
  } else {
    const session = { http, context: (request) => request.url, ...options };
    if (kind === "DPoP") {
      provider = new DPoPTokenProvider("https://app.example/cb", {}, as, {}, undefined, session);
    } else {
      provider = new SolidUmaTokenProvider("https://app.example/cb", {}, as, {}, session);
      challenge = `UMA as_uri="${issuer}", ticket="permission"`;
    }
  }
  const headers = new Headers({ "www-authenticate": challenge });
  const boundary = new CredentialBoundary([url]);
  return { provider, url, headers, boundary };
}

for (const kind of kinds) {
  for (const mode of ["private provider fence", "separate manager fence", "shared fence"]) {
    test(`${kind}: forget after upgrade prevents transport with a ${mode}`, async () => {
      const fence = new SessionFence(crypto.randomUUID(), { broadcast: false });
      const other = new SessionFence(crypto.randomUUID(), { broadcast: false });
      const { provider, url, headers, boundary } = await fixture(
        kind,
        mode === "private provider fence" ? undefined : fence,
      );
      const started = Promise.withResolvers();
      const gate = Promise.withResolvers();
      const sent = [];
      const upgrade = vi.spyOn(provider, "upgrade");
      const client = new ReactiveAuthenticationClient({
        providers: [provider],
        boundary,
        ...(mode === "private provider fence"
          ? {}
          : { fence: mode === "shared fence" ? fence : other }),
        fetch: async (request) => {
          sent.push(request);
          if (request.headers.has("authorization")) return new Response("sent");
          return new Response(
            new ReadableStream({
              cancel: async () => {
                started.resolve();
                await gate.promise;
              },
            }),
            { status: 401, headers },
          );
        },
      });
      try {
        const rejected = assert.rejects(client.fetch(url), { name: "SessionSupersededError" });
        await started.promise;
        const upgraded = await upgrade.mock.results[0].value;
        assert.ok(upgraded.headers.has("authorization"));
        await provider.forget();
        gate.resolve();
        await rejected;
        assert.equal(
          upgraded.signal.aborted,
          true,
          "upgraded requests retain provider cancellation",
        );
        assert.equal(sent.length, 1, "no credentialed request reached the transport");
      } finally {
        gate.resolve();
        fence.close();
        other.close();
      }
    });
  }

  test(`${kind}: pre-send validation observes provider-only durable logout without broadcast`, async () => {
    const store = createMemoryStore();
    const namespace = crypto.randomUUID();
    const fence = new SessionFence(namespace, { store, broadcast: false });
    const peer = new SessionFence(namespace, { store, broadcast: false });
    const { provider, url, headers, boundary } = await fixture(kind, fence);
    const sent = [];
    const client = new ReactiveAuthenticationClient({
      providers: [provider],
      boundary,
      fetch: async (request) => {
        sent.push(request);
        if (request.headers.has("authorization")) return new Response("sent");
        return new Response(
          new ReadableStream({
            cancel: async () => {
              await peer.supersede();
              assert.equal(fence.signal.aborted, false, "only a durable read can observe logout");
            },
          }),
          { status: 401, headers },
        );
      },
    });
    try {
      await assert.rejects(client.fetch(url), { name: "SessionSupersededError" });
      assert.equal(sent.length, 1, "the provider's generation is checked before transport");
    } finally {
      fence.close();
      peer.close();
    }
  });

  test(`${kind}: provider logout aborts an upgraded request already in transport`, async () => {
    const { provider, url, headers, boundary } = await fixture(kind);
    const started = Promise.withResolvers();
    let sending;
    const client = new ReactiveAuthenticationClient({
      providers: [provider],
      boundary,
      fetch: async (request) => {
        if (!request.headers.has("authorization"))
          return new Response(null, { status: 401, headers });
        sending = request;
        return await new Promise((_, reject) => {
          request.signal.addEventListener("abort", () => reject(request.signal.reason), {
            once: true,
          });
          started.resolve();
        });
      },
    });
    const rejected = assert.rejects(client.fetch(url), { name: "SessionSupersededError" });
    await started.promise;
    await provider.forget();
    await rejected;
    assert.equal(sending.signal.aborted, true);
  });
}

test("UMA nonce retry retains the provider fence signal", async () => {
  const { provider, url, headers } = await fixture("UMA");
  const request = new Request(url);
  const first = await provider.upgrade(
    request,
    challengeContext(new Response(null, { status: 401, headers })),
  );
  const response = new Response(null, {
    status: 401,
    headers: { "www-authenticate": 'DPoP error="use_dpop_nonce"', "DPoP-Nonce": "resource-nonce" },
  });
  const retry = await provider.upgrade(request, { ...challengeContext(response), request: first });
  assert.ok(retry.headers.has("authorization"));
  await provider.forget();
  assert.equal(retry.signal.aborted, true);
});

for (const operation of ["DPoP restore", "OAuth source"]) {
  test(`${operation} rechecks cancellation after its fence read`, async () => {
    const store = createMemoryStore();
    const started = Promise.withResolvers();
    const gate = Promise.withResolvers();
    let reads = 0;
    const fence = new SessionFence(crypto.randomUUID(), {
      broadcast: false,
      store: {
        ...store,
        getItem: async (key) => {
          if (++reads === 2) {
            started.resolve();
            await gate.promise;
          }
          return await store.getItem(key);
        },
      },
    });
    const controller = new AbortController();
    const reason = new Error("cancelled during validation");
    try {
      let pending;
      if (operation === "DPoP restore") {
        const { provider, url } = await fixture("DPoP", fence);
        pending = provider.restore(new Request(url, { signal: controller.signal }));
      } else {
        const source = new OAuthCodeSource({
          authorizationServer: { issuer: "https://issuer.example/" },
          clientId: "client",
          redirectUri: "https://app.example/cb",
          scopes: ["read"],
          codeProvider: {},
          fence,
        });
        pending = source.getAccessToken({ signal: controller.signal });
      }
      const rejected = assert.rejects(pending, (error) => error === reason);
      await started.promise;
      controller.abort(reason);
      gate.resolve();
      await rejected;
      if (operation === "OAuth source")
        assert.equal(
          OidcSession.prototype.get.mock.calls.length,
          0,
          "no credentials acquired after cancellation",
        );
    } finally {
      gate.resolve();
      fence.close();
    }
  });
}
