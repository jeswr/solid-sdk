// AUTHORED-BY Claude Opus 5.5
import assert from "node:assert/strict";
import { createMemoryStore } from "@key-value-kit/storage/memory";
import { afterAll, beforeAll, test } from "vitest";
import { challengeContext } from "../src/challenge.js";
import {
  CachingClientProvider,
  CredentialBoundary,
  DynamicRegistrationClientProvider,
  InteractionRequiredError,
  LwsTokenProvider,
  OidcIdTokenSource,
  ReactiveAuthenticationClient,
  ReactiveAuthenticationError,
  ReactiveFetchManager,
  ReplayBodyTooLargeError,
  SessionFence,
  SolidUmaTokenProvider,
  XASProvider,
} from "../src/mod.js";
import { insecure, transport } from "./helpers/http.js";
import { startLws } from "./helpers/lws.js";
import { automaticCodeProvider, startOpenIdProvider, startSolidStorage } from "./helpers/openid.js";
import { callback, solidClient } from "./helpers/solid.js";
import { startUma } from "./helpers/uma.js";

const nonInteractive = { interactive: false };
const boundaryFor = (...roots) => new CredentialBoundary(roots, { allowInsecureHttp: true });
const challenged = () =>
  new Response("challenge body", { status: 401, headers: { "www-authenticate": "Bearer" } });

/** A provider that records the arguments of every upgrade and then runs `behaviour`. */
function recordingProvider(behaviour) {
  return {
    calls: [],
    async matches() {
      return true;
    },
    async upgrade(...args) {
      this.calls.push(args);
      return await behaviour(args[0], this.calls.length);
    },
    async invalidate() {},
  };
}

const withToken = (request, token = "t0k3n") => {
  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return new Request(request, { headers });
};

test("non-interactive fetches pass { interactive: false } to providers; interactive ones keep the two-argument call", async () => {
  const provider = recordingProvider((request) => withToken(request));
  let sends = 0;
  const client = new ReactiveAuthenticationClient({
    providers: [provider],
    boundary: boundaryFor("https://pod.example/"),
    fetch: async (request) =>
      request.headers.has("authorization") ? new Response(`ok ${++sends}`) : challenged(),
  });

  assert.equal((await client.fetch("https://pod.example/a")).status, 200);
  assert.equal((await client.fetch("https://pod.example/a", {}, {})).status, 200);
  assert.equal(
    (await client.fetch("https://pod.example/a", {}, { interactive: true })).status,
    200,
  );
  for (const call of provider.calls)
    assert.equal(call.length, 2, "interactive upgrades get two arguments");

  assert.equal((await client.fetch("https://pod.example/a", {}, nonInteractive)).status, 200);
  const last = provider.calls.at(-1);
  assert.equal(last.length, 3);
  assert.deepEqual(last[2], { interactive: false });
});

test("a non-interactive fetch answers with the challenged 401 when the provider needs the user", async () => {
  let challenge;
  const provider = recordingProvider(async () => {
    throw new InteractionRequiredError("test", async () => {});
  });
  const client = new ReactiveAuthenticationClient({
    providers: [provider],
    boundary: boundaryFor("https://pod.example/"),
    fetch: async () => {
      challenge = challenged();
      return challenge;
    },
  });

  const response = await client.fetch("https://pod.example/a", {}, nonInteractive);
  assert.equal(response, challenge, "the original challenge response, not a copy");
  assert.equal(response.status, 401);
  assert.equal(await response.text(), "challenge body", "its body was not discarded");

  // An interactive fetch never swallows the error: it reaches the caller as before.
  await assert.rejects(client.fetch("https://pod.example/a"), InteractionRequiredError);
});

