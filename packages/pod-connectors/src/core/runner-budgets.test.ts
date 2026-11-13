// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGithubAdapter } from "../github/adapter.js";
import { createRedditAdapter } from "../reddit/adapter.js";
import { ALL_ADAPTERS } from "../registry.js";
import { createSpotifyAdapter } from "../spotify/adapter.js";
import { createStravaAdapter } from "../strava/adapter.js";
import { RunBudget, type RunLimits } from "./budget.js";
import { getJson } from "./fixture-fetch.js";
import { runImport } from "./import-runner.js";
import { createFetchPodWriter } from "./pod-writer.js";
import {
  createMemoryPod,
  fixtureFetch,
  TEST_POD_ROOT,
  TEST_PROFILE_DOC,
  TEST_WEBID,
} from "./testing.js";
import type { IntegrationAdapter } from "./types.js";

function run(adapter: IntegrationAdapter, limits: Partial<RunLimits> = {}, api?: typeof fetch) {
  const pod = createMemoryPod();
  return runImport({
    adapter,
    mode: "live",
    sourceAuth: { fetch: api ?? fixtureFetch(adapter.metadata.id, adapter.fixtures()) },
    podWriter: createFetchPodWriter({
      adapterId: adapter.metadata.id,
      webId: TEST_WEBID,
      profileDocumentUrl: TEST_PROFILE_DOC,
      podRoot: TEST_POD_ROOT,
      fetch: pod.fetch,
    }),
    limits,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Count fixture rows independently of adapter budget calls, so a missing final items() fails. */
function records(id: string, url: string, body: unknown): number {
  const get = (object: unknown, key: string): unknown =>
    object && typeof object === "object" ? (object as Record<string, unknown>)[key] : undefined;
  const value = body as Record<string, unknown>;
  const length = (array: unknown) => (Array.isArray(array) ? array.length : 0);
  const path = new URL(url).pathname;
  if (id === "gmail") {
    if (path.endsWith("/profile")) return 1;
    if (path.endsWith("/labels")) return length(value.labels);
    if (path.endsWith("/messages") || path.includes("/threads/")) return length(value.messages);
    return 0; // raw is the same listed message, not an additional item
  }
  if (id === "github") return path === "/user" ? 1 : Array.isArray(body) ? body.length : 1;
  if (id === "discord") return path.endsWith("/users/@me") ? 1 : length(body);
  if (id === "reddit") return path === "/api/v1/me" ? 1 : length(get(value.data, "children"));
  if (id === "slack") return path.endsWith("/auth.test") ? 1 : length(value.channels);
  if (id === "spotify")
    return path === "/v1/me" ? 1 : length(value.items ?? get(value.artists, "items"));
  if (id === "google-drive") return length(value.files ?? value.changes);
  if (["strava", "garmin"].includes(id)) return length(body);
  const fields: Record<string, string> = {
    dropbox: "entries",
    facebook: "data",
    fitbit: "activities",
    "google-calendar": "items",
    "google-contacts": "connections",
    "google-photos": "mediaItems",
    instagram: "data",
    linkedin: "elements",
    notion: "results",
    pinterest: "items",
    twitch: "data",
    "x-twitter": "data",
    youtube: "items",
  };
  if (id === "tiktok") return length(get(value.data, "videos"));
  const field = fields[id];
  if (!field) throw new Error(`Missing record audit for ${id}`);
  return length(value[field]);
}

// AbortSignal.timeout uses native timers in Node. Put that same API on the fake clock.
function fakeClock() {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
    return controller.signal;
  });
}

describe.each(
  ALL_ADAPTERS.map((adapter) => ({ adapter, id: adapter.metadata.id })),
)("$id complete fixture budget", ({ adapter }) => {
  it("enforces the final request, item and byte, accepting exactly the measured totals", async () => {
    let requests = 0;
    let bytes = 0;
    let items = 0;
    let chargedItems = 0;
    const charge = RunBudget.prototype.items;
    vi.spyOn(RunBudget.prototype, "items").mockImplementation(function (this: RunBudget, n) {
      chargedItems += n;
      return charge.call(this, n);
    });
    const fixture = fixtureFetch(adapter.metadata.id, adapter.fixtures());
    await run(adapter, {}, async (input, init) => {
      const response = await fixture(input, init);
      requests++;
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      items += records(adapter.metadata.id, String(input), await response.clone().json());
      bytes += (await response.clone().arrayBuffer()).byteLength;
      return response;
    });
    vi.restoreAllMocks();
    expect(requests).toBeGreaterThan(0);
    expect(items).toBeGreaterThan(0);
    expect(chargedItems).toBe(items);
    expect(bytes).toBeGreaterThan(0);
    const exact = { maxRequests: requests, maxItems: items, maxBytes: bytes };
    for (const [key, resource] of [
      ["maxRequests", "requests"],
      ["maxItems", "items"],
      ["maxBytes", "bytes"],
    ] as const) {
      await expect(run(adapter, { ...exact, [key]: exact[key] - 1 })).rejects.toMatchObject({
        name: "RunBudgetExceededError",
        resource,
      });
    }
    await expect(run(adapter, exact)).resolves.toMatchObject({ adapterId: adapter.metadata.id });
  });
  it.each(["headers", "body", "trickle"])("aborts a stalled %s response", async (phase) => {
    fakeClock();
    let signal: AbortSignal | null | undefined;
    const cancel = vi.fn();
    const pending = run(adapter, {}, async (_input, init) => {
      signal = init?.signal;
      if (phase === "headers") return new Promise<Response>(() => {});
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(" "));
            if (phase === "trickle") {
              const timer = setInterval(() => controller.enqueue(new Uint8Array([32])), 1000);
              cancel.mockImplementation(() => clearInterval(timer));
            }
          },
          cancel,
        }),
      );
    });
    const settled = vi.fn();
    pending.then(settled, settled);
    // An endless trickle hits the finite size-scaled body deadline; idle/header stalls hit 60 s.
    await vi.advanceTimersByTimeAsync(phase === "trickle" ? 188_001 : 60_001);
    expect(signal?.aborted).toBe(true);
    expect(settled).toHaveBeenCalledOnce();
    if (phase !== "headers") expect(cancel).toHaveBeenCalledOnce();
    await expect(pending).rejects.toMatchObject({ name: "IntegrationSyncError" });
  });
  it("enforces the total deadline even while the upstream returns bytes", async () => {
    fakeClock();
    const pending = run(
      adapter,
      { maxDurationMs: 10 },
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([32]));
            },
          }),
        ),
    );
    const settled = vi.fn();
    pending.then(settled, settled);
    await vi.advanceTimersByTimeAsync(11);
    expect(settled).toHaveBeenCalledOnce();
    await expect(pending).rejects.toMatchObject({
      name: "RunBudgetExceededError",
      resource: "duration",
    });
  });
});

