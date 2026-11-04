// AUTHORED-BY Claude Opus 5.5
/**
 * Connection state behind the shell's OfflinePill (02-suite-shell §10, 01-§5).
 *
 * - online: the pill is hidden (unless changes are waiting).
 * - offline: the browser reports no network, or the storage did not answer. While offline the
 *   storage root is pinged every 30 s.
 * - reconnecting: the browser came back online (or a ping answered) and the storage is being
 *   checked. It shows for at least `minReconnectingMs` so the pill does not flicker.
 *
 * Pure: the caller supplies the probe and timers, and forwards the browser's online/offline
 * events.
 */

export type ConnectionState = "online" | "offline" | "reconnecting";

export interface ConnectivityTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

export const PING_INTERVAL_MS = 30_000;
export const MIN_RECONNECTING_MS = 1_500;
export const PROBE_TIMEOUT_MS = 10_000;

export interface ConnectivityOptions {
  /** `navigator.onLine` when the monitor starts. */
  online: boolean;
  /** Resolves true when the storage answered at all. Must not reject. */
  probe: () => Promise<boolean>;
  timers: ConnectivityTimers;
  pingIntervalMs?: number;
  minReconnectingMs?: number;
}

export interface Connectivity {
  getState(): ConnectionState;
  subscribe(listener: () => void): () => void;
  /** Forward the browser's `online` event. */
  online(): void;
  /** Forward the browser's `offline` event. */
  offline(): void;
  dispose(): void;
}

export function createConnectivity(options: ConnectivityOptions): Connectivity {
  const { probe, timers } = options;
  const interval = options.pingIntervalMs ?? PING_INTERVAL_MS;
  const minimum = options.minReconnectingMs ?? MIN_RECONNECTING_MS;
  const listeners = new Set<() => void>();
  let state: ConnectionState = options.online ? "online" : "offline";
  let timer: unknown;
  /** Bumped by every transition so late probe results and timers are ignored. */
  let attempt = 0;
  let disposed = false;

  // Every caller changes the state: each transition bumps `attempt`, so a matching attempt
  // means the state is still the one the caller started from.
  const set = (next: ConnectionState) => {
    state = next;
    for (const listener of [...listeners]) listener();
  };
  const clear = () => {
    if (timer === undefined) return;
    timers.clearTimeout(timer);
    timer = undefined;
  };
  const schedule = (callback: () => void, ms: number) => {
    clear();
    timer = timers.setTimeout(() => {
      timer = undefined;
      callback();
    }, ms);
  };
  const goOffline = () => {
    attempt += 1;
    set("offline");
    schedule(ping, interval);
  };
  /** Hold "Reconnecting…" until its minimum has passed, then hide the pill. */
  const finish = (current: number, startedAt: number) => {
    const remaining = startedAt + minimum - timers.now();
    if (remaining <= 0) return set("online");
    schedule(() => {
      if (current === attempt) set("online");
    }, remaining);
  };
  function ping() {
    const current = ++attempt;
    void probe().then((reachable) => {
      if (disposed || current !== attempt) return;
      if (!reachable) return schedule(ping, interval);
      set("reconnecting");
      finish(current, timers.now());
    });
  }
  if (state === "offline") schedule(ping, interval);

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    online() {
      if (disposed || state !== "offline") return;
      clear();
      const current = ++attempt;
      const startedAt = timers.now();
      set("reconnecting");
      void probe().then((reachable) => {
        if (disposed || current !== attempt) return;
        if (reachable) finish(current, startedAt);
        else goOffline();
      });
    },
    offline() {
      if (disposed || state === "offline") return;
      goOffline();
    },
    dispose() {
      disposed = true;
      clear();
      listeners.clear();
    },
  };
}

/**
 * Where to ping. A storage on the network is pinged at its root; the demo storage lives in this
 * browser, so the suite's own origin stands in for "the network is reachable".
 */
export function probeTarget(
  account: { kind: string; storageUrl: string } | null,
  origin: string,
): string {
  const fallback = new URL("/icon.svg", origin).href;
  if (!account || account.kind === "demo") return fallback;
  try {
    const url = new URL(account.storageUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : fallback;
  } catch {
    return fallback;
  }
}

/**
 * An unauthenticated reachability check: any HTTP answer (even 401) means the storage is
 * reachable. No credentials, no cache, opaque so no CORS is needed; aborted after a timeout.
 */
export async function probeReachable(
  fetcher: typeof fetch,
  url: string,
  timers: Pick<ConnectivityTimers, "setTimeout" | "clearTimeout">,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = timers.setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetcher(url, {
      method: "HEAD",
      mode: "no-cors",
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    timers.clearTimeout(timer);
  }
}
