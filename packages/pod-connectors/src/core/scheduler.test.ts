// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { createRegistry } from "../registry.js";
import { IntegrationSyncError, RateLimitedError } from "./errors.js";
import { connectorHealth, connectorHealthSummary } from "./health.js";
import { type ImportReport, type RunImportOptions, runImport } from "./import-runner.js";
import { createFetchPodWriter } from "./pod-writer.js";
import {
  type ConnectorConnection,
  ConnectorScheduler,
  type ConnectorSchedulerOptions,
  connectorBackoffMs,
  connectorConnections,
  connectorNextRunAt,
  MAX_CONNECTOR_BACKOFF_MS,
  parseConnectorConnections,
} from "./scheduler.js";
import {
  connectorState,
  mergeAccountState,
  StateConflictError,
  updateConnectorState,
} from "./state.js";
import { createMemoryPod, TEST_POD_ROOT, TEST_PROFILE_DOC, TEST_WEBID } from "./testing.js";
import type { ConnectorRunHealth, ConnectorState, IntegrationAdapter, PodWriter } from "./types.js";
import { ConnectionRemovedError, ReauthoriseError } from "./types.js";
import { CLASSES, MusicRecording } from "./vocab.js";

const AT = Date.parse("2026-11-01T12:00:00.000Z");
const iso = (n = AT) => new Date(n).toISOString();
function fixtureAdapter() {
  const adapter = createRegistry().adapterById("spotify");
  if (!adapter) throw new Error("Missing fixture adapter");
  return adapter;
}
const legacy: ConnectorState = {
  connectedAt: iso(AT - 86_400_000),
  lastSync: iso(),
  cursor: "old",
  lastOutcome: "success",
  counts: { documents: 4, items: 7, skipped: 0 },
};
const connection = (connectorId = "spotify", account = "fixture"): ConnectorConnection => ({
  connectorId,
  account,
  enabled: true,
});
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { resolve, promise };
}
function report(o: RunImportOptions): ImportReport {
  return {
    adapterId: o.adapter.metadata.id,
    mode: "live",
    written: [],
    categories: [],
    indexUrl: "https://pod.example/index",
    state: { ...legacy, cursor: "new" },
    counts: { created: 1, updated: 2, unchanged: 3, skipped: 0 },
  };
}
function harness(connections = [connection()], overrides: Partial<ConnectorSchedulerOptions> = {}) {
  let now = AT;
  const states = new Map<string, ConnectorState>();
  const writes = vi.fn();
  const tokenSource = { accessToken: vi.fn(async () => "synthetic-token") };
  const runner = vi.fn(async (o: RunImportOptions) => report(o));
  const saveConnection = vi.fn(async () => undefined);
  const podWriter: PodWriter = {
    resolve: (slug) => `https://pod.example/integrations/spotify/${slug}`,
    read: async () => undefined,
    write: vi.fn(),
    registerType: vi.fn(),
  };
  const options: ConnectorSchedulerOptions = {
    connections,
    tokenSource,
    runner,
    sourceFetch: vi.fn(),
    saveConnection,
    podWriter: () => podWriter,
    now: () => now,
    random: () => 0,
    stateStore: (id) => ({
      read: async () => states.get(id),
      write: async (s) => {
        writes(id, s);
        states.set(id, s);
      },
    }),
    ...overrides,
  };
  return {
    scheduler: new ConnectorScheduler(options),
    options,
    states,
    runner,
    tokenSource,
    writes,
    saveConnection,
    setNow: (value: number) => {
      now = value;
    },
  };
}

describe("connection validation and due computation", () => {
  it("floors intervals, uses per-connector defaults, and skips disabled connections", async () => {
    const registry = createRegistry();
    expect(
      registry.allCatalogEntries().find((c) => c.id === "spotify")?.defaultIntervalMinutes,
    ).toBe(60);
    expect(
      registry.allCatalogEntries().find((c) => c.id === "netflix")?.defaultIntervalMinutes,
    ).toBeUndefined();
    expect(
      connectorConnections([{ ...connection(), intervalMinutes: 1 }])[0]?.intervalMinutes,
    ).toBe(15);
    expect(connectorNextRunAt(connection(), undefined)).toBe(0);
    expect(connectorNextRunAt(connection(), legacy, 60, AT)).toBe(AT + 3_600_000);
    expect(connectorNextRunAt(connection(), legacy, 120, AT)).toBe(AT + 7_200_000);
    expect(connectorNextRunAt({ ...connection(), enabled: false }, legacy)).toBeUndefined();
    const h = harness([
      { ...connection(), intervalMinutes: 1 },
      { ...connection("github"), enabled: false },
    ]);
    await h.scheduler.tick();
    await h.scheduler.tick();
    expect(h.runner).toHaveBeenCalledTimes(1);
    expect(h.states.get("spotify")?.health?.nextRunAt).toBe(iso(AT + 900_000));
    h.setNow(AT + 899_999);
    await h.scheduler.tick();
    expect(h.runner).toHaveBeenCalledTimes(1);
    h.setNow(AT + 900_000);
    await h.scheduler.tick();
    expect(h.runner).toHaveBeenCalledTimes(2);
  });
  it("resumes old successful checkpoints only when due", async () => {
    const h = harness();
    h.states.set("spotify", legacy);
    await h.scheduler.tick();
    expect(h.runner).not.toHaveBeenCalled();
    h.setNow(AT + 3_600_000);
    await h.scheduler.tick();
    expect(h.runner.mock.calls[0]?.[0].state?.cursor).toBe("old");
  });
  it.each([
    NaN,
    Infinity,
    -1,
    0,
    "15",
    1_000_000,
  ])("rejects invalid intervals (%s)", (intervalMinutes) => {
    expect(() => connectorConnections([{ ...connection(), intervalMinutes }])).toThrow();
  });
  it("rejects unbounded/duplicate connections, path accounts and unsupported adapters", () => {
    expect(() => connectorConnections(Array.from({ length: 1_001 }, () => connection()))).toThrow();
    expect(() => connectorConnections([connection(), connection()])).toThrow();
    for (const account of ["../state", "a@b.example", "x\nsecret", "x".repeat(129), "__proto__"])
      expect(() => connectorConnections([{ ...connection(), account }])).toThrow();
    // Unschedulable rows are skipped individually instead of rejecting the list.
    const skipped = harness([connection("netflix"), connection("unknown"), connection()]);
    expect(skipped.scheduler.list().map((c) => c.connectorId)).toEqual(["spotify"]);
    expect(skipped.scheduler.invalid()).toEqual([
      {
        index: 0,
        connectorId: "netflix",
        account: "fixture",
        status: "invalid-config",
        errorClass: "invalid-config",
      },
      {
        index: 1,
        connectorId: "unknown",
        account: "fixture",
        status: "invalid-config",
        errorClass: "invalid-config",
      },
    ]);
    for (const concurrency of [0, 17, 1.5, NaN])
      expect(() => harness(undefined, { concurrency })).toThrow();
  });
});

