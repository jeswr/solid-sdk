// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { AclResource } from "@solid/object";
import { DataFactory } from "n3";
import { describe, expect, it, vi } from "vitest";
import { createConnectionStore } from "./connections-store.js";
import { ConnectorScheduler, type ConnectorSchedulerOptions } from "./scheduler.js";
import { connectorState } from "./state.js";
import { createConnectorStateStore } from "./state-store.js";
import { createMemoryPod, TEST_POD_ROOT, TEST_WEBID } from "./testing.js";
import { ConnectionRemovedError, type ConnectorState } from "./types.js";

const AT = "2026-11-01T12:00:00.000Z";
const base: ConnectorState = {
  connectedAt: AT,
  lastOutcome: "success",
  counts: { documents: 0, items: 0, skipped: 0 },
};
function fixture() {
  const pod = createMemoryPod(),
    requests: { url: string; method: string; headers: Headers }[] = [];
  const io: typeof fetch = async (input, init) => {
    const url = String(input),
      method = init?.method ?? "GET";
    requests.push({ url, method, headers: new Headers(init?.headers) });
    if (method === "HEAD")
      return new Response(null, {
        status: pod.get(url) ? 200 : 404,
        headers: { link: `<${url}.acl>; rel="acl"` },
      });
    return pod.fetch(input, {
      ...init,
      body: init?.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : init?.body,
    });
  };
  const options = { podRoot: TEST_POD_ROOT, webId: TEST_WEBID, fetch: io };
  return { pod, requests, io, options };
}
it("writes health with If-Match and merges another account and newer checkpoint after a 412", async () => {
  const h = fixture(),
    url = `${TEST_POD_ROOT}integrations/spotify/state.json`;
  await h.pod.fetch(url, {
    method: "PUT",
    body: JSON.stringify(base),
    headers: { "content-type": "application/json" },
  });
  let conflict = true;
  const io: typeof fetch = async (input, init) => {
    // The conflict lands on the health write (the run's claim write precedes it).
    if (
      String(input) === url &&
      init?.method === "PUT" &&
      String(init.body).includes('"health"') &&
      conflict
    ) {
      conflict = false;
      await h.pod.fetch(url, {
        method: "PUT",
        body: JSON.stringify({
          ...base,
          accounts: {
            other: { ...base, cursor: "unrelated" },
            fixture: { ...base, lastSync: "2026-11-01T12:01:00.000Z", cursor: "newer-host" },
          },
        }),
        headers: { "content-type": "application/json" },
      });
    }
    return h.io(input, init);
  };
  const scheduler = new ConnectorScheduler({
    connections: [{ connectorId: "spotify", account: "fixture", enabled: true }],
    now: () => Date.parse(AT),
    tokenSource: { accessToken: async () => "synthetic" },
    sourceFetch: vi.fn(),
    saveConnection: vi.fn(),
    podWriter: vi.fn(),
    stateStore: (adapterId, signal) =>
      createConnectorStateStore({ ...h.options, fetch: io, adapterId, signal }),
    runner: async () => ({
      adapterId: "spotify",
      mode: "live",
      written: [],
      categories: [],
      indexUrl: "https://pod.example/index",
      state: { ...base, lastSync: AT, cursor: "my-run" },
    }),
  });
  await scheduler.tick();
  const state = connectorState(JSON.parse(h.pod.get(url) ?? "null"));
  expect(state.accounts?.other?.cursor).toBe("unrelated");
  expect(state.accounts?.fixture?.cursor).toBe("newer-host");
  expect(state.accounts?.fixture?.health?.outcome).toBe("ok");
  const puts = h.requests.filter((r) => r.url === url && r.method === "PUT");
  expect(puts.map((p) => p.headers.get("if-match"))).toEqual(['"v1"', '"v2"', '"v3"']);
  expect(state.claims?.fixture).toBeUndefined();
  const acl = new AclResource(h.pod.dataset(`${url}.acl`), DataFactory);
  expect([...acl.authorizations]).toHaveLength(1);
  expect([...([...acl.authorizations][0]?.agent ?? [])]).toEqual([TEST_WEBID]);
  expect([...([...acl.authorizations][0]?.agentClass ?? [])]).toEqual([]);
});
it("protects connection settings before reading, caps records and merges enablement on conflicts", async () => {
  const h = fixture(),
    store = createConnectionStore(h.options);
  expect(await store.read()).toBeUndefined();
  await store.write([
    { connectorId: "spotify", account: "fixture", enabled: true, intervalMinutes: 60 },
  ]);
  // ACL, read, ACL again before creating content, then the content.
  expect(h.requests.map((r) => [r.method, r.url.endsWith(".acl")])).toEqual([
    ["HEAD", false],
    ["PUT", true],
    ["GET", false],
    ["PUT", true],
    ["PUT", false],
  ]);
  let conflict = true;
  const io: typeof fetch = async (input, init) => {
    if (String(input) === store.url && init?.method === "PUT" && conflict) {
      conflict = false;
      await h.pod.fetch(store.url, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([
          { connectorId: "spotify", account: "fixture", enabled: true, intervalMinutes: 120 },
          { connectorId: "github", account: "second", enabled: true },
        ]),
      });
    }
    return h.io(input, init);
  };
  await createConnectionStore({ ...h.options, fetch: io }).update({
    connectorId: "spotify",
    account: "fixture",
    enabled: false,
    status: "needs-reauth",
  });
  expect(await store.read()).toEqual([
    {
      connectorId: "spotify",
      account: "fixture",
      enabled: false,
      intervalMinutes: 120,
      status: "needs-reauth",
    },
    { connectorId: "github", account: "second", enabled: true },
  ]);
  await expect(
    store.update({ connectorId: "github", account: "missing", enabled: true }),
  ).rejects.toBeInstanceOf(ConnectionRemovedError);
});
it.each([
  undefined,
  'W/"weak"',
  "*",
  "unquoted",
])("refuses missing or weak state validators (%s)", async (etag) => {
  const h = fixture();
  const store = createConnectorStateStore({
    ...h.options,
    adapterId: "spotify",
    fetch: async (input, init) =>
      (init?.method ?? "GET") === "GET"
        ? Response.json(base, { headers: etag ? { etag } : {} })
        : h.io(input, init),
  });
  await expect(store.read()).rejects.toThrow("safely");
});
it("fails closed on missing/out-of-scope ACLs and oversized connection documents", async () => {
  const h = fixture();
  for (const link of [
    "",
    '<https://evil.example/x>; rel="acl"',
    '<../elsewhere.acl>; rel="acl", <other>; rel="acl"',
  ]) {
    const io: typeof fetch = vi.fn(
      async () => new Response(null, { status: 404, headers: { link } }),
    );
    await expect(createConnectionStore({ ...h.options, fetch: io }).read()).rejects.toThrow();
    expect(io).toHaveBeenCalledTimes(1);
  }
  const cancel = vi.fn();
  const io: typeof fetch = async (input, init) =>
    (init?.method ?? "GET") === "GET"
      ? new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array(262_145));
            },
            cancel,
          }),
          { headers: { etag: '"v1"' } },
        )
      : h.io(input, init);
  await expect(createConnectionStore({ ...h.options, fetch: io }).read()).rejects.toThrow();
  expect(cancel).toHaveBeenCalledOnce();
});
it("does not start a PUT after cancellation while reading state", async () => {
  const h = fixture(),
    controller = new AbortController();
  const store = createConnectorStateStore({
    ...h.options,
    adapterId: "spotify",
    signal: controller.signal,
  });
  await store.read();
  controller.abort();
  await expect(store.write(base)).rejects.toThrow();
  expect(h.requests.filter((r) => r.method === "PUT" && r.url.endsWith("state.json"))).toEqual([]);
});

