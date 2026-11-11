// AUTHORED-BY Codex GPT-6
import { type Identity as Claims, DPoPTokenProvider } from "@jeswr/reactive-authentication";
import { afterEach, expect, test, vi } from "vitest";
import { createAgentAuth } from "./agent.js";
import {
  createPodAuth,
  type FetchAccount,
  type FetchForOptions,
  type PodAuthOptions,
} from "./index.js";
import { forClientCredentials } from "./node.js";
import { createProviders } from "./providers.js";
import { createMemoryStore, createMockOp } from "./testing.js";

const relay = "https://relay.example";
const path = `${relay}/push/registrations/account`;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function fixture(config: Parameters<typeof createMockOp>[0] = {}) {
  const op = createMockOp({ refreshTokens: true, protectedUrls: [`${relay}/`], ...config });
  const transport = vi.fn<typeof fetch>((input, init) => op.fetch(input, init));
  vi.stubGlobal("fetch", transport);
  const options: PodAuthOptions = {
    clientId: op.clientId,
    redirectUri: op.redirectUri,
    storage: { sessions: createMemoryStore(), caches: createMemoryStore() },
    boundary: { roots: [op.root], automatic: false },
    ui: { getWebId: vi.fn(async () => op.webId!), getCode: vi.fn(op.getCode) },
  };
  const auth = createPodAuth(options);
  const account = { webId: op.webId ?? null, issuer: op.issuer };
  return { op, auth, options, account, transport };
}
function jwt(proof: string) {
  return JSON.parse(Buffer.from(proof.split(".")[1]!, "base64url").toString());
}
const authenticated = (requests: Request[], url: string) =>
  requests.filter((r) => r.url === url && r.headers.has("authorization"));

test("extra origins reuse the exact Solid grant and key, leaving ordinary fetch and storage roots unchanged", async () => {
  const f = fixture();
  await f.auth.login();
  expect((await f.auth.fetch(path)).status).toBe(401);
  const before = await f.auth.remembered();
  const scoped = f.auth.fetchFor(f.account, { extraResourceOrigins: [relay] });
  expect(
    (
      await scoped(path, {
        method: "PUT",
        body: '{"topics":[]}',
        headers: { "content-type": "application/json" },
      })
    ).status,
  ).toBe(200);
  expect((await scoped(f.op.root + "private")).status).toBe(200);
  const outgoing = authenticated(f.op.requests, path)[0]!;
  const pod = authenticated(f.op.requests, f.op.root + "private")[0]!;
  expect(outgoing.headers.get("authorization")).toBe(pod.headers.get("authorization"));
  expect(jwt(outgoing.headers.get("dpop")!)).toMatchObject({ htm: "PUT", htu: path });
  expect(outgoing.headers.get("dpop")).not.toBe(pod.headers.get("dpop"));
  expect(await outgoing.text()).toBe('{"topics":[]}');
  expect(outgoing.redirect).toBe("manual"); // engine never follows an authenticated hop automatically
  expect(outgoing.credentials).toBe("omit");
  expect(f.op.stats).toMatchObject({ authorizations: 1, tokens: 1, refreshes: 0, exchanges: 0 });
  expect(f.options.ui.getCode).toHaveBeenCalledOnce();
  expect((await f.auth.identity())?.storages).toEqual([f.op.root]);
  expect(await f.auth.remembered()).toEqual(before);
  expect((await f.auth.fetch(path)).status).toBe(401);
  expect(authenticated(f.op.requests, path)).toHaveLength(1);
});