test("non-interactive fetches still reject with every other provider error", async () => {
  const failure = new ReactiveAuthenticationError("broken provider");
  const client = new ReactiveAuthenticationClient({
    providers: [
      recordingProvider(async () => {
        throw failure;
      }),
    ],
    boundary: boundaryFor("https://pod.example/"),
    fetch: async () => challenged(),
  });
  await assert.rejects(
    client.fetch("https://pod.example/a", {}, nonInteractive),
    (e) => e === failure,
  );
});

test("a renewal that would need the user returns the latest 401, never an interactive retry", async () => {
  const responses = [];
  const provider = recordingProvider(async (request, call) => {
    if (call === 1) return withToken(request, "expired");
    throw new InteractionRequiredError("test", async () => {});
  });
  const client = new ReactiveAuthenticationClient({
    providers: [provider],
    boundary: boundaryFor("https://pod.example/"),
    fetch: async (request) => {
      const response = new Response(request.headers.get("authorization") ?? "anonymous", {
        status: 401,
        headers: { "www-authenticate": 'Bearer error="invalid_token"' },
      });
      responses.push(response);
      return response;
    },
  });
  const response = await client.fetch("https://pod.example/a", {}, nonInteractive);
  assert.equal(provider.calls.length, 2, "one upgrade, then one renewal attempt");
  assert.deepEqual(
    provider.calls[1][2],
    { interactive: false },
    "the renewal is non-interactive too",
  );
  assert.equal(response, responses.at(-1));
  assert.equal(await response.text(), "Bearer expired");
});

test("non-interactive fetches outside the boundary pass through like interactive ones", async () => {
  const provider = recordingProvider((request) => withToken(request));
  const client = new ReactiveAuthenticationClient({
    providers: [provider],
    boundary: boundaryFor("https://pod.example/"),
    fetch: async () => challenged(),
  });
  const response = await client.fetch("https://elsewhere.example/a", {}, nonInteractive);
  assert.equal(response.status, 401);
  assert.equal(provider.calls.length, 0);
});

test("an oversized replay body rejects with a typed ReplayBodyTooLargeError and is read no further than the limit", async () => {
  const sent = [];
  const client = new ReactiveAuthenticationClient({
    providers: [recordingProvider((request) => withToken(request))],
    boundary: boundaryFor("https://pod.example/"),
    fetch: async (request) => {
      sent.push(request);
      return request.headers.has("authorization")
        ? new Response(await request.text())
        : challenged();
    },
    maxReplayBodyBytes: 8,
  });

  // A stream of unknown length that never ends: buffering stops just past the limit.
  let pulled = 0;
  let cancelled = false;
  const endless = new ReadableStream({
    pull(controller) {
      pulled += 4;
      controller.enqueue(new Uint8Array(4));
    },
    cancel() {
      cancelled = true;
    },
  });
  const error = await client
    .fetch("https://pod.example/a", { method: "PUT", body: endless, duplex: "half" })
    .then(
      () => assert.fail("expected a rejection"),
      (e) => e,
    );
  assert.ok(error instanceof ReplayBodyTooLargeError);
  assert.ok(
    error instanceof ReactiveAuthenticationError,
    "callers catching the base class still do",
  );
  assert.equal(error.name, "ReplayBodyTooLargeError");
  assert.equal(error.maxBytes, 8);
  assert.match(error.message, /exceeds 8 bytes/);
  assert.ok(cancelled, "the stream was cancelled");
  // 12 bytes is the first read past the limit; a little read-ahead by the stream queue is allowed.
  assert.ok(pulled <= 16, `read ${pulled} bytes of an endless stream`);
  assert.equal(sent.length, 0, "nothing is sent");

  // A body of known length over the limit fails the same way, before anything is sent.
  await assert.rejects(
    client.fetch("https://pod.example/a", { method: "PUT", body: "nine bytes" }),
    (e) => e instanceof ReplayBodyTooLargeError && e.maxBytes === 8,
  );
  // Exactly the limit is still buffered and replayed.
  const replayed = await client.fetch("https://pod.example/a", { method: "PUT", body: "8 bytes!" });
  assert.equal(await replayed.text(), "8 bytes!");
  assert.equal(sent.length, 2, "the in-limit request was sent and replayed once");
});