describe("scheduler execution", () => {
  it("joins overlapping ticks and serializes different accounts in one connector container", async () => {
    const gate = deferred(),
      entered = deferred();
    let active = 0,
      peak = 0;
    const h = harness([connection(), connection("spotify", "second")], {
      runner: async (o) => {
        peak = Math.max(peak, ++active);
        entered.resolve();
        await gate.promise;
        active--;
        return report(o);
      },
    });
    const a = h.scheduler.tick();
    await entered.promise;
    const b = h.scheduler.tick();
    expect(a).toBe(b);
    gate.resolve();
    await Promise.all([a, b]);
    expect(peak).toBe(1);
    expect(Object.keys(h.states.get("spotify")?.accounts ?? {})).toEqual(["fixture", "second"]);
  });
  it("caps global concurrency and starts queued connectors as workers free", async () => {
    const gates = [deferred(), deferred(), deferred()],
      two = deferred();
    let active = 0,
      peak = 0,
      calls = 0;
    const h = harness([connection(), connection("github"), connection("strava")], {
      runner: async (o) => {
        const i = calls++;
        peak = Math.max(peak, ++active);
        if (calls === 2) two.resolve();
        await gates[i]?.promise;
        active--;
        return report(o);
      },
    });
    const pass = h.scheduler.tick();
    await two.promise;
    expect(calls).toBe(2);
    expect(peak).toBe(2);
    gates[0]?.resolve();
    gates[1]?.resolve();
    gates[2]?.resolve();
    await pass;
    expect(calls).toBe(3);
    expect(peak).toBe(2);
  });
  it("backs off exponentially with bounded jitter and a 24 hour cap, then resets on recovery", async () => {
    let fail = true;
    const h = harness(undefined, {
      runner: async (o) => {
        if (fail) throw new Error("secret https://provider.example/?token=private");
        return report(o);
      },
    });
    for (let n = 1; n <= 10; n++) {
      await h.scheduler.tick();
      const state = h.states.get("spotify");
      if (!state) throw new Error("Missing scheduler state");
      expect(state.health?.consecutiveFailures).toBe(n);
      const delay =
        Date.parse(state.health?.nextRunAt ?? "") - Date.parse(state.health?.lastRunEndedAt ?? "");
      expect(delay).toBe(Math.min(MAX_CONNECTOR_BACKOFF_MS, 900_000 * 2 ** (n - 1)));
      expect(JSON.stringify(state)).not.toMatch(/private|provider|token=/);
      h.setNow(Date.parse(state.health?.nextRunAt ?? ""));
    }
    expect(connectorBackoffMs(1, () => 1)).toBe(1_125_000);
    expect(connectorBackoffMs(100_000, () => 1)).toBe(MAX_CONNECTOR_BACKOFF_MS);
    fail = false;
    await h.scheduler.tick();
    expect(h.states.get("spotify")?.health).toMatchObject({
      outcome: "ok",
      consecutiveFailures: 0,
    });
  });
  it("disables and durably latches needs-reauth until explicit re-enable, including restart", async () => {
    const h = harness();
    h.tokenSource.accessToken.mockRejectedValueOnce(new ReauthoriseError());
    await h.scheduler.tick();
    expect(h.scheduler.list()[0]).toMatchObject({ enabled: false, status: "needs-reauth" });
    expect(h.saveConnection).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false, status: "needs-reauth" }),
      expect.any(AbortSignal),
    );
    expect(h.states.get("spotify")?.health).toMatchObject({
      outcome: "needs-reauth",
      errorClass: "reauthorise",
    });
    expect(h.states.get("spotify")?.health?.nextRunAt).toBeUndefined();
    expect(h.runner).not.toHaveBeenCalled();
    await h.scheduler.tick();
    expect(h.tokenSource.accessToken).toHaveBeenCalledTimes(1);
    const restarted = new ConnectorScheduler(h.options);
    await restarted.tick();
    expect(h.tokenSource.accessToken).toHaveBeenCalledTimes(1);
    await restarted.setEnabled("spotify", "fixture", true);
    await restarted.tick();
    expect(h.runner).toHaveBeenCalledOnce();
    expect(h.states.get("spotify")?.health).toMatchObject({
      outcome: "ok",
      consecutiveFailures: 0,
    });
  });
  it("recovers when the host refreshes a disabled connection to enabled with a newer enabledAt", async () => {
    const h = harness();
    h.tokenSource.accessToken.mockRejectedValueOnce(new ReauthoriseError());
    await h.scheduler.tick();
    // Flipping enabled without a newer enabledAt keeps the durable latch.
    await h.scheduler.setConnections([connection()]);
    await h.scheduler.tick();
    expect(h.runner).not.toHaveBeenCalled();
    h.setNow(AT + 60_000);
    await h.scheduler.setConnections([{ ...connection(), enabledAt: iso(AT + 30_000) }]);
    await h.scheduler.tick();
    expect(h.runner).toHaveBeenCalledOnce();
  });
  it("keeps a successful checkpoint on failure while recording partial-write counters", async () => {
    const h = harness(undefined, {
      runner: async (o) => {
        o.onRunCounts?.({ created: 2, updated: 1, unchanged: 0, skipped: 0 });
        throw new IntegrationSyncError("spotify", "secret", { status: 500 });
      },
    });
    h.states.set("spotify", { ...legacy, lastSync: iso(AT - 3_600_000) });
    await h.scheduler.tick();
    const state = h.states.get("spotify");
    if (!state) throw new Error("Missing scheduler state");
    expect(state.cursor).toBe("old");
    expect(state.counts).toEqual(legacy.counts);
    expect(state.lastSync).toBe(iso(AT - 3_600_000));
    expect(state.health).toMatchObject({
      outcome: "failed",
      errorClass: "source-or-pod",
      counts: { created: 2, updated: 1 },
    });
  });
  it("reports partial outcomes without failing or losing the new cursor", async () => {
    const h = harness(undefined, {
      runner: async (o) => ({
        ...report(o),
        counts: { created: 0, updated: 0, unchanged: 1, skipped: 2 },
      }),
    });
    await h.scheduler.tick();
    expect(h.states.get("spotify")?.accounts?.fixture).toMatchObject({
      cursor: "new",
      health: { outcome: "partial", consecutiveFailures: 0, counts: { skipped: 2 } },
    });
  });
  it.each([
    [new RateLimitedError("spotify", "https://secret.example", 30), "rate-limited"],
    [new IntegrationSyncError("spotify", "private", { status: 401 }), "unauthorised"],
    [new IntegrationSyncError("spotify", "private", { status: 403 }), "forbidden"],
    [new IntegrationSyncError("spotify", "private", { status: 412 }), "conflict"],
    [new Error("private"), "unexpected"],
  ])("projects typed errors to stable codes (%s)", async (error, errorClass) => {
    const h = harness(undefined, {
      runner: async () => {
        throw error;
      },
    });
    await h.scheduler.tick();
    expect(h.states.get("spotify")?.health?.errorClass).toBe(errorClass);
    expect(JSON.stringify(h.states.get("spotify"))).not.toContain("private");
  });
  it("drains an aborted runner and starts no health/config I/O after shutdown", async () => {
    const entered = deferred(),
      drained = vi.fn();
    let signal: AbortSignal | undefined;
    const h = harness([connection(), connection("github")], {
      concurrency: 1,
      runner: async (o) => {
        signal = o.signal;
        entered.resolve();
        await new Promise<void>((resolve) =>
          o.signal?.addEventListener("abort", () => resolve(), { once: true }),
        );
        drained();
        o.signal?.throwIfAborted();
        return report(o);
      },
    });
    const pass = h.scheduler.tick();
    await entered.promise;
    await h.scheduler.stop();
    await pass;
    expect(signal?.aborted).toBe(true);
    expect(drained).toHaveBeenCalledOnce();
    expect(h.writes).not.toHaveBeenCalled();
    expect(h.saveConnection).not.toHaveBeenCalled();
    await h.scheduler.tick();
    expect(h.tokenSource.accessToken).toHaveBeenCalledTimes(1);
  });
  it("uses injectable sleep and stops a running loop on its signal", async () => {
    const controller = new AbortController(),
      ran = deferred(),
      written = deferred();
    const sleep = vi.fn(async (_ms, signal: AbortSignal) => {
      expect(signal.aborted).toBe(false);
      await written.promise;
      controller.abort();
    });
    let runs = 0;
    const states = new Map<string, ConnectorState>();
    const h = harness(undefined, {
      sleep,
      runner: async (o) => {
        runs++;
        ran.resolve();
        return report(o);
      },
      stateStore: (id) => ({
        read: async () => states.get(id),
        write: async (state) => {
          states.set(id, state);
          written.resolve();
        },
      }),
    });
    await h.scheduler.run(controller.signal);
    await ran.promise;
    expect(runs).toBe(1);
    expect(states.get("spotify")?.accounts?.fixture?.health?.outcome).toBe("ok");
    expect(sleep).toHaveBeenCalledWith(30_000, expect.any(AbortSignal));
  });
  it("isolates a state persistence failure to its connection with its own back-off", async () => {
    const gate = deferred(),
      entered = deferred(),
      onRunError = vi.fn();
    let drained = false;
    const h = harness([connection(), connection("github")], {
      onRunError,
      runner: async (o) => {
        if (o.adapter.metadata.id === "github") {
          entered.resolve();
          await gate.promise;
          drained = true;
        }
        return report(o);
      },
      stateStore: (id) => ({
        read: async () => undefined,
        write: async () => {
          if (id === "spotify") throw new Error("secret");
        },
      }),
    });
    const result = h.scheduler.tick();
    await entered.promise;
    gate.resolve();
    await expect(result).resolves.toBeUndefined();
    expect(drained).toBe(true);
    expect(onRunError).toHaveBeenCalledWith(
      expect.objectContaining({ connectorId: "spotify" }),
      "unexpected",
    );
    expect(JSON.stringify(onRunError.mock.calls)).not.toContain("secret");
    // The failed connection waits for its back-off (15 minutes, zero jitter).
    let spotify = 0;
    const counting = harness([connection()], {
      runner: async (o) => {
        spotify++;
        return report(o);
      },
      stateStore: () => ({
        read: async () => undefined,
        write: async () => {
          throw new Error("secret");
        },
      }),
    });
    await counting.scheduler.tick();
    await counting.scheduler.tick();
    expect(spotify).toBe(1);
    counting.setNow(AT + 900_000);
    await counting.scheduler.tick();
    expect(spotify).toBe(2);
  });
  it("never lets one worker rejection reject the tick for other connections", async () => {
    const h = harness([connection(), connection("github")], {
      podWriter: (c) => {
        if (c.connectorId === "spotify") throw new Error("private");
        return {
          resolve: (slug) => `https://pod.example/integrations/github/${slug}`,
          read: async () => undefined,
          write: vi.fn(),
          registerType: vi.fn(),
        };
      },
    });
    await h.scheduler.tick();
    expect(h.states.get("spotify")?.accounts?.fixture?.health).toMatchObject({
      outcome: "failed",
      errorClass: "unexpected",
    });
    expect(h.states.get("github")?.accounts?.fixture?.health?.outcome).toBe("ok");
  });
});