test("selectors, options and explicit origins fail closed before any network", async () => {
  const f = fixture();
  expect(() => f.auth.fetchFor(f.account)).toThrow("unavailable");
  await f.auth.login();
  const before = f.transport.mock.calls.length;
  for (const account of [
    null,
    undefined,
    false,
    {},
    { ...f.account, webId: "https://id.example/other#me" },
    { ...f.account, issuer: "https://other.example/" },
  ])
    expect(() => f.auth.fetchFor(account as FetchAccount)).toThrow("unavailable");
  for (const options of [
    null,
    false,
    [],
    { unexpected: true },
    { extraResourceOrigins: null },
    { extraResourceOrigins: "https://relay.example" },
  ])
    expect(() => f.auth.fetchFor(f.account, options as FetchForOptions)).toThrow(TypeError);
  for (const origin of [
    null,
    1,
    "",
    "not a url",
    "http://localhost",
    "https://relay.example/",
    "https://relay.example/path",
    "https://relay.example?",
    "https://relay.example#",
    "https://user@relay.example",
    "https://RELAY.example",
    "https://relay.example:443",
    "https://*.relay.example",
    "https://relay*.example",
    "https://relay.example.",
    "https://*",
    " https://relay.example",
    "https:\\relay.example",
  ])
    expect(() => f.auth.fetchFor(f.account, { extraResourceOrigins: [origin as string] })).toThrow(
      TypeError,
    );
  expect(f.transport).toHaveBeenCalledTimes(before);
});

test("options are snapshotted and no-options handles retain normal pod behavior", async () => {
  const f = fixture();
  await f.auth.login();
  for (const options of [undefined, {}, { extraResourceOrigins: [] }]) {
    const normal = f.auth.fetchFor(f.account, options);
    expect((await normal(f.op.root + "private")).status).toBe(200);
    expect((await normal(path)).status).toBe(401);
  }
  const origins = [relay];
  const selected = { ...f.account };
  const scoped = f.auth.fetchFor(selected, { extraResourceOrigins: origins });
  selected.webId = "https://id.example/other#me";
  origins.push("https://evil.example");
  expect((await scoped(path)).status).toBe(200);
  for (const url of [
    "https://evil.example/private",
    "https://relay.example.evil.test/private",
    "https://relay.example:444/private",
    "http://relay.example/private",
  ]) {
    expect((await scoped(url)).status).toBe(401);
    expect(authenticated(f.op.requests, url)).toHaveLength(0);
  }
});

test("logout and a later login permanently invalidate an old handle, even for the same account", async () => {
  const f = fixture();
  await f.auth.login();
  const normal = f.auth.fetchFor(f.account);
  const scoped = f.auth.fetchFor(f.account, { extraResourceOrigins: [relay] });
  await f.auth.logout();
  const before = f.transport.mock.calls.length;
  await expect(scoped(path)).rejects.toThrow();
  await expect(normal(f.op.root)).rejects.toThrow();
  expect(f.transport).toHaveBeenCalledTimes(before);
  await f.auth.login();
  await expect(scoped(path)).rejects.toThrow();
  expect((await f.auth.fetchFor(f.account, { extraResourceOrigins: [relay] })(path)).status).toBe(
    200,
  );
});

test("a durable logout from another instance invalidates scoped handles before I/O", async () => {
  const f = fixture();
  await f.auth.login();
  const scoped = f.auth.fetchFor(f.account, { extraResourceOrigins: [relay] });
  await createPodAuth(f.options).logout();
  const before = f.transport.mock.calls.length;
  await expect(scoped(path)).rejects.toThrow();
  expect(f.transport).toHaveBeenCalledTimes(before);
  expect(await f.auth.identity()).toBeNull();
});

test("an in-flight unauthenticated challenge cannot attach credentials after logout", async () => {
  const f = fixture();
  await f.auth.login();
  const started = Promise.withResolvers<void>();
  const proceed = Promise.withResolvers<void>();
  f.transport.mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url === path) {
      started.resolve();
      await proceed.promise;
    }
    return await f.op.fetch(request);
  });
  const pending = f.auth.fetchFor(f.account, { extraResourceOrigins: [relay] })(path);
  const result = pending.catch((error) => error);
  await started.promise;
  await f.auth.logout();
  proceed.resolve();
  expect(await result).toBeInstanceOf(Error);
  expect(authenticated(f.op.requests, path)).toHaveLength(0);
});