it("refuses a malformed pod root before deriving a wider private-resource scope", () => {
  const h = fixture();
  for (const podRoot of ["https://pod.test/alice", "https://user:secret@pod.test/alice/"]) {
    expect(() =>
      createConnectorStateStore({ ...h.options, podRoot, adapterId: "spotify" }),
    ).toThrow();
    expect(() => createConnectionStore({ ...h.options, podRoot })).toThrow();
  }
  expect(h.requests).toEqual([]);
});

it("requires an explicit Pod transport instead of falling back to ambient fetch", () => {
  const h = fixture();
  expect(() => createConnectionStore({ ...h.options, fetch: undefined as never })).toThrow(
    "transport is required",
  );
  expect(() =>
    createConnectorStateStore({ ...h.options, adapterId: "spotify", fetch: undefined as never }),
  ).toThrow("transport is required");
  expect(h.requests).toEqual([]);
});

it("protects the ACL once per store instance and polls with a conditional GET", async () => {
  const h = fixture();
  const seed = createConnectionStore(h.options);
  await seed.read();
  await seed.write([{ connectorId: "spotify", account: "fixture", enabled: true }]);
  h.requests.length = 0;
  let notModified = 0;
  const io: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    const tag = headers.get("if-none-match");
    if ((init?.method ?? "GET") === "GET" && tag && tag !== "*") {
      const current = await h.io(input, { method: "GET" });
      if (current.headers.get("etag") === tag) {
        notModified++;
        h.requests.push({ url: String(input), method: "GET", headers });
        return new Response(null, { status: 304, headers: { etag: tag } });
      }
    }
    return h.io(input, init);
  };
  const store = createConnectionStore({ ...h.options, fetch: io });
  const first = await store.read();
  const revision = store.revision;
  expect(await store.read()).toBe(first);
  expect(await store.read()).toBe(first);
  expect(store.revision).toBe(revision);
  expect(notModified).toBe(2);
  const aclWrites = () =>
    h.requests.filter((r) => r.method === "PUT" && r.url.endsWith(".acl")).length;
  expect(aclWrites()).toBe(1);
  expect(h.requests.filter((r) => r.method === "HEAD")).toHaveLength(1);
  // A change by another writer is re-parsed once and bumps the revision.
  await seed.read();
  await seed.write([{ connectorId: "spotify", account: "fixture", enabled: false }]);
  const before = aclWrites();
  expect(await store.read()).toEqual([
    { connectorId: "spotify", account: "fixture", enabled: false },
  ]);
  expect(store.revision).toBe(revision + 1);
  expect(aclWrites()).toBe(before);
});
it("re-parses only when a server ignoring If-None-Match returns a new validator", async () => {
  const h = fixture();
  const store = createConnectionStore(h.options);
  await store.read();
  await store.write([{ connectorId: "spotify", account: "fixture", enabled: true }]);
  const value = await store.read();
  const revision = store.revision;
  expect(await store.read()).toBe(value);
  expect(store.revision).toBe(revision);
});
it("peeks without ACL or data writes", async () => {
  const h = fixture();
  const seed = createConnectionStore(h.options);
  await seed.read();
  await seed.write([{ connectorId: "spotify", account: "fixture", enabled: true }]);
  h.requests.length = 0;
  const reader = createConnectionStore(h.options);
  expect(await reader.peek()).toEqual([
    { connectorId: "spotify", account: "fixture", enabled: true },
  ]);
  expect(await createConnectorStateStore({ ...h.options, adapterId: "github" }).peek()).toBe(
    undefined,
  );
  expect(h.requests.map((r) => r.method)).toEqual(["GET", "GET"]);
});
it("preserves rows it cannot interpret and stamps enabledAt on update", async () => {
  const h = fixture(),
    store = createConnectionStore(h.options);
  await store.read();
  const rows = [
    {
      connectorId: "spotify",
      account: "fixture",
      enabled: false,
      status: "needs-reauth",
      label: "x",
    },
    { connectorId: "Bad Id", account: "a", enabled: true },
    42,
  ];
  await store.write(rows);
  expect(
    await store.update({
      connectorId: "spotify",
      account: "fixture",
      enabled: true,
      enabledAt: "2026-11-01T12:00:00.000Z",
    }),
  ).toBe("applied");
  expect(await store.read()).toEqual([
    {
      connectorId: "spotify",
      account: "fixture",
      enabled: true,
      label: "x",
      enabledAt: "2026-11-01T12:00:00.000Z",
    },
    rows[1],
    42,
  ]);
});