it("loads legacy state and projects scheduler fields without incidental secrets", () => {
  expect(connectorState(legacy)).toEqual(legacy);
  const next = connectorState({
    ...legacy,
    secret: "never",
    health: {
      lastRunStartedAt: iso(),
      lastRunEndedAt: iso(),
      outcome: "ok",
      counts: { created: 1, updated: 0, unchanged: 0, skipped: 0 },
      consecutiveFailures: 0,
      nextRunAt: iso(AT + 900_000),
      intervalMinutes: 15,
      token: "never",
    },
  });
  expect(JSON.stringify(next)).not.toContain("never");
  expect(() =>
    connectorState({
      ...next,
      health: { ...next.health, errorClass: "https://secret.example/token" },
    }),
  ).toThrow();
  expect(() =>
    connectorState({
      ...next,
      health: { ...next.health, counts: { ...next.health?.counts, created: -1 } },
    }),
  ).toThrow();
});
it("rereads and reapplies a merge on 412 with a bounded retry budget", async () => {
  let latest: ConnectorState = legacy,
    reads = 0,
    writes = 0;
  const store = {
    read: async () => {
      reads++;
      return latest;
    },
    write: async (state: ConnectorState) => {
      if (++writes === 1) {
        latest = { ...legacy, cursor: "concurrent", lastSync: iso(AT + 1) };
        throw new StateConflictError();
      }
      latest = state;
    },
  };
  await updateConnectorState(store, (current) => mergeAccountState(current, legacy, { now: AT }));
  expect(reads).toBe(2);
  expect(latest.cursor).toBe("concurrent");
  const write = vi.fn(async () => {
    throw new StateConflictError();
  });
  await expect(
    updateConnectorState({ read: store.read, write }, () => legacy),
  ).rejects.toBeInstanceOf(StateConflictError);
  expect(write).toHaveBeenCalledTimes(3);
});
it("classifies health and counts each connection at the three-interval boundary", () => {
  const health = {
    lastRunStartedAt: iso(),
    lastRunEndedAt: iso(),
    outcome: "needs-reauth" as const,
    counts: { created: 0, updated: 0, unchanged: 0, skipped: 0 },
    consecutiveFailures: 1,
    intervalMinutes: 60,
  };
  expect(connectorHealth({ state: legacy }, AT + 3 * 3_600_000 - 1)).toBe("ok");
  expect(connectorHealth({ state: legacy }, AT + 3 * 3_600_000)).toBe("stale");
  expect(
    connectorHealthSummary(
      [
        { state: legacy },
        {},
        { state: { ...legacy, lastOutcome: "error" } },
        { state: { ...legacy, health } },
        { status: "invalid-config" },
      ],
      AT,
    ),
  ).toEqual({ ok: 1, stale: 1, failing: 1, "needs-reauth": 1, "invalid-config": 1, total: 5 });
  // A latch cleared by a newer, trusted enabledAt awaits its run.
  expect(connectorHealth({ state: { ...legacy, health }, enabledAt: iso(AT + 1) }, AT)).toBe(
    "stale",
  );
  expect(connectorHealth({ state: { ...legacy, health }, enabledAt: iso(AT + 600_000) }, AT)).toBe(
    "needs-reauth",
  );
});
it("counts created/updated/unchanged documents through the real runner and preserves scheduler extensions", async () => {
  const pod = createMemoryPod();
  let title = "first";
  const adapter: IntegrationAdapter = {
    ...fixtureAdapter(),
    vocabMap: undefined,
    import: async (ctx) => {
      const dataset = new Store();
      const song = new MusicRecording(ctx.resolve("songs.ttl#one"), dataset, DataFactory);
      song.types.add(CLASSES.MusicRecording);
      song.name = title;
      await ctx.write({
        slug: "songs.ttl",
        dataset,
        forClass: CLASSES.MusicRecording,
        category: "media",
      });
      return {};
    },
  };
  const run = () =>
    runImport({
      adapter,
      trackChanges: true,
      mode: "demo",
      podWriter: createFetchPodWriter({
        podRoot: TEST_POD_ROOT,
        adapterId: "spotify",
        webId: TEST_WEBID,
        profileDocumentUrl: TEST_PROFILE_DOC,
        fetch: pod.fetch,
      }),
    });
  expect((await run()).counts).toEqual({ created: 1, updated: 0, unchanged: 0, skipped: 0 });
  expect((await run()).counts).toEqual({ created: 0, updated: 0, unchanged: 1, skipped: 0 });
  title = "second";
  expect((await run()).counts).toEqual({ created: 0, updated: 1, unchanged: 0, skipped: 0 });
});