test.each([
  'UMA as_uri="https://relay.example/", ticket="ticket"',
  'Bearer resource_metadata="https://relay.example/metadata"',
  'Bearer as_uri="https://relay.example/", realm="https://relay.example/"',
  'Basic realm="relay"',
])("extra resources reject protocol switching: %s", async (challenge) => {
  const f = fixture();
  await f.auth.login();
  f.transport.mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    return request.url === path
      ? new Response(null, { status: 401, headers: { "www-authenticate": challenge } })
      : f.op.fetch(request);
  });
  expect((await f.auth.fetchFor(f.account, { extraResourceOrigins: [relay] })(path)).status).toBe(
    401,
  );
  expect(f.op.stats).toMatchObject({ authorizations: 1, tokens: 1, exchanges: 0, refreshes: 0 });
});

test("extra requests refuse redirects before and after authentication, retaining caller headers on the admitted origin only", async () => {
  for (const credentialed of [false, true]) {
    const f = fixture();
    await f.auth.login();
    const seen: Request[] = [];
    f.transport.mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      seen.push(request);
      if (request.url === path && (request.headers.has("authorization") || !credentialed)) {
        // A browser enforces redirect:error before exposing an anonymous redirect response.
        if (!credentialed) {
          expect(request.redirect).toBe("error");
          throw new TypeError("Redirect refused");
        }
        return new Response(null, {
          status: 307,
          headers: { location: "https://evil.example/private" },
        });
      }
      return await f.op.fetch(request);
    });
    const scoped = f.auth.fetchFor(f.account, { extraResourceOrigins: [relay] });
    await expect(
      scoped(path, {
        method: "POST",
        body: "{}",
        headers: { "installation-proof": "device-proof" },
        redirect: "follow",
      }),
    ).rejects.toThrow("Redirect");
    expect(seen.every((request) => new URL(request.url).origin !== "https://evil.example")).toBe(
      true,
    );
    expect(
      seen
        .filter((request) => request.url === path)
        .every((request) => request.headers.get("installation-proof") === "device-proof"),
    ).toBe(true);
  }
});

test("extra fetch shares refresh rotation and token invalidation with the pod grant", async () => {
  const f = fixture();
  await f.auth.login();
  const scoped = f.auth.fetchFor(f.account, { extraResourceOrigins: [relay] });
  let refused = false;
  f.transport.mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url === path && request.headers.has("authorization") && !refused) {
      refused = true;
      return new Response(null, { status: 401, headers: { "www-authenticate": "DPoP" } });
    }
    return await f.op.fetch(request);
  });
  expect((await scoped(path)).status).toBe(200);
  expect(f.op.stats).toMatchObject({ authorizations: 1, tokens: 1, refreshes: 1, reuse: 0 });
  expect((await f.auth.fetch(f.op.root + "private")).status).toBe(200);
  expect(f.op.stats.refreshes).toBe(1);
  const extra = authenticated(f.op.requests, path).at(-1)!;
  const pod = authenticated(f.op.requests, f.op.root + "private").at(-1)!;
  expect(extra.headers.get("authorization")).toBe(pod.headers.get("authorization"));
});

test("a scoped provider never opens sign-in when its existing grant expires without refresh", async () => {
  const f = fixture({ refreshTokens: false });
  await f.auth.login();
  const scoped = f.auth.fetchFor(f.account, { extraResourceOrigins: [relay] });
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 301000);
  await expect(scoped(path)).rejects.toThrow("unavailable");
  expect(f.options.ui.getCode).toHaveBeenCalledOnce();
  expect(f.op.stats.authorizations).toBe(1);
  expect(authenticated(f.op.requests, path)).toHaveLength(0);
});

