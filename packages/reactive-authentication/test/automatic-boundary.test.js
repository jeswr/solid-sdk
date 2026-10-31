import assert from "node:assert/strict";
import { afterAll as after, beforeAll as before, test, vi } from "vitest";
import {
  AutomaticCredentialBoundary,
  CachingAuthorizationServerProvider,
  CachingClientProvider,
  DidKeySource,
  DPoPTokenProvider,
  DynamicRegistrationClientProvider,
  LwsTokenProvider,
  ReactiveFetchManager,
  SessionSupersededError,
  XASProvider,
} from "../src/mod.js";
import { shouldIntercept } from "../src/service-worker.js";
import { insecure, transport } from "./helpers/http.js";
import { startLws } from "./helpers/lws.js";
import { automaticCodeProvider, startOpenIdProvider, startSolidStorage } from "./helpers/openid.js";
import { callback } from "./helpers/solid.js";

const TYPE_LINK = `<http://www.w3.org/ns/pim/space#Storage>; rel="type"`;

let op, rs, gate;
/** Containers under /pods/ that identify themselves as storages (Solid Protocol §4.1), and nothing else. */
const typedRoots = new Set(["/pods/bob/", "/pods/nested/", "/pods/nested/inner/", "/pods/slow/"]);

before(async () => {
  op = await startOpenIdProvider();
  rs = await startSolidStorage(op, {
    handle: async (request) => {
      const path = new URL(request.url).pathname;
      if (request.method === "HEAD" && path === "/pods/slow/" && gate) await gate.promise;
      // Storage roots advertise their type even on an unauthenticated 401.
      if (typedRoots.has(path) && !request.headers.has("authorization")) {
        return new Response(null, {
          status: 401,
          headers: { "www-authenticate": 'DPoP algs="ES256"', link: TYPE_LINK },
        });
      }
      return undefined;
    },
  });
});
after(async () => {
  await rs.close();
  await op.close();
});

function automaticClient(boundaryOptions = {}) {
  const boundary = new AutomaticCredentialBoundary({
    http: insecure,
    allowInsecureHttp: true,
    ...boundaryOptions,
  });
  const code = automaticCodeProvider();
  const provider = new DPoPTokenProvider(
    callback,
    code,
    new CachingAuthorizationServerProvider(
      new XASProvider({ getIssuer: async () => new URL(op.issuer) }, insecure),
    ),
    new CachingClientProvider(new DynamicRegistrationClientProvider(insecure)),
    undefined,
    { http: insecure, context: boundary.contextKey },
  );
  const manager = new ReactiveFetchManager({ providers: [provider], boundary, fetch: transport });
  return { boundary, code, provider, manager };
}

const heads = (since) =>
  rs.server.requests
    .slice(since)
    .filter((r) => r.method === "HEAD")
    .map((r) => new URL(r.url).pathname);

test("Solid storage description in the first 401 establishes the root; no manual roots are configured", async () => {
  const { boundary, manager } = automaticClient();
  const before = rs.server.requests.length;
  const response = await manager.fetch(`${rs.url}/alice/notes`);
  assert.equal(response.status, 200);
  assert.deepEqual(boundary.roots, [`${rs.url}/alice/`]);
  assert.deepEqual(
    heads(before),
    ["/alice/"],
    "only the root confirms; the target is not re-requested",
  );

  // Cached: a sibling needs no discovery requests, another storage on the origin is separate.
  const again = rs.server.requests.length;
  assert.equal((await manager.fetch(`${rs.url}/alice/other`)).status, 200);
  assert.deepEqual(heads(again), []);
  assert.equal(boundary.allows(`${rs.url}/bob/x`), false);
});

