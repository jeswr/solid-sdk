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
} from "./scheduler.js";
import {
  connectorState,
  mergeAccountState,
  StateConflictError,
  updateConnectorState,
} from "./state.js";
import { createMemoryPod, TEST_POD_ROOT, TEST_PROFILE_DOC, TEST_WEBID } from "./testing.js";
import type { ConnectorState, IntegrationAdapter, PodWriter } from "./types.js";
import { ReauthoriseError } from "./types.js";
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
    expect(connectorNextRunAt(connection(), legacy)).toBe(AT + 3_600_000);
    expect(connectorNextRunAt(connection(), legacy, 120)).toBe(AT + 7_200_000);
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
    expect(() => harness([connection("netflix")])).toThrow();
    expect(() => harness([connection("unknown")])).toThrow();
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
  it("recovers when the host refreshes a disabled connection to enabled", async () => {
    const h = harness();
    h.tokenSource.accessToken.mockRejectedValueOnce(new ReauthoriseError());
    await h.scheduler.tick();
    await h.scheduler.setConnections([connection()]);
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
    expect(h.states.get("spotify")).toMatchObject({
      cursor: "new",
      health: { outcome: "partial", consecutiveFailures: 0, counts: { skipped: 2 } },
    });
  });
  it.each([
    [new RateLimitedError("spotify", "https://secret.example", 30), "rate-limited"],
    [new IntegrationSyncError("spotify", "private", { status: 401 }), "unauthorised"],
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
      sleep = vi.fn(async (_ms, signal: AbortSignal) => {
        expect(signal.aborted).toBe(false);
        controller.abort();
      });
    const h = harness(undefined, { sleep });
    await h.scheduler.run(controller.signal);
    expect(h.runner).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(30_000, expect.any(AbortSignal));
  });
  it("fails closed on state persistence failures and drains other workers", async () => {
    const gate = deferred(),
      entered = deferred();
    let drained = false;
    const h = harness([connection(), connection("github")], {
      runner: async (o) => {
        if (o.adapter.metadata.id === "github") {
          entered.resolve();
          await gate.promise;
          drained = true;
        }
        return report(o);
      },
      stateStore: () => ({
        read: async () => undefined,
        write: async () => {
          throw new Error("secret");
        },
      }),
    });
    const result = h.scheduler.tick().catch((e) => e);
    await entered.promise;
    gate.resolve();
    expect((await result).message).toBe("Connector scheduling or state persistence failed");
    expect(drained).toBe(true);
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
  await updateConnectorState(store, (current) => mergeAccountState(current, legacy));
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
      ],
      AT,
    ),
  ).toEqual({ ok: 1, stale: 1, failing: 1, "needs-reauth": 1, total: 4 });
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
  await expect(h.scheduler.tick()).rejects.toThrow("state persistence failed");
  expect(h.states.get("spotify")?.health?.outcome).toBe("needs-reauth");
  await new ConnectorScheduler(h.options).tick();
  expect(h.runner).not.toHaveBeenCalled();
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

it("keeps the first account's legacy cursor when a different enabled account migrates state first", async () => {
  const h = harness([{ ...connection(), enabled: false }, connection("spotify", "second")]);
  h.states.set("spotify", legacy);
  await h.scheduler.tick();
  expect(h.runner.mock.calls[0]?.[0].state).toBeUndefined();
  expect(h.states.get("spotify")?.accounts?.fixture?.cursor).toBe("old");
  expect(h.states.get("spotify")?.accounts?.second?.cursor).toBe("new");
});

it("refuses a registry that returns another connector's adapter before obtaining a token", () => {
  expect(() =>
    harness(undefined, {
      registry: {
        adapterById: () => ({
          ...fixtureAdapter(),
          metadata: { ...fixtureAdapter().metadata, id: "github" },
        }),
      },
    }),
  ).toThrow("cannot be scheduled");
});

it("requires an explicit source transport instead of falling back to ambient fetch", () => {
  expect(() => harness(undefined, { sourceFetch: undefined })).toThrow(
    "source transport is required",
  );
});
