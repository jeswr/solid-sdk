// AUTHORED-BY Codex GPT-6.1-Sol
import { createRegistry, DEFAULT_CONNECTOR_INTERVAL_MINUTES } from "../registry.js";
import { abortableFetch, unlessAborted } from "./abort.js";
import { IntegrationSyncError, RateLimitedError } from "./errors.js";
import {
  createSourceAuth,
  type ImportReport,
  type RunImportOptions,
  runImport,
} from "./import-runner.js";
import {
  accountId,
  type ConnectorStateStore,
  intervalMinutes,
  MAX_CONNECTIONS,
  mergeAccountState,
  updateConnectorState,
} from "./state.js";
import type {
  ConnectorAccountState,
  ConnectorErrorClass,
  ConnectorRunCounts,
  ConnectorRunHealth,
  ConnectorState,
  IntegrationAdapter,
  PodWriter,
  TokenSource,
} from "./types.js";
import { ReauthoriseError } from "./types.js";

export interface ConnectorConnection {
  readonly connectorId: string;
  /** Opaque host-selected id, not an address, URL or credential reference. */
  readonly account: string;
  readonly intervalMinutes?: number;
  readonly enabled: boolean;
  readonly status?: "needs-reauth";
}
export function connectorConnections(value: unknown): ConnectorConnection[] {
  if (!Array.isArray(value) || value.length > MAX_CONNECTIONS)
    throw new Error("Invalid connector connections");
  const keys = new Set<string>();
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new Error("Invalid connector connection");
    const c = item as Record<string, unknown>;
    if (
      typeof c.connectorId !== "string" ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(c.connectorId) ||
      typeof c.enabled !== "boolean" ||
      (c.status !== undefined && c.status !== "needs-reauth")
    )
      throw new Error("Invalid connector connection");
    const account = accountId(c.account),
      key = JSON.stringify([c.connectorId, account]);
    if (keys.has(key)) throw new Error("Duplicate connector connection");
    keys.add(key);
    return {
      connectorId: c.connectorId,
      account,
      enabled: c.enabled,
      ...(c.intervalMinutes === undefined
        ? {}
        : { intervalMinutes: intervalMinutes(c.intervalMinutes) }),
      ...(c.status === undefined ? {} : { status: "needs-reauth" as const }),
    };
  });
}
export interface ConnectorSchedulerOptions {
  readonly connections: readonly ConnectorConnection[];
  readonly tokenSource: TokenSource;
  /** A pristine source transport, distinct from authenticated Pod fetch. */
  readonly sourceFetch: typeof fetch;
  readonly podWriter: (
    connection: ConnectorConnection,
    signal: AbortSignal,
  ) => PodWriter | Promise<PodWriter>;
  readonly stateStore: (connectorId: string, signal: AbortSignal) => ConnectorStateStore;
  /** Persist only this connection's change, merging host config on conflict. */
  readonly saveConnection: (connection: ConnectorConnection, signal: AbortSignal) => Promise<void>;
  readonly registry?: Pick<ReturnType<typeof createRegistry>, "adapterById">;
  readonly concurrency?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly random?: () => number;
  /** Fixture seam; production always defaults to the shared import runner. */
  readonly runner?: (options: RunImportOptions) => Promise<ImportReport>;
}
export const MAX_CONNECTOR_BACKOFF_MS = 24 * 60 * 60 * 1_000;
const RETRY_MS = 15 * 60 * 1_000;
/** Positive jitter avoids retries below the interval floor, including the first failure. */
export function connectorBackoffMs(failures: number, random: () => number = Math.random): number {
  const n = random();
  const jitter = Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.5;
  return Math.min(
    MAX_CONNECTOR_BACKOFF_MS,
    Math.round(RETRY_MS * 2 ** Math.min(16, Math.max(0, failures - 1)) * (1 + jitter / 4)),
  );
}
export function connectorNextRunAt(
  connection: ConnectorConnection,
  state: ConnectorAccountState | undefined,
  effectiveInterval = DEFAULT_CONNECTOR_INTERVAL_MINUTES,
): number | undefined {
  if (!connection.enabled || connection.status === "needs-reauth") return undefined;
  if (state?.health?.outcome === "needs-reauth" && !state.health.nextRunAt) return undefined;
  if (state?.health?.nextRunAt) {
    const interval = intervalMinutes(connection.intervalMinutes ?? effectiveInterval);
    if (
      (state.health.outcome === "ok" || state.health.outcome === "partial") &&
      interval !== state.health.intervalMinutes
    )
      return Date.parse(state.health.lastRunEndedAt) + interval * 60_000;
    return Date.parse(state.health.nextRunAt);
  }
  const previous = state?.health?.lastRunEndedAt ?? state?.lastSync;
  return previous
    ? Date.parse(previous) +
        intervalMinutes(connection.intervalMinutes ?? effectiveInterval) * 60_000
    : 0;
}
function errorClass(error: unknown, signal: AbortSignal): ConnectorErrorClass {
  if (signal.aborted) return "aborted";
  if (error instanceof ReauthoriseError) return "reauthorise";
  if (error instanceof RateLimitedError) return "rate-limited";
  if (error instanceof IntegrationSyncError) {
    if (error.status === 401 || error.status === 403) return "unauthorised";
    if (error.status === 412) return "conflict";
    return "source-or-pod";
  }
  return "unexpected";
}
const emptyCounts = (): ConnectorRunCounts => ({
  created: 0,
  updated: 0,
  unchanged: 0,
  skipped: 0,
});
function sleep(ms: number, signal: AbortSignal): Promise<void> {
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

/** Host-neutral, bounded scheduler. One worker owns a whole connector container at a time. */
export class ConnectorScheduler {
  private connections: ConnectorConnection[];
  private readonly registry: ConnectorSchedulerOptions["registry"];
  private readonly now: () => number;
  private readonly concurrency: number;
  private readonly lifetime = new AbortController();
  private dispatch: Promise<void> | undefined;
  private loop = false;
  constructor(private readonly options: ConnectorSchedulerOptions) {
    if (typeof options.sourceFetch !== "function")
      throw new Error("A source transport is required");
    this.connections = connectorConnections(options.connections);
    this.registry = options.registry ?? createRegistry();
    this.now = options.now ?? Date.now;
    this.concurrency = options.concurrency ?? 2;
    if (!Number.isSafeInteger(this.concurrency) || this.concurrency < 1 || this.concurrency > 16)
      throw new Error("Invalid connector concurrency");
    for (const c of this.connections) this.adapter(c);
  }
  private adapter(c: ConnectorConnection): IntegrationAdapter {
    const adapter = this.registry?.adapterById(c.connectorId);
    if (adapter?.metadata.authKind !== "oauth-pkce" || adapter.metadata.id !== c.connectorId)
      throw new Error("Connector cannot be scheduled");
    return adapter;
  }
  private interval(c: ConnectorConnection): number {
    return intervalMinutes(
      c.intervalMinutes ??
        this.adapter(c).metadata.defaultIntervalMinutes ??
        DEFAULT_CONNECTOR_INTERVAL_MINUTES,
    );
  }
  private account(
    c: ConnectorConnection,
    state: ConnectorState | undefined,
  ): ConnectorAccountState | undefined {
    if (state?.accounts)
      return Object.hasOwn(state.accounts, c.account) ? state.accounts[c.account] : undefined;
    // Migrate the old account-free checkpoint to the first configured account only.
    return this.connections.find((other) => other.connectorId === c.connectorId)?.account ===
      c.account
      ? state
      : undefined;
  }
  private async execute(c: ConnectorConnection, signal: AbortSignal) {
    if (!c.enabled || c.status === "needs-reauth" || signal.aborted) return;
    const store = this.options.stateStore(c.connectorId, signal);
    const state = await store.read();
    signal.throwIfAborted();
    const previous = this.account(c, state),
      interval = this.interval(c);
    const due = connectorNextRunAt(c, previous, interval);
    if (due === undefined || due > this.now()) return;
    const started = new Date(this.now()).toISOString();
    let checkpoint: ConnectorAccountState = previous ?? {
      connectedAt: started,
      lastOutcome: "error",
      counts: { documents: 0, items: 0, skipped: 0 },
    };
    let counts = emptyCounts();
    let outcome: ConnectorRunHealth["outcome"] = "failed";
    let code: ConnectorErrorClass | undefined;
    try {
      const token = await this.options.tokenSource.accessToken(c.connectorId, c.account);
      signal.throwIfAborted();
      if (!token || token.length > 65_536 || !/^[\x21-\x7e]+$/.test(token))
        throw new Error("Invalid source credential");
      const adapter = this.adapter(c);
      const tokens = { accessToken: token, tokenType: "Bearer" };
      const sourceFetch = abortableFetch(this.options.sourceFetch, signal);
      const sourceAuth =
        adapter.oauth && adapter.createSourceAuth
          ? adapter.createSourceAuth(adapter.oauth, tokens, sourceFetch)
          : createSourceAuth(c.connectorId, adapter, tokens, sourceFetch);
      signal.throwIfAborted();
      const podWriter = await this.options.podWriter(c, signal);
      signal.throwIfAborted();
      const report = await (this.options.runner ?? runImport)({
        adapter,
        mode: "live",
        podWriter,
        sourceAuth,
        state: previous,
        signal,
        onRunCounts: (value) => {
          counts = value;
        },
      });
      signal.throwIfAborted();
      counts = report.counts ?? { ...counts, skipped: report.skipped ?? counts.skipped };
      const ended = new Date(this.now()).toISOString();
      checkpoint = { ...(report.state ?? checkpoint), lastSync: ended, lastOutcome: "success" };
      outcome = counts.skipped > 0 ? "partial" : "ok";
    } catch (error) {
      code = errorClass(error, signal);
      outcome = code === "reauthorise" ? "needs-reauth" : "failed";
      checkpoint = { ...checkpoint, lastOutcome: "error" };
    }
    // Cancellation starts no further Pod/config I/O, matching the runner's abort contract.
    if (signal.aborted) return;
    const ended = new Date(Math.max(this.now(), Date.parse(started))).toISOString();
    const failures =
      outcome === "ok" || outcome === "partial"
        ? 0
        : Math.min(Number.MAX_SAFE_INTEGER, (previous?.health?.consecutiveFailures ?? 0) + 1);
    const health: ConnectorRunHealth = {
      lastRunStartedAt: started,
      lastRunEndedAt: ended,
      outcome,
      counts,
      ...(code ? { errorClass: code } : {}),
      consecutiveFailures: failures,
      intervalMinutes: interval,
      ...(outcome === "needs-reauth"
        ? {}
        : {
            nextRunAt: new Date(
              Date.parse(ended) +
                (failures ? connectorBackoffMs(failures, this.options.random) : interval * 60_000),
            ).toISOString(),
          }),
    };
    if (outcome === "needs-reauth") {
      const disabled: ConnectorConnection = { ...c, enabled: false, status: "needs-reauth" };
      this.connections = this.connections.map((other) =>
        other.connectorId === c.connectorId && other.account === c.account ? disabled : other,
      );
      // Persist health even if the host config write fails; the health latch also fails closed.
      await this.persist(c, { ...checkpoint, health }, signal);
      signal.throwIfAborted();
      await this.options.saveConnection(disabled, signal);
    } else await this.persist(c, { ...checkpoint, health }, signal);
  }
  private persist(c: ConnectorConnection, next: ConnectorAccountState, signal: AbortSignal) {
    const store = this.options.stateStore(c.connectorId, signal);
    const guarded: ConnectorStateStore = {
      read: unlessAborted(signal, () => store.read()),
      write: unlessAborted(signal, (state: ConnectorState) => store.write(state)),
    };
    return updateConnectorState(guarded, (current) => {
      const account = mergeAccountState(this.account(c, current), next);
      const base = mergeAccountState(current, account);
      const accounts = { ...current?.accounts };
      if (current && !current.accounts) {
        const first = this.connections.find((other) => other.connectorId === c.connectorId);
        if (first) accounts[first.account] = current;
      }
      accounts[c.account] = account;
      return { ...base, accounts };
    });
  }
  /** Overlapping ticks join the same pass. All started workers drain before errors surface. */
  tick(signal?: AbortSignal): Promise<void> {
    if (this.dispatch) return this.dispatch;
    const combined = signal
      ? AbortSignal.any([signal, this.lifetime.signal])
      : this.lifetime.signal;
    if (combined.aborted) return Promise.resolve();
    const groups = new Map<string, ConnectorConnection[]>();
    for (const c of this.connections) {
      const group = groups.get(c.connectorId) ?? [];
      group.push(c);
      groups.set(c.connectorId, group);
    }
    const queue = [...groups.values()];
    let index = 0;
    const worker = async () => {
      while (!combined.aborted) {
        const group = queue[index++];
        if (!group) return;
        for (const c of group) {
          if (combined.aborted) return;
          try {
            await this.execute(c, combined);
          } catch (error) {
            if (!combined.aborted) throw error;
          }
        }
      }
    };
    this.dispatch = Promise.allSettled(
      Array.from({ length: Math.min(this.concurrency, queue.length) }, worker),
    )
      .then((results) => {
        const failure = results.find((r) => r.status === "rejected");
        if (failure?.status === "rejected")
          throw new Error("Connector scheduling or state persistence failed");
      })
      .finally(() => {
        this.dispatch = undefined;
      });
    return this.dispatch;
  }
  /** A host may use tick in its own loop, or this cancellable 30-second polling loop. */
  async run(signal: AbortSignal): Promise<void> {
    if (this.loop) throw new Error("Connector scheduler already running");
    this.loop = true;
    const combined = AbortSignal.any([signal, this.lifetime.signal]);
    try {
      while (!combined.aborted) {
        await this.tick(combined);
        if (!combined.aborted) await (this.options.sleep ?? sleep)(30_000, combined);
      }
    } finally {
      this.loop = false;
    }
  }
  async stop(): Promise<void> {
    this.lifetime.abort();
    await this.dispatch;
  }
  list(): readonly ConnectorConnection[] {
    return this.connections.map((c) => ({ ...c }));
  }
  /** Explicit re-enable clears the durable auth latch before enabling host configuration. */
  async setEnabled(
    connectorId: string,
    account: string,
    enabled: boolean,
    signal = this.lifetime.signal,
  ): Promise<void> {
    await this.dispatch;
    signal.throwIfAborted();
    const c = this.connections.find((c) => c.connectorId === connectorId && c.account === account);
    if (!c) throw new Error("Unknown connector connection");
    const next: ConnectorConnection = {
      connectorId,
      account,
      intervalMinutes: c.intervalMinutes,
      enabled,
    };
    if (enabled) {
      const store = this.options.stateStore(connectorId, signal),
        current = await store.read();
      const old = this.account(c, current);
      if (old?.health?.outcome === "needs-reauth")
        await this.persist(
          c,
          { ...old, health: { ...old.health, nextRunAt: new Date(this.now()).toISOString() } },
          signal,
        );
    }
    signal.throwIfAborted();
    await this.options.saveConnection(next, signal);
    this.connections = this.connections.map((other) => (other === c ? next : other));
  }
  /** Refresh host-persisted settings between passes; re-enable transitions clear the latch. */
  async setConnections(
    value: readonly ConnectorConnection[],
    signal = this.lifetime.signal,
  ): Promise<void> {
    const next = connectorConnections(value);
    for (const c of next) this.adapter(c);
    await this.dispatch;
    for (const c of next) {
      const old = this.connections.find(
        (old) => old.connectorId === c.connectorId && old.account === c.account,
      );
      if (old && !old.enabled && c.enabled && c.status !== "needs-reauth")
        await this.setEnabled(c.connectorId, c.account, true, signal);
    }
    this.connections = next;
  }
}
