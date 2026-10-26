// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { createMemoryStore } from "@key-value-kit/storage/memory";
import { test } from "vitest";
import {
  CredentialBoundary,
  GoogleTokenSource,
  MsalTokenSource,
  OAuthBearerTokenProvider,
  ReactiveAuthenticationClient,
  ReactiveFetchManager,
  SessionFence,
} from "../src/mod.js";
import { serve, transport } from "./helpers/http.js";

const signal = () => new AbortController().signal;
function google() {
  return {
    config: undefined,
    initTokenClient(config) {
      this.config = config;
      return { requestAccessToken() {} };
    },
    hasGrantedAllScopes: () => true,
    revoke(_token, callback) {
      callback({ successful: false });
    },
  };
}

for (const stage of [
  "challenge cleanup",
  "fenced challenge cleanup",
  "transport fence verification",
]) {
  for (const attempt of ["initial", "renewal"]) {
    test(`Bearer resource revocation during ${stage} prevents the ${attempt} transport send`, async () => {
      const root = "https://api.example/";
      const resources = new CredentialBoundary([root]);
      const boundary = new CredentialBoundary([root]);
      const started = Promise.withResolvers();
      const gate = Promise.withResolvers();
      const generations = createMemoryStore();
      const revokeAt = attempt === "initial" ? 1 : 2;
      let cleanups = 0;
      const fence = new SessionFence(`oauth-send-${crypto.randomUUID()}`, {
        broadcast: false,
        store: {
          ...generations,
          getItem: async (key) => {
            if (stage === "transport fence verification" && cleanups === revokeAt) {
              started.resolve();
              await gate.promise;
            }
            return await generations.getItem(key);
          },
        },
      });
      let tokens = 0;
      const source = {
        id: "revocable-api",
        getAccessToken: async () => ({ token: `access-${++tokens}` }),
      };
      const provider = new OAuthBearerTokenProvider(source, { resources, fence });
      const sent = [];
      const client = new ReactiveAuthenticationClient({
        providers: [provider],
        boundary,
        ...(stage === "challenge cleanup" ? {} : { fence }),
        fetch: async (request) => {
          sent.push(request);
          if (sent.length > revokeAt) return new Response("accepted");
          return new Response(
            new ReadableStream({
              cancel: async () => {
                if (++cleanups === revokeAt && stage !== "transport fence verification") {
                  started.resolve();
                  await gate.promise;
                }
              },
            }),
            { status: 401, headers: { "www-authenticate": "Bearer" } },
          );
        },
      });
      try {
        const pending = client.fetch(`${root}private`, { method: "PUT", body: "write" });
        const rejected = assert.rejects(pending, /not a resource of revocable-api/);
        await started.promise;
        assert.equal(tokens, revokeAt, "the provider already attached the token");
        resources.delete(root);
        assert.equal(boundary.allows(`${root}private`), true, "the manager still permits the API");
        gate.resolve();
        await rejected;
        assert.equal(sent.length, revokeAt, "no transport call after resource revocation");
        assert.equal(sent[0].headers.has("authorization"), false);
        if (attempt === "renewal")
          assert.equal(sent[1].headers.get("authorization"), "Bearer access-1");
      } finally {
        gate.resolve();
        fence.close();
      }
    });
  }
}

for (const stage of ["initial token", "renewal token", "fence verification"]) {
  test(`Bearer resource revocation during ${stage} prevents the outstanding credentialed send`, async () => {
    const server = await serve(
      (request) =>
        new Response(null, {
          status:
            request.headers.has("authorization") &&
            (stage !== "renewal token" ||
              request.headers.get("authorization") === "Bearer access-2")
              ? 200
              : 401,
          headers: { "www-authenticate": "Bearer" },
        }),
    );
    const started = Promise.withResolvers();
    const gate = Promise.withResolvers();
    const generations = createMemoryStore();
    let reads = 0;
    const fence = new SessionFence(`oauth-resources-${crypto.randomUUID()}`, {
      broadcast: false,
      store: {
        ...generations,
        getItem: async (key) => {
          if (++reads === 2 && stage === "fence verification") {
            started.resolve();
            await gate.promise;
          }
          return await generations.getItem(key);
        },
      },
    });
    const root = `${server.url}/`;
    const resources = new CredentialBoundary([root], { allowInsecureHttp: true });
    const boundary = new CredentialBoundary([root], { allowInsecureHttp: true });
    const pauseAt = stage === "renewal token" ? 2 : 1;
    let tokens = 0;
    const source = {
      id: "revocable-api",
      getAccessToken: async () => {
        const current = ++tokens;
        if (current === pauseAt && stage !== "fence verification") {
          started.resolve();
          await gate.promise;
        }
        return { token: `access-${current}` };
      },
    };
    const provider = new OAuthBearerTokenProvider(source, { resources, fence });
    const manager = new ReactiveFetchManager({ providers: [provider], boundary, fetch: transport });
    try {
      const pending = manager.fetch(`${root}private`, { method: "PUT", body: "write" });
      const rejected = assert.rejects(pending, /not a resource of revocable-api/);
      await started.promise;
      resources.delete(root);
      assert.equal(boundary.allows(`${root}private`), true, "the manager still permits the API");
      gate.resolve();
      await rejected;
      assert.equal(tokens, pauseAt);
      assert.equal(server.requests.length, pauseAt, "no request sent after provider revocation");
      assert.equal(
        server.requests.filter((request) => request.headers.has("authorization")).length,
        pauseAt - 1,
      );
      assert.equal(await provider.matches(new Request(`${root}private`)), false);
    } finally {
      gate.resolve();
      fence.close();
      await server.close();
    }
  });
}

