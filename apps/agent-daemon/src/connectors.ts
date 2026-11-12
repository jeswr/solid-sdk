// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5

import type { PodAuth } from "@jeswr/pod-auth";
import {
  type ConnectionSaveResult,
  type ConnectorConnection,
  ConnectorScheduler,
  type ConnectorSchedulerOptions,
  type ConnectorStateStore,
  connectorAccountState,
  connectorHealth,
  createConnectionStore,
  createConnectorStateStore,
  createFetchPodWriter,
  createRegistry,
  parseConnectorConnections,
  ReauthoriseError,
  type TokenSource,
} from "@jeswr/pod-connectors";
import { scrubLog } from "./logging.js";

/** CON-A2 / sst-3erb seam. Replace only from a trusted host when the token vault lands. */
export const pendingVaultTokenSource: TokenSource = {
  async accessToken() {
    throw new ReauthoriseError();
  },
};
export interface ConnectorConnectionHealth {
  /** A registry id, or "-" for an invalid row whose id could not be validated. */
  readonly connectorId: string;
  /** An opaque account id, or "-" for an invalid row whose account could not be validated. */
  readonly account: string;
  readonly enabled: boolean;
  readonly health: "ok" | "stale" | "failing" | "needs-reauth" | "invalid-config";
  readonly nextRunAt?: string;
}
export interface ConnectorsJob {
  tick(signal?: AbortSignal): Promise<void>;
  /** Never rejects: failed passes log a fixed message and back off independently. */
  run(signal: AbortSignal): Promise<void>;
  list(signal?: AbortSignal): Promise<readonly ConnectorConnectionHealth[]>;
}
export interface ConnectorsJobOptions {
  readonly podRoot: string;
  readonly webId: string;
  readonly profileDocumentUrl: string;
  readonly podFetch: PodAuth["fetch"];
  /** Explicit pristine source transport. The pending vault stub never uses it. */
  readonly sourceFetch?: PodAuth["fetch"];
  readonly tokenSource?: TokenSource;
  readonly registry?: ConnectorSchedulerOptions["registry"];
  readonly now?: () => number;
  readonly sleep?: ConnectorSchedulerOptions["sleep"];
  readonly log?: (message: string) => void;
  readonly runner?: ConnectorSchedulerOptions["runner"];
}
/** Job poll cadence and its failure back-off: 30 s doubling to 30 min, reset after success. */
export const CONNECTORS_POLL_MS = 30_000;
export const CONNECTORS_MAX_BACKOFF_MS = 30 * 60_000;
export function connectorsPollDelay(failures: number): number {
  if (failures <= 0) return CONNECTORS_POLL_MS;
  return Math.min(CONNECTORS_MAX_BACKOFF_MS, CONNECTORS_POLL_MS * 2 ** Math.min(16, failures - 1));
}
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}
/** Both launchd and cloud hosts use this job under their existing exclusive process lease. */
export function createConnectorsJob(o: ConnectorsJobOptions): ConnectorsJob {
  const registry = o.registry ?? createRegistry();
  const settings = () =>
    createConnectionStore({ podRoot: o.podRoot, webId: o.webId, fetch: o.podFetch });
  // Long-lived stores protect their ACL once; polling uses conditional GETs.
  const poll = settings();
  const updates = settings();
  let saving: Promise<unknown> = Promise.resolve();
  const saveConnection = (
    c: ConnectorConnection,
    signal: AbortSignal,
  ): Promise<ConnectionSaveResult> => {
    // One read→write sequence at a time on the shared settings store. The result reports a
    // needs-reauth disable the owner's newer enabledAt superseded, so the scheduler keeps
    // its in-memory row and the owner's fresh grant.
    const next = saving.then(() => updates.update(c, signal));
    saving = next.catch(() => undefined);
    return next;
  };
  const states = new Map<string, ReturnType<typeof createConnectorStateStore>>();
  const stateStore = (adapterId: string, signal: AbortSignal): ConnectorStateStore => {
    let store = states.get(adapterId);
    if (!store) {
      store = createConnectorStateStore({
        podRoot: o.podRoot,
        adapterId,
        webId: o.webId,
        fetch: o.podFetch,
      });
      states.set(adapterId, store);
    }
    const bound = store;
    return { read: () => bound.read(signal), write: (state) => bound.write(state, signal) };
  };
  let scheduler: ConnectorScheduler | undefined;
  let seen = -1;
  function build(rows: readonly unknown[]) {
    return new ConnectorScheduler({
      connections: rows,
      tokenSource: o.tokenSource ?? pendingVaultTokenSource,
      // No implicit provider traffic: an enabled vault must explicitly supply its transport.
      sourceFetch:
        o.sourceFetch ??
        (async () => {
          throw new Error("Source transport not configured");
        }),
      podWriter: (c, signal) =>
        createFetchPodWriter({
          adapterId: c.connectorId,
          podRoot: o.podRoot,
          webId: o.webId,
          profileDocumentUrl: o.profileDocumentUrl,
          fetch: o.podFetch,
          signal,
        }),
      stateStore,
      saveConnection,
      registry,
      now: o.now,
      sleep: o.sleep,
      runner: o.runner,
      onRunError: () => o.log?.(scrubLog("Connector run failed")),
    });
  }
  /** Conditional GET of the settings; re-parse and refresh the scheduler only on change. */
  async function refresh(signal?: AbortSignal): Promise<ConnectorScheduler> {
    const rows = await poll.read(signal);
    signal?.throwIfAborted();
    if (scheduler && poll.revision === seen) return scheduler;
    if (scheduler) await scheduler.setConnections(rows ?? []);
    else scheduler = build(rows ?? []);
    seen = poll.revision;
    return scheduler;
  }
  let pending: Promise<void> | undefined;
  const tick = (signal?: AbortSignal): Promise<void> => {
    if (pending) return pending;
    if (signal?.aborted) return Promise.resolve();
    pending = (async () => {
      const current = await refresh(signal);
      if (signal?.aborted) return;
      await current.tick(signal);
      if (!signal?.aborted) o.log?.(scrubLog("Connectors pass complete"));
    })()
      .catch((error) => {
        // The caller (the daemon's once mode) logs a fixed failure message and continues.
        if (!signal?.aborted) throw error;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
  return {
    tick,
    async run(signal) {
      let failures = 0;
      try {
        while (!signal.aborted) {
          try {
            (await refresh(signal)).dispatch(signal);
            failures = 0;
          } catch {
            if (signal.aborted) break;
            failures++;
            o.log?.(scrubLog("Connectors pass failed"));
          }
          if (!signal.aborted) await (o.sleep ?? pause)(connectorsPollDelay(failures), signal);
        }
      } finally {
        // Workers observe the same signal; drain them before the host drains its executor.
        await scheduler?.idle();
      }
    },
    /** Read-only: bounded GETs only, never ACL, settings or state writes. */
    async list(signal) {
      const rows = (await settings().peek(signal)) ?? [];
      const { connections, invalid } = parseConnectorConnections(rows, registry);
      const docs = new Map<
        string,
        Awaited<ReturnType<ReturnType<typeof createConnectorStateStore>["peek"]>>
      >();
      const result: ConnectorConnectionHealth[] = [];
      const now = (o.now ?? Date.now)();
      for (const c of connections) {
        if (!docs.has(c.connectorId))
          docs.set(
            c.connectorId,
            await createConnectorStateStore({
              podRoot: o.podRoot,
              adapterId: c.connectorId,
              webId: o.webId,
              fetch: o.podFetch,
            }).peek(signal),
          );
        const sharing =
          connections.filter((other) => other.connectorId === c.connectorId).length +
          invalid.filter((row) => row.connectorId === c.connectorId).length;
        const account = connectorAccountState(docs.get(c.connectorId), c.account, sharing);
        result.push({
          connectorId: c.connectorId,
          account: c.account,
          enabled: c.enabled,
          health: connectorHealth(
            {
              state: account,
              intervalMinutes: c.intervalMinutes,
              status: c.status,
              enabledAt: c.enabledAt,
            },
            now,
          ),
          ...(account?.health?.nextRunAt ? { nextRunAt: account.health.nextRunAt } : {}),
        });
      }
      for (const row of invalid)
        result.push({
          connectorId: row.connectorId ?? "-",
          account: row.account ?? "-",
          enabled: false,
          health: "invalid-config",
        });
      return result;
    },
  };
}