test.each([
  undefined,
  "webId",
  "issuer",
  "subject",
  "clientId",
] as const)("a mismatched scoped identity fails before credentials leave: %s", async (field) => {
  const f = fixture();
  const identity = await f.auth.login();
  const scoped = f.auth.fetchFor(f.account, { extraResourceOrigins: [relay] });
  vi.spyOn(DPoPTokenProvider.prototype, "identity").mockResolvedValue(
    field === undefined ? undefined : ({ ...identity, [field]: "foreign" } as Claims),
  );
  await expect(scoped(path)).rejects.toThrow("unavailable");
  expect(authenticated(f.op.requests, path)).toHaveLength(0);
});

test("extra origins require a current human Solid-OIDC session", async () => {
  const f = fixture({ webId: null });
  await f.auth.login({ issuer: f.op.issuer });
  expect(() => f.auth.fetchFor(f.account, { extraResourceOrigins: [relay] })).toThrow(
    "Solid-OIDC account",
  );
  expect((await f.auth.fetchFor(f.account)(f.op.root + "private")).status).toBe(200);
  const g = fixture();
  await g.auth.login();
  await g.auth.fetch(g.op.root + "lws");
  expect((await g.auth.identity())?.protocol).toBe("lws");
  expect(() => g.auth.fetchFor(g.account, { extraResourceOrigins: [relay] })).toThrow(
    "Solid-OIDC account",
  );
  const providers = createProviders(g.options, { challenge: () => {}, session: async () => {} });
  const identity = (await g.auth.identity())!;
  expect(() =>
    providers.fetchFor([relay], { ...identity, protocol: "solid-oidc" }, () => {}),
  ).toThrow("Solid-OIDC account");
});

test("agent fetchFor keeps its ordinary boundary and refuses extra resource origins", async () => {
  const credentials = { clientId: "agent", clientSecret: "credential" };
  const f = fixture({ clientCredentials: credentials });
  const auth = await forClientCredentials({
    issuer: f.op.issuer,
    ...credentials,
    boundary: [f.op.root],
    fetch: f.op.fetch,
  });
  const account = { webId: null, issuer: f.op.issuer };
  expect(() => auth.fetchFor(account, { extraResourceOrigins: [relay] })).toThrow(
    "Solid-OIDC account",
  );
  expect(() => auth.fetchFor({ ...account, issuer: "https://other.example/" })).toThrow(
    "unavailable",
  );
  const scoped = auth.fetchFor(account);
  expect((await scoped(f.op.root + "private")).status).toBe(200);
  expect((await scoped(path)).status).toBe(401);
  await auth.logout();
  await expect(scoped(f.op.root)).rejects.toThrow("unavailable");
  await auth.login();
  await expect(scoped(f.op.root)).rejects.toThrow("unavailable");
  const empty = createAgentAuth(
    { boundary: { roots: [f.op.root] } },
    { kind: "client-credentials", issuer: f.op.issuer, ...credentials },
  );
  expect(() => empty.fetchFor(account)).toThrow("unavailable");
});

test("scoped handles reject immediately while logout is still revoking credentials", async () => {
  const f = fixture({ revocation: true });
  await f.auth.login();
  const scoped = f.auth.fetchFor(f.account, { extraResourceOrigins: [relay] });
  const started = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  f.transport.mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url === f.op.issuer + "revoke") {
      started.resolve();
      await release.promise;
    }
    return await f.op.fetch(request);
  });
  const loggingOut = f.auth.logout();
  await started.promise;
  await expect(scoped(path)).rejects.toThrow("unavailable");
  expect(authenticated(f.op.requests, path)).toHaveLength(0);
  release.resolve();
  await loggingOut;
});

test("an identity mismatch cannot use the scoped handle while the invalid grant is being discarded", async () => {
  const f = fixture({ revocation: true });
  const identity = await f.auth.login();
  const scoped = f.auth.fetchFor(f.account, { extraResourceOrigins: [relay] });
  const started = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  f.transport.mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url === f.op.issuer + "revoke") {
      started.resolve();
      await release.promise;
    }
    return await f.op.fetch(request);
  });
  vi.spyOn(DPoPTokenProvider.prototype, "identity").mockResolvedValueOnce({
    ...identity,
    webId: "https://foreign.example/#me",
  } as Claims);
  const mismatch = f.auth.fetch(f.op.root + "private").catch((error) => error);
  await started.promise;
  await expect(scoped(path)).rejects.toThrow("unavailable");
  expect(authenticated(f.op.requests, path)).toHaveLength(0);
  release.resolve();
  expect(await mismatch).toBeInstanceOf(Error);
});

