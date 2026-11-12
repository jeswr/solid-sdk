// AUTHORED-BY Codex GPT-6.1-Sol

import type { PodAuth } from "@jeswr/pod-auth";
import {
  type ConnectorConnection,
  ConnectorScheduler,
  type ConnectorSchedulerOptions,
  connectorHealth,
  createConnectionStore,
  createConnectorStateStore,
  createFetchPodWriter,
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
  readonly connectorId: string;
  readonly account: string;
  readonly enabled: boolean;
  readonly health: "ok" | "stale" | "failing" | "needs-reauth";
  readonly nextRunAt?: string;
}
export interface ConnectorsJob {
  tick(signal?: AbortSignal): Promise<void>;
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
  let scheduler: ConnectorScheduler | undefined;
  let pending: Promise<void> | undefined;
  const connections = (signal?: AbortSignal) =>
    createConnectionStore({ podRoot: o.podRoot, webId: o.webId, fetch: o.podFetch, signal });
  function build(list: readonly ConnectorConnection[]) {
    return new ConnectorScheduler({
      connections: list,
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
      stateStore: (adapterId, signal) =>
        createConnectorStateStore({
          podRoot: o.podRoot,
          adapterId,
          webId: o.webId,
          fetch: o.podFetch,
          signal,
        }),
      saveConnection: (c, signal) => connections(signal).update(c),
      registry: o.registry,
      now: o.now,
      sleep: o.sleep,
      runner: o.runner,
    });
  }
  const tick = (signal?: AbortSignal): Promise<void> => {
    if (pending) return pending;
    if (signal?.aborted) return Promise.resolve();
    pending = (async () => {
      const list = (await connections(signal).read()) ?? [];
      if (signal?.aborted) return;
      if (scheduler) await scheduler.setConnections(list, signal);
      else scheduler = build(list);
      await scheduler.tick(signal);
      if (!signal?.aborted) o.log?.(scrubLog("Connectors pass complete"));
    })()
      .catch((error) => {
        if (!signal?.aborted) {
          o.log?.(scrubLog("Connectors pass failed"));
          throw error;
        }
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
  return {
    tick,
    async run(signal) {
      while (!signal.aborted) {
        await tick(signal);
        if (!signal.aborted) await (o.sleep ?? pause)(30_000, signal);
      }
    },
    async list(signal) {
      const list = (await connections(signal).read()) ?? [];
      const states = new Map<
        string,
        Awaited<ReturnType<ReturnType<typeof createConnectorStateStore>["read"]>>
      >();
      const result: ConnectorConnectionHealth[] = [];
      const seen = new Set<string>();
      for (const c of list) {
        if (!states.has(c.connectorId))
          states.set(
            c.connectorId,
            await createConnectorStateStore({
              podRoot: o.podRoot,
              adapterId: c.connectorId,
              webId: o.webId,
              fetch: o.podFetch,
              signal,
            }).read(),
          );
        const state = states.get(c.connectorId);
        const account = state?.accounts
          ? state.accounts[c.account]
          : seen.has(c.connectorId)
            ? undefined
            : state;
        seen.add(c.connectorId);
        result.push({
          connectorId: c.connectorId,
          account: c.account,
          enabled: c.enabled,
          health: connectorHealth(
            { state: account, intervalMinutes: c.intervalMinutes, status: c.status },
            (o.now ?? Date.now)(),
          ),
          ...(account?.health?.nextRunAt ? { nextRunAt: account.health.nextRunAt } : {}),
        });
      }
      return result;
    },
  };
}