it("applies interval edits to successful due times without bypassing failure backoff", async () => {
  const h = harness();
  await h.scheduler.tick();
  await h.scheduler.setConnections([{ ...connection(), intervalMinutes: 15 }]);
  h.setNow(AT + 900_000);
  await h.scheduler.tick();
  expect(h.runner).toHaveBeenCalledTimes(2);
});
it("passes cancellation to a real runner's in-flight source fetch and releases its container claim", async () => {
  const entered = deferred(),
    source = createRegistry().adapterById("spotify");
  if (!source) throw new Error("Missing fixture adapter");
  const adapter: IntegrationAdapter = {
    ...source,
    createSourceAuth: undefined,
    import: async (ctx) => {
      await ctx.api("https://api.spotify.com/v1/me");
      return {};
    },
  };
  const transport: typeof fetch = vi.fn(async (_input, init) => {
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer synthetic-token");
    entered.resolve();
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
  });
  const h = harness(undefined, {
    runner: undefined,
    sourceFetch: transport,
    registry: { adapterById: () => adapter },
  });
  const pass = h.scheduler.tick();
  await entered.promise;
  await h.scheduler.stop();
  await pass;
  expect(h.writes).not.toHaveBeenCalled();
  const writer = await h.options.podWriter(connection(), new AbortController().signal);
  const second = harness(undefined, {
    runner: undefined,
    podWriter: () => ({
      ...writer,
      registerType: async () => ({ indexUrl: "https://pod.example/index" }),
    }),
    registry: { adapterById: () => ({ ...adapter, import: async () => ({}) }) },
  });
  await second.scheduler.tick();
  expect(second.states.get("spotify")?.health?.outcome).toBe("ok");
});
it("retains a durable reauth latch when the settings save fails", async () => {
  const h = harness(undefined, {
    tokenSource: {
      accessToken: async () => {
        throw new ReauthoriseError();
      },
    },
    saveConnection: async () => {
      throw new Error("unavailable");
    },
  });
  await expect(h.scheduler.tick()).resolves.toBeUndefined();
  expect(h.states.get("spotify")?.accounts?.fixture?.health?.outcome).toBe("needs-reauth");
  // The settings row is still enabled with an unchanged (absent) enabledAt: the latch holds.
  await new ConnectorScheduler(h.options).tick();
  expect(h.runner).not.toHaveBeenCalled();
  h.setNow(AT + 60_000);
  await new ConnectorScheduler({
    ...h.options,
    connections: [{ ...connection(), enabledAt: iso(AT) }],
  }).tick();
  expect(h.runner).not.toHaveBeenCalled();
});