test("scoped requests preserve the configured replay body cap", async () => {
  const f = fixture();
  f.options.maxReplayBodyBytes = 3;
  const auth = createPodAuth(f.options);
  await auth.login();
  const scoped = auth.fetchFor(f.account, { extraResourceOrigins: [relay] });
  await expect(scoped(path, { method: "PUT", body: "1234" })).rejects.toThrow();
  expect(authenticated(f.op.requests, path)).toHaveLength(0);
});

test("bootstrap logins and restored sessions retain their original grant context for extra origins", async () => {
  const f = fixture();
  f.options.boundary = {};
  const auth = createPodAuth(f.options);
  await auth.login({ issuer: f.op.issuer });
  expect((await auth.fetchFor(f.account, { extraResourceOrigins: [relay] })(path)).status).toBe(
    200,
  );
  expect(f.op.stats).toMatchObject({ authorizations: 1, tokens: 1, refreshes: 0 });
  const restored = createPodAuth(f.options);
  await restored.restore();
  expect((await restored.fetchFor(f.account, { extraResourceOrigins: [relay] })(path)).status).toBe(
    200,
  );
  expect(f.op.stats).toMatchObject({ authorizations: 1, tokens: 1, refreshes: 1, reuse: 0 });
});

test("a missing client identity cannot release scoped credentials", async () => {
  const f = fixture();
  const identity = await f.auth.login();
  const scoped = f.auth.fetchFor(f.account, { extraResourceOrigins: [relay] });
  vi.spyOn(DPoPTokenProvider.prototype, "identity").mockResolvedValue({
    ...identity,
    clientId: undefined,
  } as Claims);
  await expect(scoped(path)).rejects.toThrow("unavailable");
  expect(authenticated(f.op.requests, path)).toHaveLength(0);
});

test("account fetch snapshots URL and request options before its durable generation check", async () => {
  const f = fixture();
  await f.auth.login();
  const scoped = f.auth.fetchFor(f.account, { extraResourceOrigins: [relay] });
  const url = new URL(path),
    options = { method: "PUT", body: "original" };
  const pending = scoped(url, options);
  url.pathname = "/other";
  options.body = "changed";
  expect((await pending).status).toBe(200);
  expect(await authenticated(f.op.requests, path)[0]!.text()).toBe("original");
  expect(authenticated(f.op.requests, `${relay}/other`)).toHaveLength(0);
});

test("LWS sessions reject extra origins without network or UI, including pre-existing handles", async () => {
  const f = fixture();
  await f.auth.login();
  const scoped = f.auth.fetchFor(f.account, { extraResourceOrigins: [relay] });
  await f.auth.fetch(f.op.root + "lws");
  expect((await f.auth.identity())?.protocol).toBe("lws");
  const before = f.transport.mock.calls.length;
  expect(() => f.auth.fetchFor(f.account, { extraResourceOrigins: [relay] })).toThrow("Solid-OIDC");
  await expect(scoped(path)).rejects.toThrow("unavailable");
  expect(f.transport).toHaveBeenCalledTimes(before);
  expect(f.options.ui.getCode).toHaveBeenCalledOnce();
  expect((await f.auth.fetchFor(f.account)(f.op.root + "lws")).status).toBe(200);
});