test("an oversized body without request streams (Firefox) is the same typed error", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(Request.prototype, "body");
  Object.defineProperty(Request.prototype, "body", { configurable: true, get: () => undefined });
  try {
    const client = new ReactiveAuthenticationClient({
      providers: [],
      boundary: boundaryFor("https://pod.example/"),
      fetch: async () => new Response("ok"),
      maxReplayBodyBytes: 2,
    });
    await assert.rejects(
      client.fetch("https://pod.example/a", { method: "POST", body: "abc" }),
      (e) => e instanceof ReplayBodyTooLargeError && e.maxBytes === 2,
    );
  } finally {
    Object.defineProperty(Request.prototype, "body", descriptor);
  }
});

let op, rs;
beforeAll(async () => {
  op = await startOpenIdProvider({ requireInteraction: true });
  rs = await startSolidStorage(op);
});
afterAll(async () => {
  await rs.close();
  await op.close();
});

function persistentSolid() {
  const namespace = crypto.randomUUID();
  const fence = new SessionFence(namespace, { store: createMemoryStore(), broadcast: false });
  const provider = {
    namespace,
    sessionStore: createMemoryStore(),
    fence,
    preserveRefreshOnFailure: true,
    // Even the restore-only prompt=none fallback must not run for a non-interactive upgrade.
    silentAfterRefreshFailure: true,
    silentFirst: false,
  };
  return { fence, load: () => solidClient(op, rs, { provider, fence }) };
}

test("Solid-OIDC: without a session a non-interactive fetch returns the 401 and never asks for a code", async () => {
  const { fence, load } = persistentSolid();
  const page = load();
  const authorizations = op.stats.authorize.length;
  try {
    const response = await page.manager.client.fetch(
      `${rs.url}/alice/none`,
      undefined,
      nonInteractive,
    );
    assert.equal(response.status, 401);
    assert.equal(page.code.calls, 0);
    assert.equal(op.stats.authorize.length, authorizations, "no authorization request at all");

    const error = await page.provider
      .upgrade(new Request(`${rs.url}/alice/none`), undefined, nonInteractive)
      .then(
        () => assert.fail("expected a rejection"),
        (e) => e,
      );
    assert.ok(error instanceof InteractionRequiredError);
    assert.equal(error.source, "solid-oidc");
    // It cannot start a sign-in itself; the application signs in through its own login.
    await assert.rejects(
      error.authorize(),
      (e) => e instanceof ReactiveAuthenticationError && /Sign in/.test(e.message),
    );
    assert.equal(page.code.calls, 0);
  } finally {
    fence.close();
  }
});

test("Solid-OIDC: a non-interactive fetch uses cached tokens and refresh grants, but never re-authorizes", async () => {
  const { fence, load } = persistentSolid();
  const url = `${rs.url}/alice/background`;
  try {
    const page = load();
    assert.equal((await page.manager.fetch(url)).status, 200);
    assert.equal(page.code.calls, 1);

    // Cached access token.
    assert.equal((await page.manager.client.fetch(url, undefined, nonInteractive)).status, 200);

    // A reload has no access token in memory: silent refresh from the stored grant is allowed.
    const reloaded = load();
    const refreshes = op.stats.refresh;
    const authorizations = op.stats.authorize.length;
    assert.equal((await reloaded.manager.client.fetch(url, undefined, nonInteractive)).status, 200);
    assert.equal(op.stats.refresh, refreshes + 1);
    assert.equal(reloaded.code.calls, 0);

    // A refused refresh would need a new authorization: the background fetch gets the 401 instead.
    op.failRefresh("invalid_grant");
    const expired = load();
    const response = await expired.manager.client.fetch(url, undefined, nonInteractive);
    assert.equal(response.status, 401);
    assert.equal(expired.code.calls, 0);
    assert.equal(op.stats.authorize.length, authorizations, "not even a prompt=none request");
  } finally {
    op.failRefresh(undefined);
    fence.close();
  }
});

