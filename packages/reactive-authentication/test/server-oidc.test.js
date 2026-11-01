// AUTHORED-BY Codex GPT-6.1-Sol
import { decodeJwt, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, expect, test, vi } from "vitest";
import { lwsStorage } from "../../mcp-oauth/test/lws-storage.ts";
// Shared offline issuer verifies PKCE, DPoP signatures, key binding and refresh rotation.
import {
  POD_CALLBACK,
  POD_CLIENT,
  POD_ISSUER,
  POD_ROOT,
  podIssuer,
} from "../../mcp-oauth/test/pod-issuer.ts";
import {
  createServerOidcClient,
  exportServerDpopKey,
  importServerDpopKey,
  SERVER_MAX_REPLAY_BODY_BYTES,
} from "../src/ServerOidcClient.js";

afterEach(() => vi.restoreAllMocks());
async function fixture(wrapFetch = (fetcher) => fetcher, extra = {}) {
  const op = podIssuer();
  const options = {
    issuer: POD_ISSUER,
    clientId: POD_CLIENT,
    redirectUri: POD_CALLBACK,
    fetch: wrapFetch(op.fetch, op),
    ...extra,
  };
  const client = await createServerOidcClient(options);
  const begin = await client.authorizationUrl();
  const login = () => client.handleCallback({ url: op.callback(begin.url) }, begin.state);
  return { op, options, client, begin, login };
}

test("exchanges the verified server ID token for LWS Bearer access and reuses/renews it", async () => {
  let lws;
  const f = await fixture(
    (_, op) => {
      lws = lwsStorage(op);
      return lws.fetch;
    },
    { lws: true },
  );
  await f.login();
  expect((await lws.fetch(`${POD_ROOT}note.txt`)).status).toBe(401);
  for (let n = 0; n < 2; n++) {
    expect(
      await (
        await f.client.fetch(`${POD_ROOT}note.txt`, {
          method: "PUT",
          body: "same LWS bytes",
        })
      ).text(),
    ).toBe("private LWS content");
  }
  expect(lws.exchanges).toHaveLength(1);
  const writes = lws.requests.filter((request) => request.method === "PUT");
  expect(await Promise.all(writes.map((request) => request.text()))).toEqual(
    Array(4).fill("same LWS bytes"),
  );
  lws.rejected.add("Bearer fixture-lws-1");
  expect((await f.client.fetch(`${POD_ROOT}note.txt`)).status).toBe(200);
  expect(lws.exchanges).toHaveLength(2);
  f.op.controls.idSubject = "https://bob.example/profile#me";
  f.op.controls.webId = f.op.controls.idSubject;
  const next = await f.client.authorizationUrl();
  await f.client.handleCallback({ url: f.op.callback(next.url) }, next.state);
  expect((await f.client.fetch(`${POD_ROOT}note.txt`)).status).toBe(200);
  expect(lws.exchanges).toHaveLength(3);
});

test.each([
  "missing",
  "expired",
  "discovery",
  "subject",
  "client",
])("LWS rejects %s credentials/discovery before exchange", async (kind) => {
  let lws;
  const f = await fixture(
    (_, op) => {
      lws = lwsStorage(op);
      return lws.fetch;
    },
    { lws: true },
  );
  if (kind === "subject") f.op.controls.idSubject = "opaque-subject";
  if (kind === "client") f.op.controls.idAuthorizedParty = undefined;
  const session = await f.login();
  if (kind === "missing") {
    f.op.controls.refreshIdToken = false;
    await f.client.refresh(session.tokens.refreshToken);
  }
  if (kind === "expired") vi.spyOn(Date, "now").mockReturnValue(Date.now() + 601_000);
  if (kind === "discovery") lws.controls.wrongResource = true;
  await expect(f.client.fetch(`${POD_ROOT}note.txt`)).rejects.toThrow(
    {
      discovery: "resource does not match",
      subject: "URI subject",
      client: "client azp claim",
    }[kind] ?? "current verified ID token",
  );
  expect(lws.exchanges).toHaveLength(0);
});