test.each([
  "Blob",
  "File",
] as const)("%s uploads bypass the replay buffer cap through both wrappers and retry DPoP nonces", async (kind) => {
  for (const extra of [false, true]) {
    const f = fixture();
    const auth = createPodAuth({ ...f.options, maxReplayBodyBytes: 3 });
    await auth.login();
    const url = extra ? path : f.op.root + "upload";
    const attempts: Request[] = [];
    let challenged = false;
    f.transport.mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      if (request.url === url) {
        attempts.push(request.clone());
        if (request.headers.has("authorization") && !challenged) {
          challenged = true;
          return new Response(null, {
            status: 401,
            headers: {
              "www-authenticate": 'DPoP error="use_dpop_nonce"',
              "dpop-nonce": "upload-nonce",
            },
          });
        }
      }
      return await f.op.fetch(request);
    });
    const content = "upload larger than the stream buffer cap";
    const body =
      kind === "Blob"
        ? new Blob([content], { type: "application/octet-stream" })
        : new File([content], "upload.bin", { type: "application/octet-stream" });
    const scoped = auth.fetchFor(f.account, extra ? { extraResourceOrigins: [relay] } : undefined);
    expect((await scoped(url, { method: "PUT", body })).status).toBe(200);
    expect(challenged).toBe(true);
    expect(attempts).toHaveLength(3);
    for (const request of attempts) {
      expect(await request.text()).toBe(content);
      expect(request.headers.get("content-type")).toBe("application/octet-stream");
    }
    expect(jwt(attempts.at(-1)!.headers.get("dpop")!)).toMatchObject({
      nonce: "upload-nonce",
      htm: "PUT",
      htu: url,
    });
    expect(f.op.stats.accepted).toBe(1); // mock OP verifies the final proof's signature and token binding
  }
});

test.each([
  "token",
  "register",
])("an admitted issuer origin never permits resource credentials at its %s endpoint", async (endpoint) => {
  const f = fixture();
  await f.auth.login();
  const scoped = f.auth.fetchFor(f.account, {
    extraResourceOrigins: [new URL(f.op.issuer).origin],
  });
  const before = f.transport.mock.calls.length;
  for (const suffix of ["", "?resource=true", "#fragment"]) {
    await expect(scoped(f.op.issuer + endpoint + suffix)).rejects.toThrow(
      "OIDC credential endpoints",
    );
  }
  expect(f.transport).toHaveBeenCalledTimes(before);
  expect(authenticated(f.op.requests, f.op.issuer + endpoint)).toHaveLength(0);
});

test("credential endpoints remain excluded when the issuer advertises a different host", async () => {
  const f = fixture({ tokenEndpoint: relay + "/token", registrationEndpoint: relay + "/register" });
  await f.auth.login();
  const scoped = f.auth.fetchFor(f.account, { extraResourceOrigins: [relay] });
  const before = f.transport.mock.calls.length;
  await expect(scoped(relay + "/token")).rejects.toThrow("OIDC credential endpoints");
  await expect(scoped(relay + "/register")).rejects.toThrow("OIDC credential endpoints");
  expect(f.transport).toHaveBeenCalledTimes(before);
});

// AUTHORED-BY Claude Opus 5.5
test("credential endpoints advertised with a DNS trailing dot stay excluded", async () => {
  const f = fixture({
    tokenEndpoint: `${relay}./token`,
    registrationEndpoint: `${relay}./register`,
  });
  await f.auth.login();
  const scoped = f.auth.fetchFor(f.account, { extraResourceOrigins: [relay] });
  const before = f.transport.mock.calls.length;
  await expect(scoped(`${relay}/token`)).rejects.toThrow("OIDC credential endpoints");
  await expect(scoped(`${relay}/register`)).rejects.toThrow("OIDC credential endpoints");
  expect(f.transport).toHaveBeenCalledTimes(before);
});

test("extra resources work when the issuer advertises no dynamic registration endpoint", async () => {
  const f = fixture();
  f.transport.mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const response = await f.op.fetch(request);
    if (request.url === f.op.issuer + ".well-known/openid-configuration") {
      const { registration_endpoint: _registration, ...metadata } = await response.json();
      return Response.json(metadata);
    }
    return response;
  });
  await f.auth.login();
  expect((await f.auth.fetchFor(f.account, { extraResourceOrigins: [relay] })(path)).status).toBe(
    200,
  );
});