test("UMA: no RPT and no ID token means a 401 without a code request; a live session still serves new tickets", async () => {
  const umaOp = await startOpenIdProvider({ webId: "https://id.example/alice#me" });
  const uma = await startUma(umaOp);
  const code = automaticCodeProvider();
  const provider = new SolidUmaTokenProvider(
    callback,
    code,
    new XASProvider({ getIssuer: async () => new URL(umaOp.issuer) }, insecure),
    new CachingClientProvider(new DynamicRegistrationClientProvider(insecure)),
    { http: insecure },
  );
  const manager = new ReactiveFetchManager({
    providers: [provider],
    boundary: boundaryFor(`${uma.url}/uma/`),
    fetch: transport,
  });
  try {
    const before = await manager.client.fetch(`${uma.url}/uma/a`, undefined, nonInteractive);
    assert.equal(before.status, 401);
    assert.equal(code.calls, 0);
    await assert.rejects(
      provider.upgrade(
        new Request(`${uma.url}/uma/a`),
        challengeContext(await transport(new Request(`${uma.url}/uma/a`))),
        nonInteractive,
      ),
      (e) => e instanceof InteractionRequiredError && e.source === "solid-uma",
    );

    assert.equal((await manager.fetch(`${uma.url}/uma/a`)).status, 200);
    assert.equal(code.calls, 1);
    const exchanges = uma.stats.exchanges.length;
    // Another resource needs a new ticket exchange; the cached ID token suffices, so no interaction.
    const other = await manager.client.fetch(`${uma.url}/uma/b`, undefined, nonInteractive);
    assert.equal(other.status, 200);
    assert.equal(uma.stats.exchanges.length, exchanges + 1);
    assert.equal(code.calls, 1);
  } finally {
    await uma.close();
    await umaOp.close();
  }
});

test("LWS: the OIDC credential source refuses interaction; other sources see the field only when false", async () => {
  const lwsOp = await startOpenIdProvider({
    subject: "https://id.example/alice#me",
    webId: "https://id.example/alice#me",
  });
  const lws = await startLws({ op: lwsOp });
  const fence = new SessionFence(`lws-${crypto.randomUUID()}`, { broadcast: false });
  try {
    const openIdProvider = await new XASProvider(
      { getIssuer: async () => new URL(lwsOp.issuer) },
      insecure,
    ).getAuthorizationServer(new Request("https://unused.example/"));
    const code = automaticCodeProvider();
    const source = new OidcIdTokenSource(
      openIdProvider,
      callback,
      code,
      new DynamicRegistrationClientProvider(insecure),
      { http: insecure, fence },
    );
    const requests = [];
    const recording = {
      id: "recording",
      fence,
      async getCredential(request) {
        requests.push(request);
        return await source.getCredential(request);
      },
    };
    const manager = new ReactiveFetchManager({
      providers: [new LwsTokenProvider(recording, { http: insecure, fence })],
      boundary: boundaryFor(`${lws.url}/root/`),
      fence,
      fetch: transport,
    });

    const refused = await manager.client.fetch(`${lws.url}/root/doc`, undefined, nonInteractive);
    assert.equal(refused.status, 401);
    assert.equal(code.calls, 0);
    assert.equal(requests.at(-1).interactive, false);
    await assert.rejects(
      source.getCredential({ ...requests.at(-1) }),
      (e) => e instanceof InteractionRequiredError && e.source === "lws-oidc",
    );

    assert.equal((await manager.fetch(`${lws.url}/root/doc`)).status, 200);
    assert.equal(code.calls, 1);
    assert.equal(
      "interactive" in requests.at(-1),
      false,
      "interactive requests keep their old shape",
    );
  } finally {
    fence.close();
    await lws.close();
    await lwsOp.close();
  }
});