test("Google rejects empty scopes and aborted UI, and exposes a working interaction action", async () => {
  const sdk = google();
  assert.throws(() => new GoogleTokenSource(sdk, { clientId: "c", scopes: [] }), /scope/);
  const source = new GoogleTokenSource(sdk, { clientId: "c", scopes: ["s"], revokeOnForget: true });
  const controller = new AbortController();
  controller.abort(new Error("aborted"));
  await assert.rejects(source.authorize(controller.signal), /aborted/);
  let interaction;
  await assert.rejects(source.getAccessToken({ signal: signal() }), (error) => {
    interaction = error;
    return error.name === "InteractionRequiredError";
  });
  const pending = interaction.authorize();
  sdk.config.callback({
    access_token: "token",
    token_type: "Bearer",
    expires_in: 3600,
    scope: "s",
  });
  assert.equal((await pending).token, "token");
  await assert.rejects(source.forget(), (error) => error.code === "revocation_failed");
  const denied = source.authorize();
  const check = assert.rejects(denied, /Google authorization failed: access_denied/);
  sdk.config.callback({ error: "access_denied" });
  await check;
});

test("MSAL validates scopes and carries explicit authority and UI hints into requests", async () => {
  const account = { homeAccountId: "alice", username: "alice" };
  const requests = [];
  let selected = null;
  const result = () => ({ accessToken: "token", account, scopes: ["s"], expiresOn: null });
  const sdk = {
    getActiveAccount: () => selected,
    acquireTokenPopup: async (options) => {
      requests.push(options);
      selected = account;
      return result();
    },
    acquireTokenSilent: async (options) => {
      requests.push(options);
      return result();
    },
  };
  assert.throws(() => new MsalTokenSource(sdk, { scopes: [] }), /scope/);
  const source = new MsalTokenSource(sdk, {
    scopes: ["s"],
    authority: "https://issuer.example/tenant",
    prompt: "select_account",
    loginHint: "alice",
  });
  let interaction;
  await assert.rejects(source.getAccessToken({ signal: signal() }), (error) => {
    interaction = error;
    return error.name === "InteractionRequiredError";
  });
  assert.deepEqual(await interaction.authorize(), { token: "token" });
  assert.deepEqual(requests[0], {
    scopes: ["s"],
    authority: "https://issuer.example/tenant",
    prompt: "select_account",
    loginHint: "alice",
  });
  assert.deepEqual(await source.getAccessToken({ signal: signal() }), { token: "token" });
  assert.equal(requests[1].authority, "https://issuer.example/tenant");
  // With no selected or returned account, a structurally valid result remains usable for this call.
  const anonymous = new MsalTokenSource(
    {
      ...sdk,
      getActiveAccount: () => null,
      acquireTokenPopup: async () => ({ ...result(), account: null }),
    },
    { scopes: ["s"] },
  );
  assert.deepEqual(await anonymous.authorize(), { token: "token" });
  const failure = new Error("popup could not start");
  const broken = new MsalTokenSource(
    {
      ...sdk,
      acquireTokenPopup() {
        throw failure;
      },
    },
    { scopes: ["s"] },
  );
  await assert.rejects(broken.authorize(), (error) => error === failure);
  // A synchronous SDK failure releases the shared interaction lock.
  await assert.rejects(broken.authorize(), (error) => error === failure);
});