test.each([
  false,
  true,
])("preserves authorization endpoint query parameters (stale OAuth parameters: %s)", async (staleOAuthParameters) => {
  const oauthParameters = [
    "client_id",
    "redirect_uri",
    "response_type",
    "scope",
    "state",
    "nonce",
    "code_challenge_method",
    "code_challenge",
    "prompt",
    "dpop_jkt",
  ];
  const f = await fixture((fetcher) => async (input, init) => {
    const response = await fetcher(input, init);
    if (!new Request(input, init).url.endsWith("/.well-known/openid-configuration"))
      return response;
    const metadata = await response.json();
    const endpoint = new URL(metadata.authorization_endpoint);
    endpoint.search = "policy=tenant-a&route=west%2Beast&route=north%20zone&empty=";
    if (staleOAuthParameters) {
      for (const name of oauthParameters) {
        endpoint.searchParams.append(name, "stale");
        endpoint.searchParams.append(name, "duplicate");
      }
    }
    metadata.authorization_endpoint = endpoint.href;
    return Response.json(metadata);
  });
  const url = new URL(f.begin.url);
  expect(url.origin + url.pathname).toBe(`${POD_ISSUER}authorize`);
  expect(url.searchParams.getAll("policy")).toEqual(["tenant-a"]);
  expect(url.searchParams.getAll("route")).toEqual(["west+east", "north zone"]);
  expect(url.searchParams.getAll("empty")).toEqual([""]);
  expect(url.searchParams.get("redirect_uri")).toBe(POD_CALLBACK);
  expect(url.searchParams.get("response_type")).toBe("code");
  expect(url.searchParams.get("state")).toBe(f.begin.state.state);
  expect(url.searchParams.get("nonce")).toBe(f.begin.state.nonce);
  for (const name of oauthParameters) {
    expect(url.searchParams.getAll(name)).toHaveLength(1);
  }
  expect((await f.login()).webId).toBe(f.op.controls.webId);
});

test.each([
  "once",
  "always",
  "invalid_token",
  "mixed",
  "no-body",
  "header-first",
])("bounds standard resource nonce challenges (%s) and releases rejected bodies", async (kind) => {
  const cancellations = [];
  let attempts = 0;
  const f = await fixture((fetcher) => async (input, init) => {
    const response = await fetcher(input, init);
    if (!new Request(input, init).url.startsWith(POD_ROOT)) return response;
    attempts++;
    if (["once", "no-body"].includes(kind) && attempts > 1) return response;
    const cancel = vi.fn();
    cancellations.push(cancel);
    return new Response(kind === "no-body" ? null : new ReadableStream({ cancel }), {
      status: 401,
      headers: {
        "dpop-nonce": "fixture-resource-nonce",
        ...((kind === "mixed" && attempts === 2) || (kind === "header-first" && attempts === 1)
          ? {}
          : {
              "www-authenticate": `DPoP error="${kind === "invalid_token" ? kind : "use_dpop_nonce"}"`,
            }),
      },
    });
  });
  await f.login();
  const result = f.client.fetch(`${POD_ROOT}notes`, { method: "PUT", body: "same bytes" });
  if (["once", "no-body"].includes(kind)) {
    expect(await (await result).json()).toEqual({ ok: true, nonce: "fixture-resource-nonce" });
  } else if (kind === "mixed") {
    const response = await result;
    expect(response.status).toBe(401);
    expect(cancellations[1]).not.toHaveBeenCalled();
    await response.body.cancel();
  } else {
    await expect(result).rejects.toMatchObject({ name: "WWWAuthenticateChallengeError" });
  }
  expect(attempts).toBe(kind === "invalid_token" ? 1 : 2);
  for (const cancel of cancellations) {
    if (kind === "no-body") expect(cancel).not.toHaveBeenCalled();
    else expect(cancel).toHaveBeenCalledOnce();
  }
  const requests = f.op.captured.filter((r) => r.url.startsWith(POD_ROOT));
  expect(requests.map((r) => r.body)).toEqual(Array(attempts).fill("same bytes"));
  if (attempts === 2) {
    const proofs = requests.map((r) => decodeJwt(r.headers.get("dpop")));
    expect(proofs[1].nonce).toBe("fixture-resource-nonce");
    expect(proofs[1].jti).not.toBe(proofs[0].jti);
  }
});