it("sees the owner's durable re-enable in a fresh process via a changed enabledAt", async () => {
  const h = harness([{ ...connection(), enabledAt: "2026-10-01T00:00:00.000Z" }]);
  h.tokenSource.accessToken.mockRejectedValueOnce(new ReauthoriseError());
  await h.scheduler.tick();
  expect(h.saveConnection).toHaveBeenCalledWith(
    expect.objectContaining({ enabled: false, status: "needs-reauth" }),
    expect.any(AbortSignal),
  );
  // The latch records the enabledAt it latched against.
  expect(h.states.get("spotify")?.accounts?.fixture?.health).toMatchObject({
    outcome: "needs-reauth",
    latchedEnabledAt: "2026-10-01T00:00:00.000Z",
  });
  h.setNow(AT + 120_000);
  // The same enabledAt (a failed settings save, or a flip without a new stamp) holds.
  await new ConnectorScheduler({
    ...h.options,
    connections: [{ ...connection(), enabledAt: "2026-10-01T00:00:00.000Z" }],
  }).tick();
  expect(h.runner).not.toHaveBeenCalled();
  // A different value clears it, whatever either clock says: here the owner's UI clock
  // is behind the latching run's clock, which a timestamp comparison would reject.
  const fresh = new ConnectorScheduler({
    ...h.options,
    connections: [{ ...connection(), enabledAt: iso(AT - 3_600_000) }],
  });
  await fresh.tick();
  expect(h.runner).toHaveBeenCalledOnce();
  expect(h.states.get("spotify")?.accounts?.fixture?.health).toMatchObject({ outcome: "ok" });
});

it("latches against an absent enabledAt as empty and clears when one appears", async () => {
  const h = harness();
  h.tokenSource.accessToken.mockRejectedValueOnce(new ReauthoriseError());
  await h.scheduler.tick();
  expect(h.states.get("spotify")?.accounts?.fixture?.health?.latchedEnabledAt).toBe("");
  await new ConnectorScheduler({ ...h.options, connections: [connection()] }).tick();
  expect(h.runner).not.toHaveBeenCalled();
  // Even a UI clock far ahead clears it: no cross-clock ordering is involved.
  await new ConnectorScheduler({
    ...h.options,
    connections: [{ ...connection(), enabledAt: iso(AT + 86_400_000) }],
  }).tick();
  expect(h.runner).toHaveBeenCalledOnce();
});

it("keeps the timestamp rule only for latches written without latchedEnabledAt", () => {
  const latch: ConnectorRunHealth = {
    lastRunStartedAt: iso(),
    lastRunEndedAt: iso(),
    outcome: "needs-reauth",
    counts: { created: 0, updated: 0, unchanged: 0, skipped: 0 },
    consecutiveFailures: 1,
    intervalMinutes: 60,
  };
  const state = { ...legacy, health: latch };
  const at = (enabledAt?: string) =>
    connectorNextRunAt({ ...connection(), ...(enabledAt ? { enabledAt } : {}) }, state, 60, AT);
  expect(at()).toBeUndefined();
  expect(at(iso(AT - 1))).toBeUndefined();
  expect(at(iso(AT + 1))).toBe(0);
  expect(at(iso(AT + 600_000))).toBeUndefined();
  expect(() =>
    connectorState({ ...legacy, health: { ...latch, latchedEnabledAt: "not a date" } }),
  ).toThrow();
  expect(connectorState({ ...legacy, health: { ...latch, latchedEnabledAt: "" } }).health).toEqual({
    ...latch,
    latchedEnabledAt: "",
  });
});

it("stamps enabledAt when setEnabled enables a connection", async () => {
  const h = harness([{ ...connection(), enabled: false }]);
  h.setNow(AT + 5_000);
  await h.scheduler.setEnabled("spotify", "fixture", true);
  expect(h.saveConnection).toHaveBeenCalledWith(
    { connectorId: "spotify", account: "fixture", enabled: true, enabledAt: iso(AT + 5_000) },
    expect.any(AbortSignal),
  );
});

it("checks cancellation between a pending health read and its conditional write even for custom stores", async () => {
  const controller = new AbortController(),
    write = vi.fn();
  let reads = 0;
  const h = harness(undefined, {
    stateStore: () => ({
      read: async () => {
        if (++reads === 2) controller.abort();
        return undefined;
      },
      write,
    }),
  });
  await h.scheduler.tick(controller.signal);
  expect(write).not.toHaveBeenCalled();
  expect(h.saveConnection).not.toHaveBeenCalled();
});

it("drops an ambiguous legacy cursor when several accounts share the connector", async () => {
  const h = harness([{ ...connection(), enabled: false }, connection("spotify", "second")]);
  h.states.set("spotify", legacy);
  await h.scheduler.tick();
  expect(h.runner.mock.calls[0]?.[0].state).toBeUndefined();
  const state = h.states.get("spotify");
  expect(state?.accounts?.fixture).toBeUndefined();
  expect(state?.accounts?.second?.cursor).toBe("new");
  // The legacy root checkpoint stays exactly as the node CLI wrote it.
  expect(state).toMatchObject({
    connectedAt: legacy.connectedAt,
    lastSync: legacy.lastSync,
    cursor: "old",
    lastOutcome: "success",
    counts: legacy.counts,
  });
});

it("migrates a legacy cursor for exactly one connection and never rewrites root checkpoint fields", async () => {
  const h = harness();
  h.states.set("spotify", legacy);
  h.setNow(AT + 3_600_000);
  await h.scheduler.tick();
  expect(h.runner.mock.calls[0]?.[0].state?.cursor).toBe("old");
  expect(h.states.get("spotify")?.accounts?.fixture?.cursor).toBe("new");
  h.setNow(AT + 2 * 3_600_000);
  await h.scheduler.tick();
  expect(h.runner).toHaveBeenCalledTimes(2);
  expect(h.states.get("spotify")).toMatchObject({ cursor: "old", lastSync: legacy.lastSync });
  // A fresh document created by the scheduler carries no root cursor for the legacy CLI.
  const fresh = harness();
  await fresh.scheduler.tick();
  expect(fresh.states.get("spotify")?.cursor).toBeUndefined();
  expect(fresh.states.get("spotify")?.accounts?.fixture?.cursor).toBe("new");
});

it("skips a row whose registry returns another connector's adapter before obtaining a token", async () => {
  const h = harness(undefined, {
    registry: {
      adapterById: () => ({
        ...fixtureAdapter(),
        metadata: { ...fixtureAdapter().metadata, id: "github" },
      }),
    },
  });
  await h.scheduler.tick();
  expect(h.scheduler.list()).toEqual([]);
  expect(h.scheduler.invalid()).toMatchObject([{ index: 0, status: "invalid-config" }]);
  expect(h.tokenSource.accessToken).not.toHaveBeenCalled();
});

it("requires an explicit source transport instead of falling back to ambient fetch", () => {
  expect(() => harness(undefined, { sourceFetch: undefined })).toThrow(
    "source transport is required",
  );
});

