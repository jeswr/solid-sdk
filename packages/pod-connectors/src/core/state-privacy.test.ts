// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.2
import { describe, expect, it, vi } from "vitest";
import { createStateStore } from "../node/state.js";
import { createConnectionStore } from "./connections-store.js";
import { connectorStateLocation } from "./container.js";
import { PrivateDestinationError } from "./errors.js";
import { ConnectorScheduler, type ConnectorSchedulerOptions } from "./scheduler.js";
import { connectorState } from "./state.js";
import { createConnectorStateStore } from "./state-store.js";
import { createMemoryPod, ownerOnlyFixtureChecks, TEST_POD_ROOT, TEST_WEBID } from "./testing.js";
import type { ConnectorState } from "./types.js";

const AT = "2026-11-01T12:00:00.000Z";
const base: ConnectorState = {
  connectedAt: AT,
  lastOutcome: "success",
  counts: { documents: 0, items: 0, skipped: 0 },
};
const SPOTIFY_STATE = `${TEST_POD_ROOT}integrations/spotify/state.json`;

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
  const mutations = () => requests.filter((r) => !["GET", "HEAD"].includes(r.method));
  return {
    pod,
    requests,
    mutations,
    io,
    options: { podRoot: TEST_POD_ROOT, webId: TEST_WEBID, fetch: io },
  };
}
function scheduler(
  stateStore: ConnectorSchedulerOptions["stateStore"],
  overrides: Partial<ConnectorSchedulerOptions> = {},
) {
  const runner = vi.fn(async () => ({
    adapterId: "spotify",
    mode: "live" as const,
    written: [],
    categories: [],
    indexUrl: `${TEST_POD_ROOT}index`,
    state: { ...base, lastSync: AT, cursor: "scheduler-cursor" },
  }));
  const tokenSource = { accessToken: vi.fn(async () => "synthetic") };
  const onRunError = vi.fn();
  return {
    runner,
    tokenSource,
    onRunError,
    scheduler: new ConnectorScheduler({
      connections: [{ connectorId: "spotify", account: "fixture", enabled: true }],
      now: () => Date.parse(AT),
      tokenSource,
      sourceFetch: vi.fn(),
      saveConnection: vi.fn(),
      // The fixture runner never writes through it.
      podWriter: () => ({
        resolve: (slug: string) => `${TEST_POD_ROOT}integrations/spotify/${slug}`,
        read: async () => undefined,
        write: vi.fn(),
        registerType: vi.fn(),
      }),
      stateStore,
      runner,
      onRunError,
      ...overrides,
    }),
  };
}