test("does not retry unrelated resource transport errors", async () => {
  const failure = new Error("fixture transport failure");
  let attempts = 0;
  const f = await fixture((fetcher) => async (input, init) => {
    if (new Request(input, init).url.startsWith(POD_ROOT)) {
      attempts++;
      throw failure;
    }
    return fetcher(input, init);
  });
  await f.login();
  await expect(f.client.fetch(`${POD_ROOT}notes`)).rejects.toBe(failure);
  expect(attempts).toBe(1);
});

test.each([
  [["RS256", "ES256"], "RS256", true],
  [["RS256", "ES256"], "ES256", true],
  [["ES256"], "RS256", false],
  [undefined, "RS256", true],
  [undefined, "ES256", false],
])("validates advertised ID-token algorithms (%j, %s)", async (advertised, alg, accepted) => {
  const keys = await generateKeyPair(alg);
  const publicJwk = { ...(await exportJWK(keys.publicKey)), kid: "test-signing-key", alg };
  const f = await fixture((fetcher) => async (input, init) => {
    const response = await fetcher(input, init);
    const url = new Request(input, init).url;
    if (url.endsWith("/.well-known/openid-configuration")) {
      const metadata = await response.json();
      metadata.id_token_signing_alg_values_supported = advertised;
      return Response.json(metadata);
    }
    if (url === `${POD_ISSUER}jwks`) return Response.json({ keys: [publicJwk] });
    if (url === `${POD_ISSUER}token`) {
      const tokens = await response.json();
      tokens.id_token = await new SignJWT(decodeJwt(tokens.id_token))
        .setProtectedHeader({ alg, kid: publicJwk.kid })
        .sign(keys.privateKey);
      return Response.json(tokens);
    }
    return response;
  });
  if (accepted) expect((await f.login()).webId).toBe(f.op.controls.webId);
  else await expect(f.login()).rejects.toThrow('unexpected JWT "alg"');
});

test("split server authorization imports non-extractable keys and restores the original proof binding", async () => {
  const f = await fixture();
  f.op.controls.tokenNonce = true;
  const session = await f.login();
  expect(session.tokens.refreshToken).toBeTruthy();
  expect(f.client.dpopKeyPair.keys.privateKey.extractable).toBe(false);
  const envelope = await exportServerDpopKey(f.client.dpopKeyPair);
  const restored = await createServerOidcClient({
    ...f.options,
    dpopKeyPair: await importServerDpopKey(envelope),
  });
  await restored.refresh(session.tokens.refreshToken);
  f.op.controls.resourceNonce = true;
  expect(
    (await restored.fetch(`${POD_ROOT}notes`, { method: "PUT", body: "same bytes" })).status,
  ).toBe(200);
  expect(f.op.captured.filter((r) => r.url.startsWith(POD_ROOT)).map((r) => r.body)).toEqual([
    "same bytes",
    "same bytes",
  ]);
  expect((await restored.fetch(`${POD_ROOT}notes`)).status).toBe(200);
  expect(restored.currentWebId()).toBe(session.webId);
  const copy = await exportServerDpopKey(f.client.dpopKeyPair);
  copy.d = "changed";
  expect((await exportServerDpopKey(f.client.dpopKeyPair)).d).toBe(envelope.d);
});

test("refresh preserves nonrotating credentials and allows omitted ID tokens and expiry", async () => {
  const f = await fixture();
  await expect(f.client.fetch(`${POD_ROOT}notes`)).rejects.toThrow("No pod credentials");
  f.op.controls.expiresIn = undefined;
  const session = await f.login();
  f.op.controls.refreshIdToken = false;
  f.op.controls.rotateRefresh = false;
  expect(await f.client.refresh(session.tokens.refreshToken)).toMatchObject({
    refreshToken: session.tokens.refreshToken,
  });
  expect(f.client.currentWebId()).toBeUndefined();
  const restored = await createServerOidcClient({
    ...f.options,
    dpopKeyPair: f.client.dpopKeyPair,
  });
  expect((await restored.refresh(session.tokens.refreshToken)).refreshToken).toBe(
    session.tokens.refreshToken,
  );
  expect((await restored.fetch(`${POD_ROOT}notes`)).status).toBe(200);
});