describe("adversarial review fixes (CON-A2)", () => {
  it("skips malformed rows individually and still schedules the valid ones", async () => {
    const parsed = parseConnectorConnections(
      [
        connection(),
        { connectorId: "github", account: "x\nsecret", enabled: true },
        { connectorId: "strava", account: "ok", enabled: "yes" },
        null,
        connection("github", "dup"),
        connection("github", "dup"),
        { ...connection("strava"), enabledAt: "not a date" },
      ],
      createRegistry(),
    );
    expect(parsed.connections).toEqual([connection()]);
    expect(parsed.invalid.map((row) => row.index)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(JSON.stringify(parsed.invalid)).not.toContain("secret");
    expect(parsed.invalid[0]).toEqual({
      index: 1,
      connectorId: "github",
      status: "invalid-config",
      errorClass: "invalid-config",
    });
    expect(() => parseConnectorConnections({})).toThrow();
    const h = harness([connection(), { connectorId: "github", enabled: true } as never]);
    await h.scheduler.tick();
    expect(h.runner).toHaveBeenCalledOnce();
  });
  it("reads a state document on a pass only for connections that are due", async () => {
    const reads = vi.fn();
    const states = new Map<string, ConnectorState>();
    const h = harness([connection(), { ...connection("github"), intervalMinutes: 30 }], {
      stateStore: (id) => ({
        read: async () => {
          reads(id);
          return states.get(id);
        },
        write: async (state) => {
          states.set(id, state);
        },
      }),
    });
    await h.scheduler.tick();
    expect(h.runner).toHaveBeenCalledTimes(2);
    reads.mockClear();
    for (const at of [AT + 60_000, AT + 900_000, AT + 1_799_999]) {
      h.setNow(at);
      await h.scheduler.tick();
    }
    expect(reads).not.toHaveBeenCalled();
    h.setNow(AT + 1_800_000);
    await h.scheduler.tick();
    // One read to confirm due-ness and one inside the conditional health update.
    expect(reads.mock.calls.map(([id]) => id)).toEqual(["github", "github"]);
    reads.mockClear();
    // Changed settings reload that connector's snapshot once.
    await h.scheduler.setConnections([
      { ...connection(), intervalMinutes: 120 },
      { ...connection("github"), intervalMinutes: 30 },
    ]);
    await h.scheduler.tick();
    expect(reads.mock.calls.map(([id]) => id)).toEqual(["spotify"]);
  });
  it("treats a future-dated stored attempt as untrusted and runs it on the first tick", async () => {
    const health = (at: number, nextRunAt?: number) => ({
      lastRunStartedAt: iso(at),
      lastRunEndedAt: iso(at),
      outcome: "ok" as const,
      counts: { created: 0, updated: 0, unchanged: 0, skipped: 0 },
      consecutiveFailures: 0,
      intervalMinutes: 60,
      ...(nextRunAt === undefined ? {} : { nextRunAt: iso(nextRunAt) }),
    });
    const far = AT + 365 * 86_400_000;
    const future = { ...legacy, lastSync: iso(far), health: health(far, far + 3_600_000) };
    // Due now at any later instant: the horizon cannot move along with the clock.
    for (const dt of [0, 86_400_000, 7 * 86_400_000, 30 * 86_400_000])
      expect(connectorNextRunAt(connection(), future, 60, AT + dt)).toBe(0);
    expect(connectorNextRunAt(connection(), { ...legacy, lastSync: iso(far) }, 60, AT)).toBe(0);
    expect(
      connectorNextRunAt(
        connection(),
        { ...legacy, health: health(AT, AT + 2 * 86_400_000) },
        60,
        AT,
      ),
    ).toBe(0);
    // Within five minutes ahead, or a next run inside the horizon, is still trusted.
    expect(
      connectorNextRunAt(connection(), { ...legacy, lastSync: iso(AT + 60_000) }, 60, AT),
    ).toBe(AT + 60_000 + 3_600_000);
    expect(
      connectorNextRunAt(
        { ...connection(), intervalMinutes: 2_880 },
        { ...legacy, health: health(AT, AT + 2_880 * 60_000) },
        60,
        AT,
      ),
    ).toBe(AT + 2_880 * 60_000);
    // End to end: a state one year ahead runs on the first tick, then schedules normally.
    const h = harness();
    h.states.set("spotify", { ...legacy, accounts: { fixture: future } });
    await h.scheduler.tick();
    expect(h.runner).toHaveBeenCalledOnce();
    expect(h.states.get("spotify")?.accounts?.fixture?.health).toMatchObject({
      outcome: "ok",
      lastRunEndedAt: iso(AT),
      nextRunAt: iso(AT + 3_600_000),
    });
    h.setNow(AT + 3_600_000 - 1);
    await h.scheduler.tick();
    expect(h.runner).toHaveBeenCalledOnce();
    h.setNow(AT + 3_600_000);
    await h.scheduler.tick();
    expect(h.runner).toHaveBeenCalledTimes(2);
  });
  it("runs a future-dated state as fake time advances through the continuous loop", async () => {
    vi.useFakeTimers({ now: AT });
    try {
      const far = Date.now() + 365 * 86_400_000;
      const runs: number[] = [];
      const h = harness(undefined, {
        now: () => Date.now(),
        sleep: undefined,
        runner: async (o) => {
          runs.push(Date.now());
          return report(o);
        },
      });
      h.states.set("spotify", {
        ...legacy,
        accounts: {
          fixture: {
            ...legacy,
            lastSync: iso(far),
            health: {
              lastRunStartedAt: iso(far),
              lastRunEndedAt: iso(far),
              outcome: "ok",
              counts: { created: 0, updated: 0, unchanged: 0, skipped: 0 },
              consecutiveFailures: 0,
              intervalMinutes: 60,
              nextRunAt: iso(far + 3_600_000),
            },
          },
        },
      });
      const controller = new AbortController();
      const loop = h.scheduler.run(controller.signal);
      await vi.advanceTimersByTimeAsync(10 * 86_400_000);
      controller.abort();
      await vi.advanceTimersByTimeAsync(0);
      await loop;
      expect(runs[0]).toBe(AT);
      // Hourly thereafter for ten days (each within one 30-second poll).
      expect(runs.length).toBeGreaterThanOrEqual(10 * 24 - 5);
    } finally {
      vi.useRealTimers();
    }
  });
  it("distrusts timestamps more than five minutes ahead in health and merges", () => {
    const health = (at: number) => ({
      lastRunStartedAt: iso(at),
      lastRunEndedAt: iso(at),
      outcome: "ok" as const,
      counts: { created: 0, updated: 0, unchanged: 0, skipped: 0 },
      consecutiveFailures: 0,
      intervalMinutes: 60,
    });
    // Future successes are untrusted: health reports stale, not ok.
    expect(connectorHealth({ state: { ...legacy, lastSync: iso(AT + 600_000) } }, AT)).toBe(
      "stale",
    );
    expect(connectorHealth({ state: { ...legacy, lastSync: iso(AT + 60_000) } }, AT)).toBe("ok");
    // A future-stamped peer loses the merge; one within five minutes still wins.
    const mine = { ...legacy, lastSync: iso(AT), cursor: "mine", health: health(AT) };
    const skewed = {
      ...legacy,
      lastSync: iso(AT + 600_000),
      cursor: "skewed",
      health: health(AT + 600_000),
    };
    const close = {
      ...legacy,
      lastSync: iso(AT + 60_000),
      cursor: "close",
      health: health(AT + 60_000),
    };
    expect(mergeAccountState(skewed, mine, { now: AT })).toMatchObject({
      cursor: "mine",
      health: { lastRunEndedAt: iso(AT) },
    });
    expect(mergeAccountState(close, mine, { now: AT }).cursor).toBe("close");
  });
  it("keeps a run's health after a backward clock jump when the stored attempt is its base", () => {
    const attempt = (at: number, outcome: ConnectorRunHealth["outcome"]): ConnectorRunHealth => ({
      lastRunStartedAt: iso(at),
      lastRunEndedAt: iso(at),
      outcome,
      counts: { created: 0, updated: 0, unchanged: 0, skipped: 0 },
      consecutiveFailures: outcome === "ok" ? 0 : 1,
      intervalMinutes: 60,
    });
    const ahead = { ...legacy, health: attempt(AT + 120_000, "ok") };
    const next = { ...legacy, health: attempt(AT + 60_000, "failed") };
    // Unchanged since the snapshot the run started from: the new attempt wins.
    expect(mergeAccountState(ahead, next, { now: AT + 60_000, base: ahead }).health?.outcome).toBe(
      "failed",
    );
    // Without that proof (a concurrent writer), the newer trusted attempt still wins.
    expect(mergeAccountState(ahead, next, { now: AT + 60_000 }).health?.outcome).toBe("ok");
  });
  it("persists a run behind a stored attempt from a faster clock when nobody else wrote", async () => {
    const h = harness();
    const ahead = {
      lastRunStartedAt: iso(AT + 180_000),
      lastRunEndedAt: iso(AT + 180_000),
      outcome: "failed" as const,
      counts: { created: 0, updated: 0, unchanged: 0, skipped: 0 },
      errorClass: "source-or-pod" as const,
      consecutiveFailures: 1,
      intervalMinutes: 60,
      nextRunAt: iso(AT - 1),
    };
    h.states.set("spotify", { ...legacy, accounts: { fixture: { ...legacy, health: ahead } } });
    await h.scheduler.tick();
    expect(h.runner).toHaveBeenCalledOnce();
    expect(h.states.get("spotify")?.accounts?.fixture?.health).toMatchObject({
      outcome: "ok",
      lastRunEndedAt: iso(AT),
    });
  });
  it("uses max(back-off, Retry-After) capped at 24 hours", async () => {
    let retry = 7_200;
    const h = harness(undefined, {
      runner: async () => {
        throw new RateLimitedError("spotify", "https://secret.example", retry);
      },
    });
    await h.scheduler.tick();
    let health = h.states.get("spotify")?.accounts?.fixture?.health;
    expect(Date.parse(health?.nextRunAt ?? "") - AT).toBe(7_200_000);
    retry = 60;
    h.setNow(AT + 7_200_000);
    await h.scheduler.tick();
    health = h.states.get("spotify")?.accounts?.fixture?.health;
    expect(Date.parse(health?.nextRunAt ?? "") - (AT + 7_200_000)).toBe(1_800_000);
    retry = 10 * 86_400;
    h.setNow(AT + 9_000_000);
    await h.scheduler.tick();
    health = h.states.get("spotify")?.accounts?.fixture?.health;
    expect(Date.parse(health?.nextRunAt ?? "") - (AT + 9_000_000)).toBe(MAX_CONNECTOR_BACKOFF_MS);
    expect(JSON.stringify(h.states.get("spotify"))).not.toContain("secret");
  });
  it("latches needs-reauth after two consecutive source 401 outcomes and invalidates the grant", async () => {
    const invalidate = vi.fn(async () => {
      throw new Error("vault private");
    });
    const tokenSource = { accessToken: vi.fn(async () => "synthetic-token"), invalidate };
    const h = harness(undefined, {
      tokenSource,
      runner: async () => {
        throw new IntegrationSyncError("spotify", "private", { status: 401 });
      },
    });
    await h.scheduler.tick();
    expect(h.states.get("spotify")?.accounts?.fixture?.health).toMatchObject({
      outcome: "failed",
      errorClass: "unauthorised",
    });
    expect(invalidate).not.toHaveBeenCalled();
    h.setNow(AT + 900_000);
    await h.scheduler.tick();
    const health = h.states.get("spotify")?.accounts?.fixture?.health;
    expect(health).toMatchObject({ outcome: "needs-reauth", errorClass: "unauthorised" });
    expect(health?.nextRunAt).toBeUndefined();
    expect(invalidate).toHaveBeenCalledWith({ connectorId: "spotify", account: "fixture" });
    expect(h.saveConnection).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false, status: "needs-reauth" }),
      expect.any(AbortSignal),
    );
    expect(h.scheduler.list()[0]).toMatchObject({ enabled: false });
    // A 401 after a non-401 failure is a first strike only.
    const other = harness(undefined, {
      runner: async () => {
        throw new IntegrationSyncError("spotify", "private", { status: 401 });
      },
    });
    other.states.set("spotify", {
      ...legacy,
      accounts: {
        fixture: {
          ...legacy,
          health: {
            lastRunStartedAt: iso(AT - 10),
            lastRunEndedAt: iso(AT - 10),
            outcome: "failed",
            errorClass: "forbidden",
            counts: { created: 0, updated: 0, unchanged: 0, skipped: 0 },
            consecutiveFailures: 1,
            intervalMinutes: 60,
            nextRunAt: iso(AT - 1),
          },
        },
      },
    });
    await other.scheduler.tick();
    expect(other.states.get("spotify")?.accounts?.fixture?.health).toMatchObject({
      outcome: "failed",
      errorClass: "unauthorised",
    });
  });
  it("keeps repeated source 403s (quota, rate limit, allowlist) as backed-off failures", async () => {
    const invalidate = vi.fn();
    const h = harness(undefined, {
      tokenSource: { accessToken: vi.fn(async () => "synthetic-token"), invalidate },
      runner: async () => {
        throw new IntegrationSyncError("spotify", "private", { status: 403 });
      },
    });
    for (let n = 1; n <= 4; n++) {
      await h.scheduler.tick();
      const health = h.states.get("spotify")?.accounts?.fixture?.health;
      expect(health).toMatchObject({
        outcome: "failed",
        errorClass: "forbidden",
        consecutiveFailures: n,
      });
      expect(Date.parse(health?.nextRunAt ?? "") - Date.parse(health?.lastRunEndedAt ?? "")).toBe(
        Math.min(MAX_CONNECTOR_BACKOFF_MS, 900_000 * 2 ** (n - 1)),
      );
      h.setNow(Date.parse(health?.nextRunAt ?? ""));
    }
    expect(invalidate).not.toHaveBeenCalled();
    expect(h.saveConnection).not.toHaveBeenCalled();
    expect(h.scheduler.list()[0]).toMatchObject({ enabled: true });
    // A 401 after 403s is only a first strike.
    const mixed = harness(undefined, {
      tokenSource: { accessToken: vi.fn(async () => "synthetic-token"), invalidate },
      runner: vi
        .fn<(o: RunImportOptions) => Promise<ImportReport>>()
        .mockRejectedValueOnce(new IntegrationSyncError("spotify", "private", { status: 403 }))
        .mockRejectedValueOnce(new IntegrationSyncError("spotify", "private", { status: 401 })),
    });
    await mixed.scheduler.tick();
    mixed.setNow(AT + 900_000);
    await mixed.scheduler.tick();
    expect(mixed.states.get("spotify")?.accounts?.fixture?.health).toMatchObject({
      outcome: "failed",
      errorClass: "unauthorised",
    });
    expect(invalidate).not.toHaveBeenCalled();
  });
  it("skips quietly when the connection was removed mid-run", async () => {
    const onRunError = vi.fn();
    const h = harness(undefined, {
      onRunError,
      tokenSource: {
        accessToken: async () => {
          throw new ReauthoriseError();
        },
      },
      saveConnection: async () => {
        throw new ConnectionRemovedError();
      },
    });
    await h.scheduler.tick();
    expect(onRunError).not.toHaveBeenCalled();
    expect(h.states.get("spotify")?.accounts?.fixture?.health?.outcome).toBe("needs-reauth");
    // Removed from settings while running: health is kept, no settings write is attempted.
    const gate = deferred(),
      entered = deferred();
    const removed = harness(undefined, {
      tokenSource: {
        accessToken: async () => {
          entered.resolve();
          await gate.promise;
          throw new ReauthoriseError();
        },
      },
    });
    const pass = removed.scheduler.tick();
    await entered.promise;
    await removed.scheduler.setConnections([]);
    gate.resolve();
    await pass;
    expect(removed.saveConnection).not.toHaveBeenCalled();
  });
  it("does not let a 6-hour run of A delay B's 15-minute schedule (continuous pool)", async () => {
    vi.useFakeTimers({ now: AT });
    try {
      const starts: Record<string, number[]> = { spotify: [], github: [] };
      let aFinished = false;
      const h = harness(
        [
          { ...connection(), intervalMinutes: 15 },
          { ...connection("github"), intervalMinutes: 15 },
        ],
        {
          now: () => Date.now(),
          sleep: undefined,
          runner: async (o) => {
            const id = o.adapter.metadata.id;
            starts[id]?.push(Date.now());
            if (id === "spotify" && starts.spotify?.length === 1) {
              await new Promise((resolve) => setTimeout(resolve, 6 * 3_600_000));
              aFinished = true;
            }
            return report(o);
          },
        },
      );
      const controller = new AbortController();
      const loop = h.scheduler.run(controller.signal);
      await vi.advanceTimersByTimeAsync(6 * 3_600_000 - 60_000);
      expect(aFinished).toBe(false);
      expect(starts.spotify).toHaveLength(1);
      // B ran every 15 minutes (within one 30-second poll) while A was busy.
      expect(starts.github?.length).toBeGreaterThanOrEqual(23);
      const gaps = (starts.github ?? []).slice(1).map((t, i) => t - (starts.github?.[i] ?? 0));
      expect(Math.max(...gaps)).toBeLessThanOrEqual(900_000 + 30_000);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(aFinished).toBe(true);
      controller.abort();
      await vi.advanceTimersByTimeAsync(0);
      await loop;
    } finally {
      vi.useRealTimers();
    }
  });
  it("drains in-flight workers on shutdown of the continuous loop", async () => {
    const entered = deferred();
    let aborted = false;
    const h = harness(undefined, {
      runner: async (o) => {
        entered.resolve();
        await new Promise<void>((resolve) =>
          o.signal?.addEventListener("abort", () => resolve(), { once: true }),
        );
        aborted = true;
        o.signal?.throwIfAborted();
        return report(o);
      },
      sleep: (_ms, signal) =>
        new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true })),
    });
    const controller = new AbortController();
    const loop = h.scheduler.run(controller.signal);
    await entered.promise;
    controller.abort();
    await loop;
    expect(aborted).toBe(true);
    expect(h.writes).not.toHaveBeenCalled();
  });
});