it("charges raw ctx.api calls without helper opt-in", async () => {
  const original = ALL_ADAPTERS[0];
  if (!original) throw new Error("Missing fixture");
  const adapter: IntegrationAdapter = {
    ...original,
    async import(ctx) {
      await (await ctx.api("https://api.test/raw")).arrayBuffer();
      return {};
    },
  };
  await expect(
    run(adapter, { maxRequests: 0 }, async () => new Response("ok")),
  ).rejects.toMatchObject({ resource: "requests" });
  await expect(run(adapter, { maxBytes: 1 }, async () => new Response("ok"))).rejects.toMatchObject(
    { resource: "bytes" },
  );
});

it.each([
  createGithubAdapter,
  createRedditAdapter,
  createSpotifyAdapter,
  createStravaAdapter,
])("keeps the stricter factory allowance and ignores undefined host fields", async (factory) => {
  for (const [key, resource] of [
    ["maxRequests", "requests"],
    ["maxItems", "items"],
    ["maxBytes", "bytes"],
    ["maxDurationMs", "duration"],
  ] as const) {
    const limits = {
      maxRequests: 1000,
      maxItems: 1000,
      maxBytes: 1_000_000,
      maxDurationMs: 1_000_000,
      [key]: 0,
    };
    const adapter = factory(limits);
    for (const value of [undefined, 1000])
      await expect(run(adapter, { [key]: value })).rejects.toMatchObject({ resource, limit: 0 });
  }
});

it.each([404, 410, 429])("keeps HTTP %s when cancellation throws", async (status) => {
  const api: typeof fetch = async () =>
    new Response(
      new ReadableStream({
        cancel() {
          throw new Error("cancel failed");
        },
      }),
      { status },
    );
  await expect(getJson("x", api, "https://api.test")).rejects.toMatchObject({
    status,
    name: status === 429 ? "RateLimitedError" : "IntegrationSyncError",
  });
});

it("makes request() fail after the wall-clock deadline", () => {
  vi.useFakeTimers();
  const budget = new RunBudget("x", { maxDurationMs: 10 });
  vi.advanceTimersByTime(10);
  expect(() => budget.request()).toThrow(expect.objectContaining({ resource: "duration" }));
});

