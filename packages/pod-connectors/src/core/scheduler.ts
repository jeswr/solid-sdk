// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { createRegistry, DEFAULT_CONNECTOR_INTERVAL_MINUTES } from "../registry.js";
import { abortableFetch, unlessAborted } from "./abort.js";
import { IntegrationSyncError, RateLimitedError } from "./errors.js";
import { connectorReenabled } from "./health.js";
import {
  createSourceAuth,
  type ImportReport,
  type RunImportOptions,
  runImport,
} from "./import-runner.js";
import {
  accountId,
  type ConnectorStateStore,
  connectorAccountState,
  intervalMinutes,
  MAX_CONNECTIONS,
  mergeAccountState,
  trustedTime,
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
import { ConnectionRemovedError, ReauthoriseError } from "./types.js";

export interface ConnectorConnection {
  readonly connectorId: string;
  /** Opaque host-selected id, not an address, URL or credential reference. */
  readonly account: string;
  readonly intervalMinutes?: number;
  readonly enabled: boolean;
  readonly status?: "needs-reauth";
  /**
   * ISO instant of the owner's latest enablement. Writers set it whenever they enable a
   * connection; a value newer than a needs-reauth latch clears that latch in any process.
   */
  readonly enabledAt?: string;
}
/** A settings row the scheduler skipped. Only syntactically valid ids are echoed. */
export interface InvalidConnectorConnection {
  /** Position in the settings array. */
  readonly index: number;
  readonly connectorId?: string;
  readonly account?: string;
  readonly status: "invalid-config";
  readonly errorClass: "invalid-config";
}
export interface ParsedConnectorConnections {
  readonly connections: ConnectorConnection[];
  readonly invalid: InvalidConnectorConnection[];
}
type Registry = Pick<ReturnType<typeof createRegistry>, "adapterById">;

const CONNECTOR_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const key = (c: { readonly connectorId: string; readonly account: string }) =>
  JSON.stringify([c.connectorId, c.account]);
function enabledAt(value: unknown): string {
  if (typeof value !== "string" || value.length > 64 || !Number.isFinite(Date.parse(value)))
    throw new Error("Invalid connector enabledAt");
  return new Date(value).toISOString();
}
function connectionRow(item: unknown): ConnectorConnection {
  if (!item || typeof item !== "object" || Array.isArray(item))
    throw new Error("Invalid connector connection");
  const c = item as Record<string, unknown>;
  if (
    typeof c.connectorId !== "string" ||
    !CONNECTOR_ID.test(c.connectorId) ||
    typeof c.enabled !== "boolean" ||
    (c.status !== undefined && c.status !== "needs-reauth")
  )
    throw new Error("Invalid connector connection");
  return {
    connectorId: c.connectorId,
    account: accountId(c.account),
    enabled: c.enabled,
    ...(c.intervalMinutes === undefined
      ? {}
      : { intervalMinutes: intervalMinutes(c.intervalMinutes) }),
    ...(c.status === undefined ? {} : { status: "needs-reauth" as const }),
    ...(c.enabledAt === undefined ? {} : { enabledAt: enabledAt(c.enabledAt) }),
  };
}
function schedulable(registry: Registry, c: ConnectorConnection): IntegrationAdapter | undefined {
  const adapter = registry.adapterById(c.connectorId);
  return adapter?.metadata.authKind === "oauth-pkce" && adapter.metadata.id === c.connectorId
    ? adapter
    : undefined;
}
/**
 * Tolerant projection: each malformed, duplicated (every copy) or, with a registry,
 * unschedulable row is reported as `invalid-config` and skipped individually. Only a
 * non-array or more than 1,000 rows rejects the whole document.
 */
export function parseConnectorConnections(
  value: unknown,
  registry?: Registry,
): ParsedConnectorConnections {
  if (!Array.isArray(value) || value.length > MAX_CONNECTIONS)
    throw new Error("Invalid connector connections");
  const rows = value.map((item: unknown, index) => {
    try {
      const connection = connectionRow(item);
      return registry && !schedulable(registry, connection)
        ? { index, connectorId: connection.connectorId, account: connection.account }
        : { index, connection };
    } catch {
      const raw = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      let account: string | undefined;
      try {
        account = accountId(raw.account);
      } catch {
        account = undefined;
      }
      return {
        index,
        ...(typeof raw.connectorId === "string" && CONNECTOR_ID.test(raw.connectorId)
          ? { connectorId: raw.connectorId }
          : {}),
        ...(account === undefined ? {} : { account }),
      };
    }
  });
  const seen = new Map<string, number>();
  for (const row of rows)
    if ("connection" in row && row.connection) {
      const k = key(row.connection);
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
  const connections: ConnectorConnection[] = [];
  const invalid: InvalidConnectorConnection[] = [];
  for (const row of rows) {
    if ("connection" in row && row.connection && seen.get(key(row.connection)) === 1)
      connections.push(row.connection);
    else {
      const { connectorId, account } =
        "connection" in row && row.connection
          ? row.connection
          : (row as Partial<ConnectorConnection>);
      invalid.push({
        index: row.index,
        ...(connectorId === undefined ? {} : { connectorId }),
        ...(account === undefined ? {} : { account }),
        status: "invalid-config",
        errorClass: "invalid-config",
      });
    }
  }
  return { connections, invalid };
}
/** Strict variant for host-authored values: any invalid or duplicate row throws. */
export function connectorConnections(value: unknown): ConnectorConnection[] {
  const { connections, invalid } = parseConnectorConnections(value);
  if (invalid.length) throw new Error("Invalid connector connection");
  return connections;
}
export interface ConnectorSchedulerOptions {
  /** Settings rows; invalid or unschedulable rows are skipped and reported by `invalid()`. */
  readonly connections: readonly ConnectorConnection[] | readonly unknown[];
  readonly tokenSource: TokenSource;
  /** A pristine source transport, distinct from authenticated Pod fetch. */
  readonly sourceFetch: typeof fetch;
  readonly podWriter: (
    connection: ConnectorConnection,
    signal: AbortSignal,
  ) => PodWriter | Promise<PodWriter>;
  readonly stateStore: (connectorId: string, signal: AbortSignal) => ConnectorStateStore;
  /**
   * Persist only this connection's change, merging host config on conflict. Throw
   * ConnectionRemovedError when the row no longer exists; the scheduler skips quietly.
   */
  readonly saveConnection: (connection: ConnectorConnection, signal: AbortSignal) => Promise<void>;
  readonly registry?: Registry;
  readonly concurrency?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly random?: () => number;
  /**
   * Called with a fixed error class when a connection's run fails outside the import
   * (state/settings persistence); that connection alone backs off.
   */
  readonly onRunError?: (connection: ConnectorConnection, errorClass: ConnectorErrorClass) => void;
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
/**
 * Due instant in epoch ms (0 = now), or undefined when disabled/latched. Results are
 * clamped to at most `now + max(interval, 24 h)` so a skewed stored time cannot park a
 * connection indefinitely.
 */
export function connectorNextRunAt(
  connection: ConnectorConnection,
  state: ConnectorAccountState | undefined,
  effectiveInterval = DEFAULT_CONNECTOR_INTERVAL_MINUTES,
  now: number = Date.now(),
): number | undefined {
  if (!connection.enabled || connection.status === "needs-reauth") return undefined;
  const interval = intervalMinutes(connection.intervalMinutes ?? effectiveInterval);
  const horizon = now + Math.max(interval * 60_000, MAX_CONNECTOR_BACKOFF_MS);
  const clamp = (at: number) => Math.min(at, horizon);
  const health = state?.health;
  if (health?.outcome === "needs-reauth" && !health.nextRunAt)
    return connectorReenabled(connection.enabledAt, health, now) ? 0 : undefined;
  if (health?.nextRunAt) {
    if (
      (health.outcome === "ok" || health.outcome === "partial") &&
      interval !== health.intervalMinutes
    )
      return clamp(Date.parse(health.lastRunEndedAt) + interval * 60_000);
    return clamp(Date.parse(health.nextRunAt));
  }
  const previous = health?.lastRunEndedAt ?? state?.lastSync;
  return previous ? clamp(Date.parse(previous) + interval * 60_000) : 0;
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

/**
 * Host-neutral, bounded scheduler: a continuous worker pool (default cap 2) that starts
 * the next due connection whenever a worker frees up. Single-flight per connection; one
 * worker owns a whole connector container at a time.
 */
export class ConnectorScheduler {
  private connections: ConnectorConnection[] = [];
  private invalidRows: InvalidConnectorConnection[] = [];
  private readonly registry: Registry;
  private readonly now: () => number;
  private readonly concurrency: number;
  private readonly lifetime = new AbortController();
  /** Cached state per connector container; absent means not yet loaded. */
  private readonly snapshots = new Map<string, ConnectorState | undefined>();
  private readonly running = new Map<string, Promise<void>>();
  private readonly containers = new Map<string, Promise<void>>();
  /** In-memory back-off for runs that failed outside the import (e.g. persistence). */
  private readonly faults = new Map<string, { failures: number; retryAt: number }>();
  /** Set by dispatch for host poll loops; a tick temporarily takes precedence. */
  private dispatchSignal: AbortSignal | undefined;
  private dispatchSource: AbortSignal | undefined;
  private tickSignal: AbortSignal | undefined;
  private ticking: Promise<void> | undefined;
  private tickStarted: Set<string> | undefined;
  private loop = false;
  constructor(private readonly options: ConnectorSchedulerOptions) {
    if (typeof options.sourceFetch !== "function")
      throw new Error("A source transport is required");
    this.registry = options.registry ?? createRegistry();
    this.now = options.now ?? Date.now;
    this.concurrency = options.concurrency ?? 2;
    if (!Number.isSafeInteger(this.concurrency) || this.concurrency < 1 || this.concurrency > 16)
      throw new Error("Invalid connector concurrency");
    this.apply(options.connections);
  }
  private apply(value: unknown) {
    const parsed = parseConnectorConnections(value, this.registry);
    this.connections = parsed.connections;
    this.invalidRows = parsed.invalid;
  }
  private adapter(c: ConnectorConnection): IntegrationAdapter {
    const adapter = schedulable(this.registry, c);
    if (!adapter) throw new Error("Connector cannot be scheduled");
    return adapter;
  }
  private interval(c: ConnectorConnection): number {
    return intervalMinutes(
      c.intervalMinutes ??
        this.adapter(c).metadata.defaultIntervalMinutes ??
        DEFAULT_CONNECTOR_INTERVAL_MINUTES,
    );
  }
  private find(c: ConnectorConnection): ConnectorConnection | undefined {
    return this.connections.find(
      (other) => other.connectorId === c.connectorId && other.account === c.account,
    );
  }
  private account(
    c: ConnectorConnection,
    state: ConnectorState | undefined,
  ): ConnectorAccountState | undefined {
    const sharing =
      this.connections.filter((other) => other.connectorId === c.connectorId).length +
      this.invalidRows.filter((row) => row.connectorId === c.connectorId).length;
    return connectorAccountState(state, c.account, sharing);
  }
  private dueAt(c: ConnectorConnection, now: number): number | undefined {
    if (!c.enabled || c.status === "needs-reauth") return undefined;
    const fault = this.faults.get(key(c));
    let due: number | undefined;
    if (!this.snapshots.has(c.connectorId)) due = 0;
    else {
      try {
        due = connectorNextRunAt(
          c,
          this.account(c, this.snapshots.get(c.connectorId)),
          this.interval(c),
          now,
        );
      } catch {
        due = undefined;
      }
    }
    if (due === undefined) return undefined;
    return fault ? Math.max(due, fault.retryAt) : due;
  }
  private next(now: number): ConnectorConnection | undefined {
    let best: ConnectorConnection | undefined;
    let bestAt = Number.POSITIVE_INFINITY;
    for (const c of this.connections) {
      const k = key(c);
      if (this.running.has(k) || this.containers.has(c.connectorId) || this.tickStarted?.has(k))
        continue;
      const at = this.dueAt(c, now);
      if (at !== undefined && at <= now && at < bestAt) {
        best = c;
        bestAt = at;
      }
    }
    return best;
  }
  private pump() {
    const signal = this.tickSignal ?? this.dispatchSignal;
    while (signal && !signal.aborted && this.running.size < this.concurrency) {
      const c = this.next(this.now());
      if (!c) return;
      this.start(c, signal);
    }
  }
  private start(c: ConnectorConnection, signal: AbortSignal) {
    const k = key(c);
    this.tickStarted?.add(k);
    const task: Promise<void> = this.execute(c, signal)
      .then(
        (ran) => {
          if (ran) this.faults.delete(k);
        },
        (error: unknown) => {
          if (!signal.aborted) this.fault(c, error, signal);
        },
      )
      .finally(() => {
        this.running.delete(k);
        if (this.containers.get(c.connectorId) === task) this.containers.delete(c.connectorId);
        this.pump();
      });
    this.running.set(k, task);
    this.containers.set(c.connectorId, task);
  }
  private fault(c: ConnectorConnection, error: unknown, signal: AbortSignal) {
    const k = key(c);
    const failures = Math.min(1_000, (this.faults.get(k)?.failures ?? 0) + 1);
    this.faults.set(k, {
      failures,
      retryAt: this.now() + connectorBackoffMs(failures, this.options.random),
    });
    try {
      this.options.onRunError?.(c, errorClass(error, signal));
    } catch {
      // Observers never change scheduling.
    }
  }
  private async execute(c: ConnectorConnection, signal: AbortSignal): Promise<boolean> {
    if (!c.enabled || c.status === "needs-reauth" || signal.aborted) return false;
    const store = this.options.stateStore(c.connectorId, signal);
    const state = await store.read();
    signal.throwIfAborted();
    this.snapshots.set(c.connectorId, state);
    const previous = this.account(c, state),
      interval = this.interval(c);
    const due = connectorNextRunAt(c, previous, interval, this.now());
    if (due === undefined || due > this.now()) return false;
    const started = new Date(this.now()).toISOString();
    let checkpoint: ConnectorAccountState = previous ?? {
      connectedAt: started,
      lastOutcome: "error",
      counts: { documents: 0, items: 0, skipped: 0 },
    };
    let counts = emptyCounts();
    let outcome: ConnectorRunHealth["outcome"] = "failed";
    let code: ConnectorErrorClass | undefined;
    let retryAfterMs = 0;
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
      if (error instanceof RateLimitedError) {
        const seconds = error.retryAfterSeconds;
        if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0)
          retryAfterMs = Math.min(MAX_CONNECTOR_BACKOFF_MS, seconds * 1_000);
      }
      // A second consecutive source 401/403 is treated like a revoked grant.
      const unauthorisedAgain =
        code === "unauthorised" &&
        previous?.health?.outcome === "failed" &&
        previous.health.errorClass === "unauthorised";
      outcome = code === "reauthorise" || unauthorisedAgain ? "needs-reauth" : "failed";
      checkpoint = { ...checkpoint, lastOutcome: "error" };
    }
    // Cancellation starts no further Pod/config I/O, matching the runner's abort contract.
    if (signal.aborted) return false;
    const ended = new Date(Math.max(this.now(), Date.parse(started))).toISOString();
    const failures =
      outcome === "ok" || outcome === "partial"
        ? 0
        : Math.min(Number.MAX_SAFE_INTEGER, (previous?.health?.consecutiveFailures ?? 0) + 1);
    const delay = failures
      ? Math.min(
          MAX_CONNECTOR_BACKOFF_MS,
          Math.max(connectorBackoffMs(failures, this.options.random), retryAfterMs),
        )
      : interval * 60_000;
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
        : { nextRunAt: new Date(Date.parse(ended) + delay).toISOString() }),
    };
    if (outcome !== "needs-reauth") {
      await this.persist(c, { ...checkpoint, health }, previous, signal);
      return true;
    }
    const disabled: ConnectorConnection = { ...c, enabled: false, status: "needs-reauth" };
    const configured = this.find(c) !== undefined;
    this.connections = this.connections.map((other) =>
      other.connectorId === c.connectorId && other.account === c.account ? disabled : other,
    );
    // Persist health even if the host config write fails; the health latch also fails closed.
    await this.persist(c, { ...checkpoint, health }, previous, signal);
    if (code === "unauthorised" && this.options.tokenSource.invalidate) {
      try {
        await this.options.tokenSource.invalidate({
          connectorId: c.connectorId,
          account: c.account,
        });
      } catch {
        // Best effort: the durable latch already blocks further source traffic.
      }
    }
    signal.throwIfAborted();
    if (!configured) return true;
    try {
      await this.options.saveConnection(disabled, signal);
    } catch (error) {
      if (!(error instanceof ConnectionRemovedError)) throw error;
    }
    return true;
  }
  private async persist(
    c: ConnectorConnection,
    next: ConnectorAccountState,
    base: ConnectorAccountState | undefined,
    signal: AbortSignal,
  ): Promise<ConnectorState> {
    const store = this.options.stateStore(c.connectorId, signal);
    const guarded: ConnectorStateStore = {
      read: unlessAborted(signal, () => store.read()),
      write: unlessAborted(signal, (state: ConnectorState) => store.write(state)),
    };
    const result = await updateConnectorState(guarded, (current) => {
      const now = this.now();
      const account = mergeAccountState(this.account(c, current), next, { now, base });
      const accounts: Record<string, ConnectorAccountState> = { ...current?.accounts };
      accounts[c.account] = account;
      // Root checkpoint fields stay as written by their owner (legacy CLI); only creation
      // writes them. The root health summarises the most recent trusted attempt.
      const rootHealth =
        current?.health &&
        trustedTime(current.health.lastRunEndedAt, now) >
          trustedTime(account.health?.lastRunEndedAt, now)
          ? current.health
          : (account.health ?? current?.health);
      const root: ConnectorAccountState = current
        ? {
            connectedAt: current.connectedAt,
            ...(current.lastSync === undefined ? {} : { lastSync: current.lastSync }),
            ...(current.cursor === undefined ? {} : { cursor: current.cursor }),
            lastOutcome: current.lastOutcome,
            counts: current.counts,
          }
        : {
            connectedAt: account.connectedAt,
            lastOutcome: account.lastOutcome,
            counts: account.counts,
          };
      return { ...root, ...(rootHealth ? { health: rootHealth } : {}), accounts };
    });
    this.snapshots.set(c.connectorId, result);
    return result;
  }
  /**
   * Start every due connection (queueing beyond the cap) and resolve once those runs and
   * any started meanwhile have drained. Each connection runs at most once per tick.
   * Overlapping ticks join; one connection's failure never rejects the tick.
   */
  tick(signal?: AbortSignal): Promise<void> {
    if (this.ticking) return this.ticking;
    const combined = signal
      ? AbortSignal.any([signal, this.lifetime.signal])
      : this.lifetime.signal;
    if (combined.aborted) return Promise.resolve();
    this.ticking = (async () => {
      this.tickSignal = combined;
      this.tickStarted = new Set();
      for (;;) {
        this.pump();
        if (!this.running.size) return;
        await Promise.race(this.running.values());
      }
    })().finally(() => {
      this.ticking = undefined;
      this.tickSignal = undefined;
      this.tickStarted = undefined;
    });
    return this.ticking;
  }
  /** Fill free workers with due connections without waiting for them (host poll loops). */
  dispatch(signal?: AbortSignal): void {
    if (signal !== this.dispatchSource || !this.dispatchSignal) {
      this.dispatchSource = signal;
      this.dispatchSignal = signal
        ? AbortSignal.any([signal, this.lifetime.signal])
        : this.lifetime.signal;
    }
    this.pump();
  }
  /** Resolve when no connection run is in flight. */
  async idle(): Promise<void> {
    while (this.running.size || this.ticking) {
      await this.ticking;
      await Promise.allSettled([...this.running.values()]);
    }
  }
  /** A host may use tick/dispatch in its own loop, or this cancellable 30-second loop. */
  async run(signal: AbortSignal): Promise<void> {
    if (this.loop) throw new Error("Connector scheduler already running");
    this.loop = true;
    const combined = AbortSignal.any([signal, this.lifetime.signal]);
    try {
      while (!combined.aborted) {
        this.dispatch(combined);
        await (this.options.sleep ?? sleep)(30_000, combined);
      }
    } finally {
      try {
        await this.idle();
      } finally {
        this.loop = false;
      }
    }
  }
  async stop(): Promise<void> {
    this.lifetime.abort();
    await this.idle();
  }
  list(): readonly ConnectorConnection[] {
    return this.connections.map((c) => ({ ...c }));
  }
  /** Settings rows skipped as `invalid-config`, without raw values. */
  invalid(): readonly InvalidConnectorConnection[] {
    return this.invalidRows.map((row) => ({ ...row }));
  }
  /** Wait until no run holds the connector container, then hold it for `work`. */
  private async exclusive<T>(connectorId: string, work: () => Promise<T>): Promise<T> {
    while (this.containers.has(connectorId)) await this.containers.get(connectorId);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.containers.set(connectorId, held);
    try {
      return await work();
    } finally {
      if (this.containers.get(connectorId) === held) this.containers.delete(connectorId);
      release();
      this.pump();
    }
  }
  /**
   * Explicit owner enable/disable. Enabling stamps a durable `enabledAt` and clears the
   * persisted auth latch before saving host configuration.
   */
  async setEnabled(
    connectorId: string,
    account: string,
    enabled: boolean,
    signal = this.lifetime.signal,
  ): Promise<void> {
    signal.throwIfAborted();
    const c = this.connections.find((c) => c.connectorId === connectorId && c.account === account);
    if (!c) throw new Error("Unknown connector connection");
    await this.exclusive(connectorId, async () => {
      const now = this.now();
      const next: ConnectorConnection = {
        connectorId,
        account,
        ...(c.intervalMinutes === undefined ? {} : { intervalMinutes: c.intervalMinutes }),
        enabled,
        ...(enabled
          ? { enabledAt: new Date(now).toISOString() }
          : c.enabledAt === undefined
            ? {}
            : { enabledAt: c.enabledAt }),
      };
      if (enabled) {
        const store = this.options.stateStore(connectorId, signal),
          current = await store.read();
        signal.throwIfAborted();
        this.snapshots.set(connectorId, current);
        const old = this.account(c, current);
        if (old?.health?.outcome === "needs-reauth")
          await this.persist(
            c,
            { ...old, health: { ...old.health, nextRunAt: new Date(now).toISOString() } },
            old,
            signal,
          );
      }
      signal.throwIfAborted();
      await this.options.saveConnection(next, signal);
      this.connections = this.connections.map((other) =>
        other.connectorId === connectorId && other.account === account ? next : other,
      );
      this.faults.delete(key(next));
    });
  }
  /**
   * Replace host-persisted settings without waiting for in-flight runs. Changed connectors
   * reload their state snapshot. Re-enabling after needs-reauth is driven by `enabledAt`.
   */
  async setConnections(value: readonly ConnectorConnection[] | readonly unknown[]): Promise<void> {
    const parsed = parseConnectorConnections(value, this.registry);
    const rows = (list: readonly ConnectorConnection[], id: string) =>
      JSON.stringify(list.filter((c) => c.connectorId === id));
    const ids = new Set([...this.connections, ...parsed.connections].map((c) => c.connectorId));
    for (const id of ids)
      if (rows(this.connections, id) !== rows(parsed.connections, id)) this.snapshots.delete(id);
    const keep = new Set(parsed.connections.map(key));
    for (const k of [...this.faults.keys()]) if (!keep.has(k)) this.faults.delete(k);
    this.connections = parsed.connections;
    this.invalidRows = parsed.invalid;
    this.pump();
  }
}
