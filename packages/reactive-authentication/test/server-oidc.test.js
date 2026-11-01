// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, test, vi } from "vitest";
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
async function fixture() {
  const op = podIssuer();
  const options = {
    issuer: POD_ISSUER,
    clientId: POD_CLIENT,
    redirectUri: POD_CALLBACK,
    fetch: op.fetch,
  };
  const client = await createServerOidcClient(options);
  const begin = await client.authorizationUrl();
  const login = () => client.handleCallback({ url: op.callback(begin.url) }, begin.state);
  return { op, options, client, begin, login };
}

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