describe("private connector state writes (scheduler path)", () => {
  it("refuses a private connector's state without a verifier before any Pod request", async () => {
    const h = fixture();
    const store = createConnectorStateStore({ ...h.options, adapterId: "spotify" });
    await expect(store.read()).rejects.toBeInstanceOf(PrivateDestinationError);
    await expect(store.read()).rejects.toMatchObject({ phase: "before-write" });
    expect(h.requests).toEqual([]);
    // A verifier without its after-write confirmation never starts a write either.
    const half = createConnectorStateStore({
      ...h.options,
      adapterId: "spotify",
      privateDestination: { verifyPrivateDestination: vi.fn(async () => true) },
    });
    await expect(half.read()).rejects.toBeInstanceOf(PrivateDestinationError);
    expect(h.requests).toEqual([]);
  });

  it.each([
    "spotify",
    "fitbit",
  ])("refuses all scheduling writes for %s without a private state verifier", async (connectorId) => {
    const h = fixture();
    const s = scheduler(
      (adapterId, signal) => createConnectorStateStore({ ...h.options, adapterId, signal }),
      { connections: [{ connectorId, account: "fixture", enabled: true }] },
    );
    await s.scheduler.tick();
    expect(h.requests).toEqual([]);
    expect(s.tokenSource.accessToken).not.toHaveBeenCalled();
    expect(s.runner).not.toHaveBeenCalled();
    expect(s.onRunError).toHaveBeenCalledOnce();
    expect(h.pod.get(connectorStateLocation(TEST_POD_ROOT, connectorId).url)).toBeUndefined();
  });

  it("verifies the exact state URL before the ACL install and before each write", async () => {
    const h = fixture();
    // Mutations already sent each time the verifier runs: it always precedes the next one.
    const seen: number[] = [];
    const verify = vi.fn(async (_url: string) => {
      seen.push(h.mutations().length);
      return true;
    });
    const confirm = vi.fn(async () => true);
    const store = createConnectorStateStore({
      ...h.options,
      adapterId: "spotify",
      privateDestination: { verifyPrivateDestination: verify, confirmPrivateWrite: confirm },
    });
    await store.read();
    expect(verify).toHaveBeenCalledWith(SPOTIFY_STATE);
    await store.write(base);
    expect(verify).toHaveBeenCalledTimes(2);
    expect(confirm).toHaveBeenCalledWith(SPOTIFY_STATE, { etag: '"v1"' }, expect.any(Function));
    await store.read();
    await store.write({ ...base, cursor: "next" });
    expect(verify).toHaveBeenCalledTimes(3);
    expect(confirm).toHaveBeenCalledTimes(2);
    // read: verify → ACL; create: verify → ACL → PUT; update: verify → PUT.
    expect(seen).toEqual([0, 1, 3]);
    expect(h.mutations().map((r) => r.method)).toEqual(["PUT", "PUT", "PUT", "PUT"]);
  });

  it("refuses on a false verification and stays refused without asking again", async () => {
    const h = fixture();
    const verify = vi.fn(async () => false);
    const store = createConnectorStateStore({
      ...h.options,
      adapterId: "spotify",
      privateDestination: {
        verifyPrivateDestination: verify,
        confirmPrivateWrite: async () => true,
      },
    });
    await expect(store.read()).rejects.toBeInstanceOf(PrivateDestinationError);
    await expect(store.read()).rejects.toBeInstanceOf(PrivateDestinationError);
    expect(verify).toHaveBeenCalledOnce();
    expect(h.requests).toEqual([]);
  });

  it("does not turn a cancelled verification into a sticky refusal", async () => {
    const h = fixture();
    const controller = new AbortController();
    let allow = false;
    const store = createConnectorStateStore({
      ...h.options,
      adapterId: "spotify",
      privateDestination: {
        verifyPrivateDestination: async () => {
          controller.abort(new Error("cancelled"));
          return allow;
        },
        confirmPrivateWrite: async () => true,
      },
    });
    await expect(store.read(controller.signal)).rejects.toThrow("cancelled");
    expect(h.requests).toEqual([]);
    allow = true;
    await expect(store.read()).resolves.toBeUndefined();
  });

  it("removes a created state file whose after-write confirmation refuses, then stays refused", async () => {
    const h = fixture();
    const store = createConnectorStateStore({
      ...h.options,
      adapterId: "spotify",
      privateDestination: {
        verifyPrivateDestination: async () => true,
        confirmPrivateWrite: async () => false,
      },
    });
    await store.read();
    const error = await store.write(base).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PrivateDestinationError);
    expect(error).toMatchObject({ phase: "after-write", removed: true, url: SPOTIFY_STATE });
    expect(h.pod.get(SPOTIFY_STATE)).toBeUndefined();
    const deletes = h.requests.filter((r) => r.method === "DELETE");
    expect(deletes.map((r) => [r.url, r.headers.get("if-match")])).toEqual([
      [SPOTIFY_STATE, '"v1"'],
    ]);
    // Sticky: a later write is refused before any request.
    await store.read();
    const before = h.mutations().length;
    await expect(store.write(base)).rejects.toBeInstanceOf(PrivateDestinationError);
    expect(h.mutations()).toHaveLength(before);
  });

  it("keeps an existing checkpoint (never deletes it) when confirming its update refuses", async () => {
    const h = fixture();
    await h.pod.fetch(SPOTIFY_STATE, {
      method: "PUT",
      body: JSON.stringify(base),
      headers: { "content-type": "application/json" },
    });
    const store = createConnectorStateStore({
      ...h.options,
      adapterId: "spotify",
      privateDestination: {
        verifyPrivateDestination: async () => true,
        confirmPrivateWrite: async () => false,
      },
    });
    await store.read();
    await expect(store.write({ ...base, cursor: "next" })).rejects.toMatchObject({
      phase: "after-write",
      removed: false,
    });
    expect(h.requests.filter((r) => r.method === "DELETE")).toEqual([]);
    expect(h.pod.get(SPOTIFY_STATE)).toBeDefined();
  });

  it("gates the connection settings document, which names private services, but not peek", async () => {
    const h = fixture();
    const store = createConnectionStore(h.options);
    await expect(store.read()).rejects.toBeInstanceOf(PrivateDestinationError);
    expect(h.requests).toEqual([]);
    await expect(store.peek()).resolves.toBeUndefined();
    expect(h.mutations()).toEqual([]);
    const checked = createConnectionStore({
      ...h.options,
      privateDestination: ownerOnlyFixtureChecks,
    });
    await checked.read();
    await checked.write([{ connectorId: "spotify", account: "fixture", enabled: true }]);
    expect(await store.peek()).toHaveLength(1);
  });
});

