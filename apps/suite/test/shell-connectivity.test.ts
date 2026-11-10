// AUTHORED-BY Claude Opus 5.5
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ConnectionState,
  createConnectivity,
  MIN_RECONNECTING_MS,
  PING_INTERVAL_MS,
  PROBE_TIMEOUT_MS,
  probeReachable,
  probeTarget,
} from "../src/shell/lib/connectivity";

const timers = {
  setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(online: boolean, answers: boolean[] = []) {
  const probe = vi.fn(async () => answers.shift() ?? true);
  const monitor = createConnectivity({ online, probe, timers });
  const seen: ConnectionState[] = [];
  monitor.subscribe(() => seen.push(monitor.getState()));
  return { monitor, probe, seen };
}

describe("connectivity", () => {
  it("uses the spec's timings", () => {
    expect(PING_INTERVAL_MS).toBe(30_000);
    expect(MIN_RECONNECTING_MS).toBe(1_500);
    expect(PROBE_TIMEOUT_MS).toBe(10_000);
  });

  it("stays quiet while online and ignores a repeated online event", async () => {
    const { monitor, probe, seen } = setup(true);
    expect(monitor.getState()).toBe("online");
    monitor.online();
    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS * 3);
    expect(probe).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
  });

  it("goes offline, then shows Reconnecting… for its minimum before hiding", async () => {
    const { monitor, probe, seen } = setup(true);
    monitor.offline();
    monitor.offline();
    expect(seen).toEqual(["offline"]);
    monitor.online();
    expect(monitor.getState()).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(0);
    expect(probe).toHaveBeenCalledOnce();
    expect(monitor.getState()).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(MIN_RECONNECTING_MS - 1);
    expect(monitor.getState()).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toEqual(["offline", "reconnecting", "online"]);
  });

  it("hides at once when the check itself took longer than the minimum", async () => {
    const monitor = createConnectivity({
      online: false,
      probe: () => new Promise((resolve) => setTimeout(() => resolve(true), 5_000)),
      timers,
    });
    monitor.online();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(monitor.getState()).toBe("online");
  });

  it("returns to offline when the storage does not answer after the browser reconnects", async () => {
    const { monitor, probe, seen } = setup(false, [false, false, true]);
    monitor.online();
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.getState()).toBe("offline");
    // Still offline: a ping every 30 s.
    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(monitor.getState()).toBe("offline");
    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS);
    expect(probe).toHaveBeenCalledTimes(3);
    expect(monitor.getState()).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(MIN_RECONNECTING_MS);
    expect(seen).toEqual(["reconnecting", "offline", "reconnecting", "online"]);
  });

  it("pings every 30 s from an offline start and reconnects when the storage answers", async () => {
    const { monitor, probe } = setup(false, [false, true]);
    expect(monitor.getState()).toBe("offline");
    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS - 1);
    expect(probe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(probe).toHaveBeenCalledOnce();
    expect(monitor.getState()).toBe("offline");
    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS);
    expect(monitor.getState()).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(MIN_RECONNECTING_MS);
    expect(monitor.getState()).toBe("online");
    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS * 2);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("ignores answers that arrive after a newer transition", async () => {
    const answers: ((value: boolean) => void)[] = [];
    const probe = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          answers.push(resolve);
        }),
    );
    const monitor = createConnectivity({ online: false, probe, timers });
    monitor.online();
    monitor.offline();
    answers[0]?.(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.getState()).toBe("offline");
    // A ping is in flight when the browser reports online; the ping's answer is stale.
    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS);
    monitor.online();
    answers[1]?.(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.getState()).toBe("reconnecting");
    answers[2]?.(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.getState()).toBe("offline");
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it("drops a held reconnect when a newer transition happens", async () => {
    const { monitor } = setup(false);
    monitor.online();
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.getState()).toBe("reconnecting");
    monitor.offline();
    await vi.advanceTimersByTimeAsync(MIN_RECONNECTING_MS);
    expect(monitor.getState()).toBe("offline");
  });

  it("guards the hold timer against a superseded attempt", async () => {
    // A custom timer that never cancels lets the stale hold fire: it must not hide the pill.
    const sticky = { ...timers, clearTimeout: () => {} };
    const answers = [true, false];
    const monitor = createConnectivity({
      online: false,
      probe: async () => answers.shift() ?? false,
      timers: sticky,
    });
    monitor.online();
    await vi.advanceTimersByTimeAsync(0);
    monitor.offline();
    monitor.online();
    await vi.advanceTimersByTimeAsync(MIN_RECONNECTING_MS);
    expect(monitor.getState()).toBe("offline");
  });

  it("stops after dispose and lets listeners unsubscribe", async () => {
    const probe = vi.fn(async () => true);
    const monitor = createConnectivity({ online: false, probe, timers });
    const listener = vi.fn();
    const unsubscribe = monitor.subscribe(listener);
    unsubscribe();
    monitor.online();
    expect(listener).not.toHaveBeenCalled();
    monitor.dispose();
    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS * 2);
    expect(monitor.getState()).toBe("reconnecting");
    monitor.online();
    monitor.offline();
    expect(monitor.getState()).toBe("reconnecting");
    expect(probe).toHaveBeenCalledOnce();
    // A disposed monitor with no timer pending disposes cleanly again.
    monitor.dispose();
  });

  it("ignores a ping answer after dispose", async () => {
    const probe = vi.fn(async () => true);
    const monitor = createConnectivity({ online: false, probe, timers });
    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS - 1);
    vi.advanceTimersByTime(1);
    monitor.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(probe).toHaveBeenCalledOnce();
    expect(monitor.getState()).toBe("offline");
  });
});

describe("probe target", () => {
  const origin = "https://suite.example";
  it("pings a network storage at its root", () => {
    expect(
      probeTarget({ kind: "solid", storageUrl: "https://alice.example.org/storage/" }, origin),
    ).toBe("https://alice.example.org/storage/");
    expect(probeTarget({ kind: "extension", storageUrl: "http://localhost:3000/" }, origin)).toBe(
      "http://localhost:3000/",
    );
  });
  it("uses the suite's own origin for the demo storage, no account or an unusable root", () => {
    const fallback = "https://suite.example/icon.svg";
    expect(probeTarget({ kind: "demo", storageUrl: "https://alice.demo.pod/" }, origin)).toBe(
      fallback,
    );
    expect(probeTarget(null, origin)).toBe(fallback);
    expect(probeTarget({ kind: "solid", storageUrl: "not a url" }, origin)).toBe(fallback);
    expect(probeTarget({ kind: "solid", storageUrl: "ftp://example.org/" }, origin)).toBe(fallback);
  });
});

describe("probe", () => {
  it("sends an unauthenticated opaque HEAD and treats any answer as reachable", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 401 }));
    expect(await probeReachable(fetcher, "https://example.org/", timers)).toBe(true);
    expect(fetcher).toHaveBeenCalledWith("https://example.org/", {
      method: "HEAD",
      mode: "no-cors",
      credentials: "omit",
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("treats a network error or a timeout as unreachable", async () => {
    expect(
      await probeReachable(
        async () => {
          throw new TypeError("Failed to fetch");
        },
        "https://example.org/",
        timers,
      ),
    ).toBe(false);
    const hanging = probeReachable(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
      "https://example.org/",
      timers,
      100,
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(await hanging).toBe(false);
  });
});
