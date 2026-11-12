// AUTHORED-BY Codex GPT-6.1-Sol
import { AclResource } from "@solid/object";
import { DataFactory } from "n3";
import { expect, it, vi } from "vitest";
import { createConnectionStore } from "./connections-store.js";
import { ConnectorScheduler } from "./scheduler.js";
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
    if (String(input) === url && init?.method === "PUT" && conflict) {
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
  expect(puts.map((p) => p.headers.get("if-match"))).toEqual(['"v1"', '"v2"']);
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
  await store.update({
    connectorId: "spotify",
    account: "fixture",
    enabled: true,
    enabledAt: "2026-11-01T12:00:00.000Z",
  });
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
  await store.update(disable);
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
  await createConnectionStore({ ...h.options, fetch: io }).update(disable);
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
  await store.update({ ...disable, enabledAt: undefined });
  expect(await store.read()).toEqual([
    { connectorId: "spotify", account: "fixture", enabled: false, status: "needs-reauth" },
  ]);
});