it("preserves caller cancellation if it lands during duration-failure cleanup", async () => {
  fakeClock();
  const controller = new AbortController();
  const reason = new Error("Caller cancelled during cleanup");
  const original = ALL_ADAPTERS[0];
  if (!original) throw new Error("Missing fixture");
  const pod = createMemoryPod();
  const pending = runImport({
    adapter: {
      ...original,
      async import(ctx) {
        try {
          await ctx.api("https://api.test/stalled");
        } catch (error) {
          controller.abort(reason);
          throw error;
        }
        return {};
      },
    },
    mode: "live",
    signal: controller.signal,
    limits: { maxDurationMs: 10 },
    sourceAuth: { fetch: async () => new Promise<Response>(() => {}) },
    podWriter: createFetchPodWriter({
      adapterId: original.metadata.id,
      webId: TEST_WEBID,
      profileDocumentUrl: TEST_PROFILE_DOC,
      podRoot: TEST_POD_ROOT,
      fetch: pod.fetch,
    }),
  });
  const outcome = pending.catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(11);
  expect(await outcome).toBe(reason);
  expect(pod.urls().some((url) => url.endsWith("_provenance.ttl"))).toBe(false);
});

describe("deadline after the adapter resolves", () => {
  const original = ALL_ADAPTERS[0];
  if (!original) throw new Error("Missing fixture");
  const writer = (pod: ReturnType<typeof createMemoryPod>) =>
    createFetchPodWriter({
      adapterId: original.metadata.id,
      webId: TEST_WEBID,
      profileDocumentUrl: TEST_PROFILE_DOC,
      podRoot: TEST_POD_ROOT,
      fetch: pod.fetch,
    });

  it("still reports success, then runs commit after onState", async () => {
    fakeClock();
    const pod = createMemoryPod();
    const order: string[] = [];
    const report = await runImport({
      adapter: {
        ...original,
        async import(ctx) {
          await vi.advanceTimersByTimeAsync(20);
          // Progress reports no longer fail on the deadline, only on caller cancellation.
          ctx.progress({ label: "Done", done: 1 });
          return {
            cursor: "next",
            commit: async () => {
              order.push("commit");
            },
          };
        },
      },
      mode: "live",
      limits: { maxDurationMs: 10 },
      sourceAuth: { fetch: async () => new Response("{}") },
      podWriter: writer(pod),
      onState: () => order.push("state"),
    });
    expect(report.cursor).toBe("next");
    expect(order).toEqual(["state", "commit"]);
    expect(pod.urls().some((url) => url.endsWith("_provenance.ttl"))).toBe(true);
  });

  it("ignores a failing commit and still runs commit when the cancel follows onState", async () => {
    const pod = createMemoryPod();
    const controller = new AbortController();
    const report = await runImport({
      adapter: {
        ...original,
        async import() {
          return { cursor: "next", commit: async () => Promise.reject(new Error("storage down")) };
        },
      },
      mode: "live",
      sourceAuth: { fetch: async () => new Response("{}") },
      podWriter: writer(pod),
    });
    expect(report.cursor).toBe("next");
    const commit = vi.fn();
    await expect(
      runImport({
        adapter: {
          ...original,
          async import() {
            return { cursor: "next", commit };
          },
        },
        mode: "live",
        signal: controller.signal,
        sourceAuth: { fetch: async () => new Response("{}") },
        podWriter: writer(pod),
        onProgress: () => undefined,
        onState: (state) => {
          if (state.lastOutcome === "success") controller.abort(new Error("late cancel"));
        },
      }),
    ).resolves.toMatchObject({ cursor: "next" });
    // The cancel landed after the run was committed: commit still runs, though any Pod I/O in it is refused.
    expect(commit).toHaveBeenCalledOnce();
  });

  it("fails as cancelled when the caller cancels before the state is reported", async () => {
    const pod = createMemoryPod();
    const controller = new AbortController();
    const commit = vi.fn();
    const reason = new Error("cancel during registration");
    const podWriter = writer(pod);
    const register = podWriter.registerType.bind(podWriter);
    podWriter.registerType = async (requests) => {
      const result = await register(requests);
      controller.abort(reason);
      return result;
    };
    await expect(
      runImport({
        adapter: {
          ...original,
          async import() {
            return { cursor: "next", commit };
          },
        },
        mode: "live",
        signal: controller.signal,
        sourceAuth: { fetch: async () => new Response("{}") },
        podWriter,
      }),
    ).rejects.toBe(reason);
    expect(commit).not.toHaveBeenCalled();
  });
});