test("Bearer providers renew expired credentials, reject repeated failures, and preserve newer rejections", async () => {
  assert.throws(() => new OAuthBearerTokenProvider({}, { resources: [] }), /at least one resource/);
  const request = new Request("https://api.example/resource");
  let tokens = [{ token: "expired", expiresAt: 0 }, { token: "fresh" }];
  const source = { id: "api", getAccessToken: async () => tokens.shift() };
  const provider = new OAuthBearerTokenProvider(source, { resources: ["https://api.example/"] });
  assert.equal(await provider.matches(request), true);
  await provider.invalidate(request);
  assert.equal((await provider.upgrade(request)).headers.get("authorization"), "Bearer fresh");
  tokens = [
    { token: "bad", expiresAt: 0 },
    { token: "still-bad", expiresAt: 0 },
  ];
  await assert.rejects(provider.upgrade(request), /expired or rejected/);
  const gate = Promise.withResolvers();
  const readStarted = Promise.withResolvers();
  source.getAccessToken = async () => {
    readStarted.resolve();
    return gate.promise;
  };
  const pending = provider.upgrade(request);
  await readStarted.promise;
  await provider.invalidate(new Request(request, { headers: { authorization: "Bearer other" } }));
  gate.resolve({ token: "fresh" });
  assert.equal((await pending).headers.get("authorization"), "Bearer fresh");
  source.getAccessToken = async (options) => {
    assert.equal(options.rejectedToken, "other");
    return { token: "replacement" };
  };
  assert.equal(
    (await provider.upgrade(request)).headers.get("authorization"),
    "Bearer replacement",
  );
});

for (const stage of ["initial token", "renewal token"]) {
  test(`Bearer providers refuse tokens rejected during the ${stage} read`, async () => {
    const started = Promise.withResolvers();
    const gate = Promise.withResolvers();
    const hints = [];
    const source = {
      id: "api",
      getAccessToken: async ({ rejectedToken }) => {
        hints.push(rejectedToken);
        if (stage === "renewal token" && hints.length === 1)
          return { token: "expired", expiresAt: 0 };
        started.resolve();
        await gate.promise;
        return { token: "rejected" };
      },
    };
    const provider = new OAuthBearerTokenProvider(source, { resources: ["https://api.example/"] });
    const request = new Request("https://api.example/resource");
    const rejected = assert.rejects(provider.upgrade(request), /expired or rejected/);
    await started.promise;
    await provider.invalidate(
      new Request(request, { headers: { authorization: "Bearer rejected" } }),
    );
    gate.resolve();
    await rejected;
    assert.deepEqual(hints, [undefined, stage === "initial token" ? "rejected" : "expired"]);
  });
}

test("Bearer rejections follow token values across replacements and clear on logout", async () => {
  let token = "rejected";
  const source = { id: "api", getAccessToken: async () => ({ token }) };
  const provider = new OAuthBearerTokenProvider(source, { resources: ["https://api.example/"] });
  const request = new Request("https://api.example/resource");
  await provider.invalidate(
    new Request(request, { headers: { authorization: "Bearer rejected" } }),
  );
  await assert.rejects(provider.upgrade(request), /expired or rejected/);
  token = "replacement";
  assert.equal(
    (await provider.upgrade(request)).headers.get("authorization"),
    "Bearer replacement",
  );
  token = "rejected";
  await assert.rejects(provider.upgrade(request), /expired or rejected/);
  await provider.forget();
  assert.equal((await provider.upgrade(request)).headers.get("authorization"), "Bearer rejected");
});

test("Bearer rejection history retains the 100 most recently rejected token values", async () => {
  let token;
  const source = { id: "api", getAccessToken: async () => ({ token }) };
  const provider = new OAuthBearerTokenProvider(source, { resources: ["https://api.example/"] });
  const request = new Request("https://api.example/resource");
  const reject = (value) =>
    provider.invalidate(new Request(request, { headers: { authorization: `Bearer ${value}` } }));

  for (let i = 0; i < 100; i++) await reject(`token-${i}`);
  await reject("token-0"); // A repeated 401 refreshes this value's place in the history.
  for (let i = 100; i < 150; i++) await reject(`token-${i}`);

  for (let i = 1; i <= 50; i++) {
    token = `token-${i}`;
    assert.equal((await provider.upgrade(request)).headers.get("authorization"), `Bearer ${token}`);
  }
  for (const value of ["token-0", ...Array.from({ length: 99 }, (_, i) => `token-${i + 51}`)]) {
    token = value;
    await assert.rejects(provider.upgrade(request), /expired or rejected/);
  }
});