it("skips a needs-reauth disable when the owner re-enabled during the run, including on 412", async () => {
  const h = fixture(),
    store = createConnectionStore(h.options);
  await store.read();
  const latched = "2026-11-01T11:00:00.000Z",
    owner = "2026-11-01T12:05:00.000Z";
  await store.write([
    { connectorId: "spotify", account: "fixture", enabled: true, enabledAt: latched },
  ]);
  const disable = {
    connectorId: "spotify",
    account: "fixture",
    enabled: false,
    status: "needs-reauth" as const,
    enabledAt: latched,
  };
  // Re-enabled before the save: no write, owner's values kept.
  await store.read();
  await store.write([
    { connectorId: "spotify", account: "fixture", enabled: true, enabledAt: owner },
  ]);
  h.requests.length = 0;
  expect(await store.update(disable)).toBe("superseded");
  expect(h.requests.filter((r) => r.method === "PUT")).toEqual([]);
  expect(await store.read()).toEqual([
    { connectorId: "spotify", account: "fixture", enabled: true, enabledAt: owner },
  ]);
  // Re-enabled concurrently with the save: the 412 merge skips the disable.
  await store.write([
    { connectorId: "spotify", account: "fixture", enabled: true, enabledAt: latched },
  ]);
  let raced = false;
  const io: typeof fetch = async (input, init) => {
    if (String(input) === store.url && init?.method === "PUT" && !raced) {
      raced = true;
      await h.pod.fetch(store.url, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([
          {
            connectorId: "spotify",
            account: "fixture",
            enabled: true,
            enabledAt: owner,
            intervalMinutes: 30,
          },
        ]),
      });
    }
    return h.io(input, init);
  };
  expect(await createConnectionStore({ ...h.options, fetch: io }).update(disable)).toBe(
    "superseded",
  );
  expect(raced).toBe(true);
  expect(await store.read()).toEqual([
    {
      connectorId: "spotify",
      account: "fixture",
      enabled: true,
      enabledAt: owner,
      intervalMinutes: 30,
    },
  ]);
  // Unchanged enabledAt (here: absent on both sides) still disables.
  await store.write([{ connectorId: "spotify", account: "fixture", enabled: true }]);
  expect(await store.update({ ...disable, enabledAt: undefined })).toBe("applied");
  expect(await store.read()).toEqual([
    { connectorId: "spotify", account: "fixture", enabled: false, status: "needs-reauth" },
  ]);
});