describe("one checkpoint shared by the CLI and the scheduler", () => {
  it("keeps the CLI's fileCursor and sync health and the scheduler's accounts, claims and health", async () => {
    const h = fixture();
    const cli = createStateStore({ ...h.options, adapterId: "spotify" });
    await cli.read();
    await cli.write({
      ...base,
      cursor: "cli-api",
      fileCursor: "cli-file",
      sync: { conflicts: 1, pendingDeletes: 2, failed: 3 },
      // Incidental properties are never persisted by either writer.
      token: "never-persisted",
    } as ConnectorState);
    const s = scheduler((adapterId, signal) =>
      createConnectorStateStore({
        ...h.options,
        adapterId,
        signal,
        privateDestination: ownerOnlyFixtureChecks,
      }),
    );
    await s.scheduler.tick();
    expect(s.runner).toHaveBeenCalledOnce();
    const afterScheduler = connectorState(JSON.parse(h.pod.get(SPOTIFY_STATE) ?? "null"));
    expect(afterScheduler).toMatchObject({
      cursor: "cli-api",
      fileCursor: "cli-file",
      sync: { conflicts: 1, pendingDeletes: 2, failed: 3 },
      accounts: { fixture: { cursor: "scheduler-cursor", health: { outcome: "ok" } } },
      health: { outcome: "ok" },
    });
    expect(h.pod.get(SPOTIFY_STATE)).not.toContain("never-persisted");

    // Another host's live claim lands on the same document.
    const claims = { other: { holder: "other-host", expiresAt: "2026-11-01T12:10:00.000Z" } };
    const sched = createConnectorStateStore({
      ...h.options,
      adapterId: "spotify",
      privateDestination: ownerOnlyFixtureChecks,
    });
    await sched.write({ ...((await sched.read()) as ConnectorState), claims });

    // The CLI writes only the fields it owns, as its import loop does.
    await cli.read();
    await cli.write({ ...base, lastSync: AT, cursor: "cli-api-2", fileCursor: "cli-file-2" });
    const afterCli = connectorState(JSON.parse(h.pod.get(SPOTIFY_STATE) ?? "null"));
    expect(afterCli).toMatchObject({
      cursor: "cli-api-2",
      fileCursor: "cli-file-2",
      accounts: { fixture: { cursor: "scheduler-cursor" } },
      health: { outcome: "ok" },
      claims,
    });
    // Each writer sees the other's validated fields through the one parser.
    expect(await cli.read()).toEqual(afterCli);
    expect(await sched.read()).toEqual(afterCli);
  });

  it("stores google-health scheduler state at integrations/fitbit/state-google-health.json", async () => {
    const h = fixture();
    const url = `${TEST_POD_ROOT}integrations/fitbit/state-google-health.json`;
    expect(connectorStateLocation(TEST_POD_ROOT, "google-health").url).toBe(url);
    expect(createStateStore({ ...h.options, adapterId: "google-health" }).url).toBe(url);
    const store = createConnectorStateStore({
      ...h.options,
      adapterId: "google-health",
      privateDestination: ownerOnlyFixtureChecks,
    });
    expect(store.url).toBe(url);
    const s = scheduler(
      (adapterId, signal) =>
        createConnectorStateStore({
          ...h.options,
          adapterId,
          signal,
          privateDestination: ownerOnlyFixtureChecks,
        }),
      { connections: [{ connectorId: "google-health", account: "fixture", enabled: true }] },
    );
    await s.scheduler.tick();
    expect(s.runner).toHaveBeenCalledOnce();
    expect(connectorState(JSON.parse(h.pod.get(url) ?? "null")).accounts?.fixture?.cursor).toBe(
      "scheduler-cursor",
    );
    expect(h.pod.get(`${TEST_POD_ROOT}integrations/google-health/state.json`)).toBeUndefined();
    expect(h.pod.get(`${TEST_POD_ROOT}integrations/fitbit/state.json`)).toBeUndefined();
    expect(h.requests.some((r) => r.url.includes("/integrations/google-health/"))).toBe(false);
  });
});