test.each([
  "origin",
  "fragment",
  "credentials",
  "redirect",
  "state",
])("rejects callback %s substitutions before exchange", async (kind) => {
  const f = await fixture();
  const url = new URL(f.op.callback(f.begin.url));
  const state = { ...f.begin.state };
  if (kind === "origin") url.hostname = "evil.example";
  if (kind === "fragment") url.hash = "fragment";
  if (kind === "credentials") url.username = "user";
  if (kind === "redirect") state.redirectUri = "https://evil.example/callback";
  if (kind === "state") state.state = "other-state";
  await expect(f.client.handleCallback({ url: url.href }, state)).rejects.toThrow();
  expect(f.op.captured.filter((r) => r.url.endsWith("/token"))).toHaveLength(0);
});

test.each([
  "",
  "http://insecure.example/me",
  "https://u:p@identity.example/me",
])("rejects an unsafe or absent verified WebID (%s)", async (webId) => {
  const f = await fixture();
  f.op.controls.webId = webId;
  await expect(f.login()).rejects.toThrow("WebID");
});

test.each([
  undefined,
  "http://insecure.example/authorize",
])("refuses unusable authorization endpoints", async (endpoint) => {
  const f = await fixture();
  const client = await createServerOidcClient({
    ...f.options,
    fetch: async (input, init) => {
      const response = await f.op.fetch(input, init);
      const metadata = await response.json();
      metadata.authorization_endpoint = endpoint;
      return Response.json(metadata);
    },
  });
  await expect(client.authorizationUrl()).rejects.toThrow();
});

test("refuses DPoP downgrade and cryptographically mismatched vault envelopes", async () => {
  const f = await fixture();
  f.op.controls.tokenType = "Bearer";
  await expect(f.login()).rejects.toThrow("DPoP");
  vi.spyOn(crypto.subtle, "verify").mockResolvedValueOnce(false);
  await expect(
    importServerDpopKey(await exportServerDpopKey(f.client.dpopKeyPair)),
  ).rejects.toThrow("Mismatched");
});

test("does not invent a missing refresh grant", async () => {
  const f = await fixture();
  f.op.controls.issueRefresh = false;
  expect((await f.login()).tokens.refreshToken).toBe("");
});

test("bounds resource replay and cancels oversized and aborted sources", async () => {
  const f = await fixture();
  await f.login();
  const cancel = vi.fn();
  const body = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(SERVER_MAX_REPLAY_BODY_BYTES + 1));
    },
    cancel,
  });
  await expect(
    f.client.fetch(`${POD_ROOT}notes`, { method: "PUT", body, duplex: "half" }),
  ).rejects.toThrow("replay buffer cap");
  expect(cancel).toHaveBeenCalledWith(expect.any(Error));
  for (const timing of ["before", "during"]) {
    const controller = new AbortController();
    const reason = new Error("abort fixture");
    const abortCancel = vi.fn();
    const source = new ReadableStream(
      {
        pull(c) {
          c.enqueue(new Uint8Array([1]));
          if (timing === "during") controller.abort(reason);
        },
        cancel: abortCancel,
      },
      { highWaterMark: 0 },
    );
    if (timing === "before") controller.abort(reason);
    await expect(
      f.client.fetch(`${POD_ROOT}notes`, {
        method: "PUT",
        body: source,
        signal: controller.signal,
        duplex: "half",
      }),
    ).rejects.toBe(reason);
    expect(abortCancel).toHaveBeenCalledWith(reason);
  }
  const aborted = new AbortController();
  aborted.abort();
  await expect(f.client.fetch(`${POD_ROOT}notes`, { signal: aborted.signal })).rejects.toThrow();
});

test("handles RSA issuer metadata and cancellation failures without disclosing a resource", async () => {
  const f = await fixture();
  await createServerOidcClient({
    ...f.options,
    fetch: async (input, init) => {
      const response = await f.op.fetch(input, init);
      const metadata = await response.json();
      delete metadata.id_token_signing_alg_values_supported;
      return Response.json(metadata);
    },
  });
  await f.login();
  const controller = new AbortController();
  const source = new ReadableStream(
    {
      pull(c) {
        c.enqueue(new Uint8Array([1]));
        controller.abort(new Error("fixture abort"));
      },
      cancel() {
        throw new Error("fixture cancellation failure");
      },
    },
    { highWaterMark: 0 },
  );
  await expect(
    f.client.fetch(`${POD_ROOT}notes`, {
      method: "PUT",
      body: source,
      signal: controller.signal,
      duplex: "half",
    }),
  ).rejects.toThrow("fixture abort");
});