describe("cross-host run claims", () => {
  const url = `${TEST_POD_ROOT}integrations/spotify/state.json`;
  const okReport = async () => ({
    adapterId: "spotify",
    mode: "live" as const,
    written: [],
    categories: [],
    indexUrl: "https://pod.example/index",
    state: { ...base, lastSync: AT, cursor: "run" },
  });
  /** One host: its own scheduler and its own long-lived state store on the shared pod. */
  function host(
    h: ReturnType<typeof fixture>,
    clock: () => number,
    runner: ConnectorSchedulerOptions["runner"],
  ) {
    const store = createConnectorStateStore({ ...h.options, adapterId: "spotify" });
    return new ConnectorScheduler({
      connections: [{ connectorId: "spotify", account: "fixture", enabled: true }],
      now: clock,
      tokenSource: { accessToken: async () => "synthetic" },
      sourceFetch: vi.fn(),
      saveConnection: vi.fn(),
      podWriter: vi.fn(),
      stateStore: () => ({ read: () => store.read(), write: (s) => store.write(s) }),
      runner,
    });
  }
  const stored = (h: ReturnType<typeof fixture>) =>
    connectorState(JSON.parse(h.pod.get(url) ?? "null"));
  it("runs a due connection once across two hosts sharing one pod", async () => {
    const h = fixture();
    const clock = () => Date.parse(AT);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const runner = vi.fn(async () => {
      entered();
      await gate;
      return okReport();
    });
    const a = host(h, clock, runner),
      b = host(h, clock, runner);
    const pass = a.tick();
    await started;
    // A holds an unexpired claim: B skips quietly, writing nothing.
    const claim = stored(h).claims?.fixture;
    expect(claim?.holder).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(Date.parse(claim?.expiresAt ?? "")).toBeGreaterThan(Date.parse(AT));
    h.requests.length = 0;
    await b.tick();
    expect(h.requests.filter((r) => r.method === "PUT" && r.url === url)).toEqual([]);
    release();
    await pass;
    expect(runner).toHaveBeenCalledOnce();
    expect(stored(h).claims?.fixture).toBeUndefined();
    expect(stored(h).accounts?.fixture?.health?.outcome).toBe("ok");
    // Racing claims on one pod: the conditional write lets exactly one host run.
    const raced = fixture();
    const both = vi.fn(okReport);
    await Promise.all([host(raced, clock, both).tick(), host(raced, clock, both).tick()]);
    expect(both).toHaveBeenCalledOnce();
    expect(stored(raced).accounts?.fixture?.health?.outcome).toBe("ok");
    expect(stored(raced).accounts?.fixture?.health?.errorClass).toBeUndefined();
  });
  it("takes over only an expired (or implausibly long) foreign claim", async () => {
    const h = fixture();
    let now = Date.parse(AT);
    const plant = async (expiresAt: string) => {
      const current = h.pod.get(url);
      const claims = { fixture: { holder: "other-host", expiresAt } };
      await h.pod.fetch(url, {
        method: "PUT",
        body: JSON.stringify(current ? { ...JSON.parse(current), claims } : { ...base, claims }),
        headers: { "content-type": "application/json" },
      });
    };
    await plant(new Date(now + 10 * 60_000).toISOString());
    const runner = vi.fn(okReport);
    const scheduler = host(h, () => now, runner);
    h.requests.length = 0;
    await scheduler.tick();
    expect(runner).not.toHaveBeenCalled();
    expect(h.requests.filter((r) => r.method === "PUT" && r.url === url)).toEqual([]);
    // The skipped connection waits for the claim to expire instead of re-reading.
    h.requests.length = 0;
    await scheduler.tick();
    expect(h.requests.filter((r) => r.url === url)).toEqual([]);
    now += 10 * 60_000;
    await scheduler.tick();
    expect(runner).toHaveBeenCalledOnce();
    expect(stored(h).claims?.fixture).toBeUndefined();
    // A claim expiring far beyond any run's limit is not trusted (forged or skewed).
    await plant(new Date(now + 365 * 86_400_000).toISOString());
    const fresh = host(h, () => now + 3 * 3_600_000, runner);
    await fresh.tick();
    expect(runner).toHaveBeenCalledTimes(2);
    expect(stored(h).claims?.fixture).toBeUndefined();
  });
});
it("refuses a container or out-of-directory ACL target for a private JSON resource", async () => {
  const h = fixture();
  for (const link of [
    `<${TEST_POD_ROOT}integrations/.acl>; rel="acl"`,
    '<./.acl>; rel="acl"',
    '<./>; rel="acl"',
    `<${TEST_POD_ROOT}integrations/spotify/.acl>; rel="acl"`,
    `<${TEST_POD_ROOT}integrations/spotify/connections.json.acl>; rel="acl"`,
  ]) {
    const io: typeof fetch = vi.fn(
      async () => new Response(null, { status: 404, headers: { link } }),
    );
    // Refused before any ACL write (the root itself already fails the scope check).
    await expect(createConnectionStore({ ...h.options, fetch: io }).read()).rejects.toThrow(
      /Invalid ACL target|target URL/,
    );
    expect(io).toHaveBeenCalledTimes(1);
  }
  const io: typeof fetch = vi.fn(
    async () =>
      new Response(null, {
        status: 404,
        headers: { link: `<${TEST_POD_ROOT}integrations/spotify/.acl>; rel="acl"` },
      }),
  );
  await expect(
    createConnectorStateStore({ ...h.options, fetch: io, adapterId: "spotify" }).read(),
  ).rejects.toThrow("Invalid ACL target");
  expect(io).toHaveBeenCalledTimes(1);
});