it("gives a waiting setEnabled priority over new pool claims and lets stop() await it", async () => {
  const gates = [deferred(), deferred()],
    entered = [deferred(), deferred()];
  let calls = 0;
  const h = harness([connection(), connection("spotify", "second")], {
    concurrency: 2,
    runner: async (o) => {
      const i = calls++;
      entered[i]?.resolve();
      await gates[i]?.promise;
      return report(o);
    },
  });
  const order: string[] = [];
  const pass = h.scheduler.tick();
  await entered[0]?.promise;
  // Another account in the same container is due; the waiting owner operation goes first.
  const enabling = h.scheduler.setEnabled("spotify", "fixture", false).then(() => {
    order.push("setEnabled");
  });
  gates[0]?.resolve();
  await enabling;
  order.push(`runs:${calls}`);
  gates[1]?.resolve();
  await pass;
  expect(order).toEqual(["setEnabled", "runs:1"]);
  // stop() also waits for exclusive work that is still pending.
  const slow = deferred();
  const waiting = harness([connection()], {
    saveConnection: async () => {
      await slow.promise;
    },
  });
  let stopped = false;
  const enable = waiting.scheduler.setEnabled("spotify", "fixture", false);
  const stop = waiting.scheduler.stop().then(() => {
    stopped = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(stopped).toBe(false);
  slow.resolve();
  await enable;
  await stop;
  expect(stopped).toBe(true);
});