test("Solid ancestor traversal finds the nearest self-identified root, nearest first, credentials omitted", async () => {
  const { boundary, manager } = automaticClient();
  const before = rs.server.requests.length;
  const response = await manager.fetch(`${rs.url}/pods/bob/a/b/c`, {
    headers: { cookie: "session=1", authorization: "Basic caller" },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(heads(before), ["/pods/bob/a/b/", "/pods/bob/a/", "/pods/bob/"]);
  for (const probe of rs.server.requests.slice(before).filter((r) => r.method === "HEAD")) {
    for (const header of ["authorization", "cookie", "dpop"])
      assert.equal(probe.headers.get(header), null, header);
  }
  assert.deepEqual(boundary.roots, [`${rs.url}/pods/bob/`]);

  const nested = rs.server.requests.length;
  assert.equal((await manager.fetch(`${rs.url}/pods/nested/inner/x`)).status, 200);
  assert.deepEqual(
    heads(nested),
    ["/pods/nested/inner/"],
    "nearest root wins; outer roots are not probed",
  );

  assert.equal(
    (await manager.fetch(`${rs.url}/pods/nested/inner/`)).status,
    200,
    "a root identifies itself directly",
  );
});

test("traversal is configurable: headers-only, per-challenge decision and probe budget", async () => {
  for (const [options, expectedHeads] of [
    [{ traversal: "headers-only" }, []],
    [{ shouldTraverse: ({ method }) => method !== "GET" }, []],
    [{ maxProbes: 2 }, ["/pods/bob/a/b/", "/pods/bob/a/"]],
  ]) {
    const { boundary, code, manager } = automaticClient(options);
    const before = rs.server.requests.length;
    const response = await manager.fetch(`${rs.url}/pods/bob/a/b/c`);
    assert.equal(response.status, 401, JSON.stringify(options));
    assert.deepEqual(heads(before), expectedHeads);
    assert.deepEqual(boundary.roots, []);
    assert.equal(code.calls, 0, "no login without a root");
  }
});

test("no root, no upgrade: traversal to the origin root fails closed; ineligible and ambiguous URLs are never candidates", async () => {
  const { boundary, code, manager } = automaticClient();
  const before = rs.server.requests.length;
  assert.equal((await manager.fetch(`${rs.url}/alice-evil/x`)).status, 401);
  assert.deepEqual(heads(before), ["/alice-evil/", "/"]);
  assert.equal(
    rs.server.requests.slice(before).filter((r) => r.headers.has("authorization")).length,
    0,
  );
  assert.equal(code.calls, 0);

  assert.equal(boundary.isCandidate(`${rs.url}/alice/%2e%2e%2fbob/x`), false);
  assert.equal(
    new AutomaticCredentialBoundary().isCandidate(`${rs.url}/alice/x`),
    false,
    "http needs the explicit dev opt-in",
  );
  const filtered = new AutomaticCredentialBoundary({
    allowInsecureHttp: true,
    eligible: (url) => url.hostname === "pods.example",
  });
  assert.equal(filtered.isCandidate(`${rs.url}/alice/x`), false);
  const declined = automaticClient({ approve: () => false });
  assert.equal((await declined.manager.fetch(`${rs.url}/alice/x`)).status, 401);
  assert.equal(declined.code.calls, 0);
});

test("writes: a Link-less 401 gets one target HEAD, then traversal; the body is replayed and written once", async () => {
  const { manager } = automaticClient();
  const before = rs.server.requests.length;
  const response = await manager.fetch(`${rs.url}/pods/bob/new`, {
    method: "PUT",
    body: "hello",
    headers: { "content-type": "text/plain" },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(heads(before), ["/pods/bob/new", "/pods/bob/"]);
  const writes = rs.writes.filter((w) => w.url.endsWith("/pods/bob/new"));
  assert.deepEqual(
    writes.map((w) => w.body),
    ["hello"],
  );
});

test("roots expire, can be cleared, and a cleared or aborted discovery adds nothing", async () => {
  const { boundary, manager } = automaticClient({ lifetimeMs: 60_000 });
  assert.equal((await manager.fetch(`${rs.url}/alice/e`)).status, 200);
  assert.equal(boundary.allows(`${rs.url}/alice/e`), true);
  // Advance a mocked clock past the lifetime instead of sleeping; real HTTP resumes with the real clock.
  vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
  try {
    vi.advanceTimersByTime(59_000);
    assert.equal(boundary.allows(`${rs.url}/alice/e`), true, "still within the lifetime");
    vi.advanceTimersByTime(2_000);
    assert.equal(boundary.allows(`${rs.url}/alice/e`), false, "expired");
  } finally {
    vi.useRealTimers();
  }
  assert.equal((await manager.fetch(`${rs.url}/alice/e`)).status, 200, "rediscovered");
  boundary.clear();
  assert.deepEqual(boundary.roots, []);

  gate = Promise.withResolvers();
  const slow = automaticClient();
  const pending = slow.manager.fetch(`${rs.url}/pods/slow/x`);
  while (!rs.server.requests.some((r) => r.method === "HEAD" && r.url.endsWith("/pods/slow/")))
    await new Promise((r) => setTimeout(r, 5));
  await slow.manager.logout();
  gate.resolve();
  await assert.rejects(pending, SessionSupersededError);
  assert.deepEqual(slow.boundary.roots, [], "no root added after logout");
  assert.equal(slow.code.calls, 0);
  gate = undefined;
});

test("the discovered root is the providers' storage context: one login per discovered storage", async () => {
  const { code, manager } = automaticClient();
  assert.equal((await manager.fetch(`${rs.url}/pods/bob/1`)).status, 200);
  assert.equal((await manager.fetch(`${rs.url}/pods/bob/deep/2`)).status, 200);
  assert.equal(code.calls, 1);
});

test("service workers intercept discovery candidates; static boundaries are unchanged", () => {
  const boundary = new AutomaticCredentialBoundary({
    eligible: (url) => url.hostname === "pods.example",
  });
  assert.equal(shouldIntercept(new Request("https://pods.example/a/b"), { boundary }), true);
  assert.equal(shouldIntercept(new Request("https://cdn.example/lib.js"), { boundary }), false);
});

test("LWS: the root is the description's StorageRoot (not the storage URI), from the first 401's Link", async () => {
  const lws = await startLws({ op });
  try {
    const boundary = new AutomaticCredentialBoundary({ http: insecure, allowInsecureHttp: true });
    const manager = new ReactiveFetchManager({
      providers: [new LwsTokenProvider(await DidKeySource.generate(), { http: insecure })],
      boundary,
      fetch: transport,
    });
    const response = await manager.fetch(`${lws.url}/root/doc`);
    assert.equal(response.status, 200);
    assert.deepEqual(boundary.roots, [`${lws.url}/root/`]);
    assert.equal(
      boundary.allows(`${lws.url}/storage_1`),
      false,
      "the storage description URI is not the root",
    );
    const targetGets = lws.server.requests.filter(
      (r) => new URL(r.url).pathname === "/root/doc" && !r.headers.has("authorization"),
    );
    assert.equal(targetGets.length, 1, "no redundant unauthenticated request for the target");
  } finally {
    await lws.close();
  }
});

test("review #1: eligibility stays enforced after a root is discovered", async () => {
  const eligible = (url) => url.pathname.startsWith("/pods/bob/allowed/");
  const { boundary, code, manager } = automaticClient({ eligible });
  assert.equal((await manager.fetch(`${rs.url}/pods/bob/allowed/x`)).status, 200);
  assert.deepEqual(boundary.roots, [`${rs.url}/pods/bob/`]);
  const calls = code.calls;
  const before = rs.server.requests.length;
  const excluded = await manager.fetch(`${rs.url}/pods/bob/excluded/y`);
  assert.equal(excluded.status, 401);
  assert.equal(code.calls, calls, "no provider call");
  assert.equal(
    rs.server.requests.slice(before).filter((r) => r.headers.has("authorization")).length,
    0,
    "no credentials",
  );
  assert.equal(boundary.allows(`${rs.url}/pods/bob/excluded/y`), false);
  assert.equal(shouldIntercept(new Request(`${rs.url}/pods/bob/excluded/y`), { boundary }), false);
  assert.equal(
    await boundary.contextKey(new Request(`${rs.url}/pods/bob/excluded/y`)),
    `${rs.url}/pods/bob/excluded/y`,
  );
});

test("review #2: invalid options are rejected up front", () => {
  for (const options of [
    { maxRoots: -1 },
    { maxRoots: 0 },
    { maxRoots: 1.5 },
    { maxRoots: Infinity },
    { lifetimeMs: 0 },
    { lifetimeMs: -1 },
    { lifetimeMs: NaN },
    { lifetimeMs: Infinity },
    { maxProbes: -1 },
    { maxProbes: NaN },
    { traversal: "binary" },
  ]) {
    assert.throws(
      () => new AutomaticCredentialBoundary(options),
      RangeError,
      JSON.stringify(options),
    );
  }
});

test("review #3: headers-only never probes, not even the target of a Link-less write", async () => {
  for (const method of ["PUT", "POST"]) {
    const { boundary, code, manager } = automaticClient({ traversal: "headers-only" });
    const before = rs.server.requests.length;
    const response = await manager.fetch(`${rs.url}/pods/bob/w`, {
      method,
      body: "keep",
      headers: { "content-type": "text/plain" },
    });
    assert.equal(response.status, 401, method);
    assert.equal(
      response.headers.get("www-authenticate"),
      'DPoP algs="ES256"',
      "the original 401 is returned readable",
    );
    assert.deepEqual(heads(before), []);
    assert.equal(code.calls, 0);
    assert.deepEqual(boundary.roots, []);
  }
});

test("review #4: a self-typed root is recognized with or without a query, canonically, without parent probes", async () => {
  for (const path of ["/pods/bob/", "/pods/bob/?view=1"]) {
    const { boundary, manager } = automaticClient();
    const before = rs.server.requests.length;
    assert.equal((await manager.fetch(`${rs.url}${path}`)).status, 200, path);
    assert.deepEqual(boundary.roots, [`${rs.url}/pods/bob/`], path);
    assert.deepEqual(heads(before), [], "no parent probes");
  }
});

test("review #5: clear() during a pending approval and caller abort add nothing and never reach providers", async () => {
  const approving = Promise.withResolvers();
  const release = Promise.withResolvers();
  const pending = automaticClient({
    approve: async () => {
      approving.resolve();
      await release.promise;
      return true;
    },
  });
  const fetching = pending.manager.fetch(`${rs.url}/alice/cleared`);
  await approving.promise;
  pending.boundary.clear();
  release.resolve();
  assert.equal((await fetching).status, 401);
  assert.deepEqual(pending.boundary.roots, []);
  assert.equal(pending.code.calls, 0);

  gate = Promise.withResolvers();
  const aborted = automaticClient();
  const controller = new AbortController();
  const slowHeads = () =>
    rs.server.requests.filter((r) => r.method === "HEAD" && r.url.endsWith("/pods/slow/")).length;
  const earlier = slowHeads();
  const request = aborted.manager.fetch(`${rs.url}/pods/slow/x`, { signal: controller.signal });
  while (slowHeads() === earlier) await new Promise((r) => setTimeout(r, 5)); // discovery is waiting on the probe
  controller.abort(new Error("caller cancelled"));
  gate.resolve();
  await assert.rejects(request, /caller cancelled|abort/i);
  assert.deepEqual(aborted.boundary.roots, []);
  assert.equal(aborted.code.calls, 0);
  gate = undefined;
});

test("review #5: hostile advertised evidence cannot authorize through the automatic boundary (headers-only)", async () => {
  const { serve } = await import("./helpers/http.js");
  const foreign = await serve(
    () =>
      new Response(`<https://unused/> a <http://www.w3.org/ns/pim/space#Storage> .`, {
        headers: { "content-type": "text/turtle" },
      }),
  );
  const hostile = await serve((request, { url: base }) => {
    const path = new URL(request.url).pathname;
    const description = (link) =>
      new Response(null, { status: 401, headers: { "www-authenticate": "DPoP", link } });
    switch (path) {
      case "/anchored/x":
        return description(
          `<${base}/anchored/>; rel="type"; anchor="/elsewhere/", <http://www.w3.org/ns/pim/space#Storage>; rel="type"; anchor="/elsewhere/"`,
        );
      case "/redirecting/x":
        return description(
          `<${base}/redirecting/desc>; rel="http://www.w3.org/ns/solid/terms#storageDescription"`,
        );
      case "/redirecting/desc":
        return new Response(`<${base}/redirecting/> a <http://www.w3.org/ns/pim/space#Storage> .`, {
          headers: { "content-type": "text/turtle" },
        });
      case "/redirecting/":
        return new Response(null, {
          status: 302,
          headers: {
            location: "/",
            link: `<http://www.w3.org/ns/pim/space#Storage>; rel="type", <${base}/redirecting/desc>; rel="http://www.w3.org/ns/solid/terms#storageDescription"`,
          },
        });
      case "/foreign/x":
        return description(
          `<${foreign.url}/desc>; rel="http://www.w3.org/ns/solid/terms#storageDescription"`,
        );
      case "/unrelated/x":
        return description(
          `<${base}/unrelated/desc>; rel="http://www.w3.org/ns/solid/terms#storageDescription"`,
        );
      case "/unrelated/desc":
        return new Response(`<${base}/elsewhere/> a <http://www.w3.org/ns/pim/space#Storage> .`, {
          headers: { "content-type": "text/turtle" },
        });
    }
    return request.headers.has("authorization")
      ? new Response("leaked")
      : new Response(null, { status: 401 });
  });
  try {
    const { boundary, code, manager } = automaticClient({ traversal: "headers-only" });
    for (const path of ["/anchored/x", "/redirecting/x", "/foreign/x", "/unrelated/x"]) {
      assert.equal((await manager.fetch(`${hostile.url}${path}`)).status, 401, path);
    }
    assert.deepEqual(boundary.roots, []);
    assert.equal(code.calls, 0);
    assert.equal(hostile.requests.filter((r) => r.headers.has("authorization")).length, 0);
    assert.equal(foreign.requests.length, 0, "foreign description never fetched");
  } finally {
    await hostile.close();
    await foreign.close();
  }
});
