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
  connectorCheckpoint,
  intervalMinutes,
  MAX_CONNECTIONS,
  MAX_FUTURE_SKEW_MS,
  mergeAccountState,
  StateConflictError,
  trustedTime,
  updateConnectorState,
} from "./state.js";
import type {
  ConnectorAccountState,
  ConnectorErrorClass,
  ConnectorRunClaim,
  ConnectorRunCounts,
  ConnectorRunHealth,
  ConnectorState,
  IntegrationAdapter,
  PodWriter,
  TokenSource,
} from "./types.js";
import { ConnectionRemovedError, NoVaultError, ReauthoriseError } from "./types.js";

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
/**
 * What a `saveConnection` port did: `"superseded"` when a needs-reauth disable was skipped
 * because the stored row's `enabledAt` no longer equals the latched one (the owner
 * re-enabled during the run). `"applied"` (or no value, for older ports) means written.
 */
export type ConnectionSaveResult = "applied" | "superseded";
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
   * A needs-reauth disable must apply only while the stored row's `enabledAt` equals
   * `connection.enabledAt`; otherwise leave the row and resolve `"superseded"`.
   */
  readonly saveConnection: (
    connection: ConnectorConnection,
    signal: AbortSignal,
  ) => Promise<ConnectionSaveResult | undefined>;
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
  /**
   * Hard limit for one run (claim, token, Pod writer and import), default 15 minutes,
   * between 1 second and 2 hours. A run past it is cancelled and recorded as a failed
   * `timeout` attempt with back-off.
   */
  readonly runTimeoutMs?: number;
}
export const DEFAULT_CONNECTOR_RUN_TIMEOUT_MS = 15 * 60_000;
export const MAX_CONNECTOR_RUN_TIMEOUT_MS = 2 * 60 * 60_000;
/** Separate bound for the post-run state/settings/vault calls. */
const FINISH_TIMEOUT_MS = 2 * 60_000;
/** No host's claim can legitimately expire later than this ahead of the reader's clock. */
const MAX_CLAIM_MS = MAX_CONNECTOR_RUN_TIMEOUT_MS + FINISH_TIMEOUT_MS + 2 * MAX_FUTURE_SKEW_MS;
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
 * Due instant in epoch ms (0 = now), or undefined when disabled/latched. A trusted attempt
 * (`health.lastRunEndedAt` within five minutes of `now`) is followed, including its
 * back-off; only a `nextRunAt` beyond `now + max(interval, 24 h)` makes it due now. An
 * ok/partial attempt is due no later than `lastRunEndedAt + interval`. With
 * no trusted attempt, a `lastRunEndedAt` or `lastSync` more than five minutes ahead makes
 * the connection due now: a skewed clock can never park a connection.
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
  const health = state?.health;
  // The auth latch is a durable owner decision, independent of any clock.
  if (health?.outcome === "needs-reauth" && !health.nextRunAt)
    return connectorReenabled(connection.enabledAt, health, now) ? 0 : undefined;
  const ahead = (at: string | undefined) =>
    at !== undefined && Date.parse(at) > now + MAX_FUTURE_SKEW_MS;
  const clamp = (at: number) => Math.min(at, horizon);
  if (health && !ahead(health.lastRunEndedAt)) {
    if (!health.nextRunAt) return clamp(Date.parse(health.lastRunEndedAt) + interval * 60_000);
    if (Date.parse(health.nextRunAt) > horizon) return 0;
    if (health.outcome === "ok" || health.outcome === "partial") {
      // A success is never parked beyond its own interval by a stored nextRunAt.
      const byInterval = Date.parse(health.lastRunEndedAt) + interval * 60_000;
      return clamp(
        interval !== health.intervalMinutes
          ? byInterval
          : Math.min(Date.parse(health.nextRunAt), byInterval),
      );
    }
    return clamp(Date.parse(health.nextRunAt));
  }
  if (health || ahead(state?.lastSync)) return 0;
  return state?.lastSync ? clamp(Date.parse(state.lastSync) + interval * 60_000) : 0;
}
/** Drop checkpoint times stamped more than five minutes ahead before persisting them. */
function trustedCheckpoint(
  checkpoint: ConnectorAccountState,
  started: string,
  now: number,
): ConnectorAccountState {
  const limit = now + MAX_FUTURE_SKEW_MS;
  const { lastSync, ...rest } = checkpoint;
  return {
    ...rest,
    ...(lastSync !== undefined && Date.parse(lastSync) <= limit ? { lastSync } : {}),
    connectedAt: Date.parse(checkpoint.connectedAt) > limit ? started : checkpoint.connectedAt,
  };
}
function errorClass(error: unknown, signal: AbortSignal): ConnectorErrorClass {
  if (signal.aborted) return "aborted";
  if (error instanceof ReauthoriseError) return "reauthorise";
  if (error instanceof RateLimitedError) return "rate-limited";
  if (error instanceof IntegrationSyncError) {
    // Only 401 means the access token was rejected. 403 also covers rate limits, quotas
    // and allowlists (Google, Drive downloads, Spotify dev mode) with a valid grant.
    if (error.status === 401) return "unauthorised";
    if (error.status === 403) return "forbidden";
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
class RunTimeoutError extends Error {
  constructor() {
    super("Connector run exceeded its time limit.");
    this.name = "TimeoutError";
  }
}
/** A cancellable timer signal (fake-timer friendly, unlike AbortSignal.timeout). */
function deadline(ms: number): { readonly signal: AbortSignal; clear(): void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new RunTimeoutError()), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}
/** Stop waiting when `signal` aborts, even if `work` ignores it (a hung provider or vault). */
function bounded<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) {
    work.catch(() => undefined);
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
function withoutClaim(state: ConnectorState, account: string): ConnectorState {
  const { claims, ...rest } = state;
  const kept = Object.entries(claims ?? {}).filter(([id]) => id !== account);
  return kept.length ? { ...rest, claims: Object.fromEntries(kept) } : rest;
}
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
  private readonly runTimeoutMs: number;
  /** A run's claim covers its limit, the finishing writes and the clock-skew allowance. */
  private readonly claimTtlMs: number;
  private readonly lifetime = new AbortController();
  /** Cached state per connector container; absent means not yet loaded. */
  private readonly snapshots = new Map<string, ConnectorState | undefined>();
  private readonly running = new Map<string, Promise<void>>();
  private readonly containers = new Map<string, Promise<void>>();
  /** In-memory back-off for runs that failed outside the import (e.g. persistence). */
  private readonly faults = new Map<string, { failures: number; retryAt: number }>();
  /** This scheduler's latest claim holder per connection (its own stale claim is no bar). */
  private readonly holders = new Map<string, string>();
  /** Connector containers with a pending exclusive (owner) operation. */
  private readonly waiting = new Map<string, number>();
  private readonly exclusives = new Set<Promise<void>>();
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
    this.runTimeoutMs = options.runTimeoutMs ?? DEFAULT_CONNECTOR_RUN_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(this.runTimeoutMs) ||
      this.runTimeoutMs < 1_000 ||
      this.runTimeoutMs > MAX_CONNECTOR_RUN_TIMEOUT_MS
    )
      throw new Error("Invalid connector run timeout");
    this.claimTtlMs = this.runTimeoutMs + FINISH_TIMEOUT_MS + MAX_FUTURE_SKEW_MS;
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
    // Another host's unexpired claim defers this connection until it expires.
    const snapshot = this.snapshots.get(c.connectorId);
    if (this.claimedElsewhere(c, snapshot, now))
      due = Math.max(due, Date.parse(this.claimOf(c, snapshot)?.expiresAt ?? ""));
    return fault ? Math.max(due, fault.retryAt) : due;
  }
  private next(now: number): ConnectorConnection | undefined {
    let best: ConnectorConnection | undefined;
    let bestAt = Number.POSITIVE_INFINITY;
    for (const c of this.connections) {
      const k = key(c);
      if (
        this.running.has(k) ||
        this.containers.has(c.connectorId) ||
        this.waiting.has(c.connectorId) ||
        this.tickStarted?.has(k)
      )
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
    // The run time limit bounds everything up to the outcome, including the claim.
    const limit = deadline(this.runTimeoutMs);
    try {
      return await this.attempt(c, signal, limit.signal);
    } finally {
      limit.clear();
    }
  }
  private async attempt(
    c: ConnectorConnection,
    signal: AbortSignal,
    timeout: AbortSignal,
  ): Promise<boolean> {
    // Work observes `run` (shutdown or limit); waits are cut only at the limit, so shutdown
    // still drains cooperative work while a hung provider or vault frees the worker.
    const run = AbortSignal.any([signal, timeout]);
    const store = this.options.stateStore(c.connectorId, run);
    const state = await bounded(store.read(), timeout);
    signal.throwIfAborted();
    this.snapshots.set(c.connectorId, state);
    const previous = this.account(c, state),
      interval = this.interval(c);
    const due = connectorNextRunAt(c, previous, interval, this.now());
    if (due === undefined || due > this.now()) return false;
    // Another host (or tab) holds an unexpired claim: skip quietly, writing nothing.
    if (this.claimedElsewhere(c, state, this.now())) return false;
    const holder = globalThis.crypto.randomUUID();
    this.holders.set(key(c), holder);
    const started = new Date(this.now()).toISOString();
    const claimed = this.withClaim(c, state, {
      holder,
      expiresAt: new Date(this.now() + this.claimTtlMs).toISOString(),
    });
    try {
      await bounded(store.write(claimed), timeout);
    } catch (error) {
      // A concurrent writer won the conditional write: re-read before deciding again.
      if (!(error instanceof StateConflictError) || signal.aborted) throw error;
      this.snapshots.delete(c.connectorId);
      return false;
    }
    this.snapshots.set(c.connectorId, claimed);
    const fresh: ConnectorAccountState = previous ?? {
      connectedAt: started,
      lastOutcome: "error",
      counts: { documents: 0, items: 0, skipped: 0 },
    };
    let checkpoint = fresh;
    let counts = emptyCounts();
    let outcome: ConnectorRunHealth["outcome"] = "failed";
    let code: ConnectorErrorClass | undefined;
    let retryAfterMs = 0;
    try {
      const token = await bounded(
        this.options.tokenSource.accessToken(c.connectorId, c.account, run),
        timeout,
      );
      run.throwIfAborted();
      if (!token || token.length > 65_536 || !/^[\x21-\x7e]+$/.test(token))
        throw new Error("Invalid source credential");
      const adapter = this.adapter(c);
      const tokens = { accessToken: token, tokenType: "Bearer" };
      const sourceFetch = abortableFetch(this.options.sourceFetch, run);
      const sourceAuth =
        adapter.oauth && adapter.createSourceAuth
          ? adapter.createSourceAuth(adapter.oauth, tokens, sourceFetch)
          : createSourceAuth(c.connectorId, adapter, tokens, sourceFetch);
      run.throwIfAborted();
      const podWriter = await bounded(Promise.resolve(this.options.podWriter(c, run)), timeout);
      run.throwIfAborted();
      const report = await bounded(
        (this.options.runner ?? runImport)({
          adapter,
          mode: "live",
          podWriter,
          sourceAuth,
          state: previous,
          signal: run,
          onRunCounts: (value) => {
            counts = value;
          },
        }),
        timeout,
      );
      run.throwIfAborted();
      counts = report.counts ?? { ...counts, skipped: report.skipped ?? counts.skipped };
      const ended = new Date(this.now()).toISOString();
      // Validate the adapter's checkpoint before treating the run as a success: an
      // unpersistable one becomes a failed attempt that keeps the previous cursor.
      checkpoint = connectorCheckpoint({
        ...(report.state ?? checkpoint),
        lastSync: ended,
        lastOutcome: "success",
      });
      outcome = counts.skipped > 0 ? "partial" : "ok";
    } catch (error) {
      if (error instanceof NoVaultError && !run.aborted) {
        // A host capability gap, not a revoked grant: release the claim, record nothing.
        const finish = deadline(FINISH_TIMEOUT_MS);
        try {
          await this.release(c, holder, signal, finish.signal);
        } finally {
          finish.clear();
        }
        this.backOff(c);
        return false;
      }
      code = signal.aborted ? "aborted" : timeout.aborted ? "timeout" : errorClass(error, signal);
      if (error instanceof RateLimitedError) {
        const seconds = error.retryAfterSeconds;
        if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0)
          retryAfterMs = Math.min(MAX_CONNECTOR_BACKOFF_MS, seconds * 1_000);
      }
      // A second consecutive source 401 (token rejected) is treated like a revoked grant.
      const unauthorisedAgain =
        code === "unauthorised" &&
        previous?.health?.outcome === "failed" &&
        previous.health.errorClass === "unauthorised";
      outcome = code === "reauthorise" || unauthorisedAgain ? "needs-reauth" : "failed";
      checkpoint = { ...fresh, lastOutcome: "error" };
    }
    // Cancellation starts no further Pod/config I/O, matching the runner's abort contract;
    // the claim then expires on its own.
    if (signal.aborted) return false;
    const finish = deadline(FINISH_TIMEOUT_MS);
    try {
      return await this.finish(c, signal, finish.signal, {
        holder,
        started,
        previous,
        fresh,
        checkpoint,
        counts,
        outcome,
        code,
        retryAfterMs,
        interval,
      });
    } finally {
      finish.clear();
    }
  }
  /** Persist the attempt's outcome under the finishing deadline and release the claim. */
  private async finish(
    c: ConnectorConnection,
    signal: AbortSignal,
    limit: AbortSignal,
    run: {
      readonly holder: string;
      readonly started: string;
      readonly previous: ConnectorAccountState | undefined;
      readonly fresh: ConnectorAccountState;
      readonly checkpoint: ConnectorAccountState;
      readonly counts: ConnectorRunCounts;
      readonly outcome: ConnectorRunHealth["outcome"];
      readonly code: ConnectorErrorClass | undefined;
      readonly retryAfterMs: number;
      readonly interval: number;
    },
  ): Promise<boolean> {
    const { holder, started, previous, counts, outcome, code, interval } = run;
    const io = AbortSignal.any([signal, limit]);
    // A failed run must not carry a future-dated checkpoint forward (it would stay due).
    const checkpoint = trustedCheckpoint(run.checkpoint, started, this.now());
    const ended = new Date(Math.max(this.now(), Date.parse(started))).toISOString();
    const failuresAfter = Math.min(
      Number.MAX_SAFE_INTEGER,
      (previous?.health?.consecutiveFailures ?? 0) + 1,
    );
    const backoff = () =>
      Math.min(
        MAX_CONNECTOR_BACKOFF_MS,
        Math.max(connectorBackoffMs(failuresAfter, this.options.random), run.retryAfterMs),
      );
    const failures = outcome === "ok" || outcome === "partial" ? 0 : failuresAfter;
    const delay = failures ? backoff() : interval * 60_000;
    const health: ConnectorRunHealth = {
      lastRunStartedAt: started,
      lastRunEndedAt: ended,
      outcome,
      counts,
      ...(code ? { errorClass: code } : {}),
      consecutiveFailures: failures,
      intervalMinutes: interval,
      // A latch records the row's enabledAt it latched against ("" for none); only a
      // different value clears it, so no cross-clock ordering is involved.
      ...(outcome === "needs-reauth"
        ? { latchedEnabledAt: c.enabledAt ?? "" }
        : { nextRunAt: new Date(Date.parse(ended) + delay).toISOString() }),
    };
    if (outcome !== "needs-reauth") {
      try {
        await this.persist(c, { ...checkpoint, health }, previous, io, holder, limit);
      } catch (error) {
        if (signal.aborted) throw error;
        // The checkpoint could not be saved (bounds, repeated conflicts): keep the previous
        // checkpoint and save only a failed attempt, so the back-off is durable.
        const failed: ConnectorRunHealth = {
          lastRunStartedAt: started,
          lastRunEndedAt: ended,
          outcome: "failed",
          counts,
          errorClass: errorClass(error, signal),
          consecutiveFailures: failuresAfter,
          intervalMinutes: interval,
          nextRunAt: new Date(Date.parse(ended) + backoff()).toISOString(),
        };
        await this.persist(
          c,
          {
            ...trustedCheckpoint({ ...run.fresh, lastOutcome: "error" }, started, this.now()),
            health: failed,
          },
          previous,
          io,
          holder,
          limit,
        );
        throw error;
      }
      return true;
    }
    // The latch belongs to the row as it was at run start (`c`). An owner re-enable that
    // reached memory meanwhile (setConnections/setEnabled with a new enabledAt) supersedes
    // it: the current row is left untouched, no settings disable is attempted and the
    // owner's fresh grant is never invalidated. The persisted latch records c's enabledAt,
    // which the new value clears.
    const current = this.find(c);
    let superseded = current !== undefined && current.enabledAt !== c.enabledAt;
    const disabled: ConnectorConnection | undefined =
      current && !superseded ? { ...current, enabled: false, status: "needs-reauth" } : undefined;
    if (current && disabled) this.replace(current, disabled);
    // Persist health even if the host config write fails; the health latch also fails closed.
    await this.persist(c, { ...checkpoint, health }, previous, io, holder, limit);
    signal.throwIfAborted();
    if (current && disabled) {
      let skipped = false;
      try {
        skipped =
          (await bounded(this.options.saveConnection(disabled, io), limit)) === "superseded";
      } catch (error) {
        if (!(error instanceof ConnectionRemovedError)) throw error;
      }
      if (skipped) {
        // The stored row carries a different enabledAt: undo only our own in-memory
        // disable; a row replaced meanwhile is the newer owner state and stays.
        superseded = true;
        this.replace(disabled, current);
      }
    }
    // Only the grant that was in use for this rejected run, and only while no owner
    // re-enable superseded the latch (in memory or in the stored settings).
    if (code === "unauthorised" && !superseded && this.options.tokenSource.invalidate) {
      try {
        await bounded(
          Promise.resolve(
            this.options.tokenSource.invalidate({
              connectorId: c.connectorId,
              account: c.account,
            }),
          ),
          limit,
        );
      } catch {
        // Best effort: the durable latch already blocks further source traffic.
      }
    }
    return true;
  }
  /** In-memory back-off without a run-error report (e.g. no vault on this host). */
  private backOff(c: ConnectorConnection) {
    const k = key(c);
    const failures = Math.min(1_000, (this.faults.get(k)?.failures ?? 0) + 1);
    this.faults.set(k, {
      failures,
      retryAt: this.now() + connectorBackoffMs(failures, this.options.random),
    });
  }
  /** Swap one in-memory row object for another, only while `from` is still installed. */
  private replace(from: ConnectorConnection, to: ConnectorConnection) {
    this.connections = this.connections.map((other) => (other === from ? to : other));
  }
  private claimLive(claim: ConnectorRunClaim | undefined, now: number): claim is ConnectorRunClaim {
    if (!claim) return false;
    const at = Date.parse(claim.expiresAt);
    // A claim expiring beyond any run's limit (forged, or a skewed clock) is not trusted.
    return at > now && at <= now + MAX_CLAIM_MS;
  }
  private claimOf(c: ConnectorConnection, state: ConnectorState | undefined) {
    return state?.claims && Object.hasOwn(state.claims, c.account)
      ? state.claims[c.account]
      : undefined;
  }
  /** An unexpired claim not left by this scheduler's own last run of the connection. */
  private claimedElsewhere(c: ConnectorConnection, state: ConnectorState | undefined, now: number) {
    const claim = this.claimOf(c, state);
    return this.claimLive(claim, now) && claim.holder !== this.holders.get(key(c));
  }
  /** The stored document plus this run's claim; live claims of other accounts are kept. */
  private withClaim(
    c: ConnectorConnection,
    state: ConnectorState | undefined,
    claim: ConnectorRunClaim,
  ): ConnectorState {
    const now = this.now();
    const claims: Record<string, ConnectorRunClaim> = Object.create(null);
    for (const [account, other] of Object.entries(state?.claims ?? {}))
      if (account !== c.account && this.claimLive(other, now)) claims[account] = other;
    claims[c.account] = claim;
    // A new document gets a placeholder root (replaced by the first persisted attempt) and
    // an empty account map, so no checkpoint is fabricated for any account.
    const base: ConnectorState = state ?? {
      connectedAt: new Date(now).toISOString(),
      lastOutcome: "error",
      counts: { documents: 0, items: 0, skipped: 0 },
      accounts: {},
    };
    return { ...base, claims };
  }
  /** Remove this run's claim (only while it is still the stored one). */
  private async release(
    c: ConnectorConnection,
    holder: string,
    signal: AbortSignal,
    limit: AbortSignal,
  ) {
    const io = AbortSignal.any([signal, limit]);
    const store = this.options.stateStore(c.connectorId, io);
    for (let attempt = 0; ; attempt++) {
      const current = await bounded(store.read(), limit);
      signal.throwIfAborted();
      if (!current || this.claimOf(c, current)?.holder !== holder) {
        this.snapshots.set(c.connectorId, current);
        return;
      }
      const next = withoutClaim(current, c.account);
      try {
        await bounded(store.write(next), limit);
        this.snapshots.set(c.connectorId, next);
        return;
      } catch (error) {
        if (!(error instanceof StateConflictError) || attempt === 2) throw error;
      }
    }
  }
  private async persist(
    c: ConnectorConnection,
    next: ConnectorAccountState,
    base: ConnectorAccountState | undefined,
    signal: AbortSignal,
    holder?: string,
    limit?: AbortSignal,
  ): Promise<ConnectorState> {
    const store = this.options.stateStore(c.connectorId, signal);
    const guarded: ConnectorStateStore = {
      read: unlessAborted(signal, () => bounded(store.read(), limit)),
      write: unlessAborted(signal, (state: ConnectorState) => bounded(store.write(state), limit)),
    };
    const result = await updateConnectorState(guarded, (stored) => {
      const now = this.now();
      // This run's claim is released with its outcome; any other claim is kept.
      const current =
        stored && holder && this.claimOf(c, stored)?.holder === holder
          ? withoutClaim(stored, c.account)
          : stored;
      const account = mergeAccountState(this.account(c, current), next, { now, base });
      const accounts: Record<string, ConnectorAccountState> = { ...current?.accounts };
      accounts[c.account] = account;
      // Root checkpoint fields stay as written by their owner (legacy CLI); only creation
      // (or a claim's placeholder root) writes them. The root health summarises the most
      // recent trusted attempt.
      const rootHealth =
        current?.health &&
        trustedTime(current.health.lastRunEndedAt, now) >
          trustedTime(account.health?.lastRunEndedAt, now)
          ? current.health
          : (account.health ?? current?.health);
      const placeholder =
        !current ||
        (!current.health &&
          current.lastSync === undefined &&
          current.cursor === undefined &&
          current.accounts !== undefined &&
          Object.keys(current.accounts).length === 0);
      const root: ConnectorAccountState = placeholder
        ? {
            connectedAt: account.connectedAt,
            lastOutcome: account.lastOutcome,
            counts: account.counts,
          }
        : {
            connectedAt: current.connectedAt,
            ...(current.lastSync === undefined ? {} : { lastSync: current.lastSync }),
            ...(current.cursor === undefined ? {} : { cursor: current.cursor }),
            lastOutcome: current.lastOutcome,
            counts: current.counts,
          };
      return {
        ...root,
        ...(rootHealth ? { health: rootHealth } : {}),
        ...(current?.claims ? { claims: current.claims } : {}),
        accounts,
      };
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
  /** Resolve when no connection run or exclusive owner operation is in flight. */
  async idle(): Promise<void> {
    while (this.running.size || this.ticking || this.exclusives.size) {
      await this.ticking;
      await Promise.allSettled([...this.running.values(), ...this.exclusives]);
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
  /**
   * Hold the connector container for `work`. A waiter takes priority over new pool claims
   * for that container, so it waits for at most the run already in flight.
   */
  private exclusive<T>(connectorId: string, work: () => Promise<T>): Promise<T> {
    const task = (async () => {
      this.waiting.set(connectorId, (this.waiting.get(connectorId) ?? 0) + 1);
      try {
        while (this.containers.has(connectorId)) await this.containers.get(connectorId);
      } finally {
        const count = (this.waiting.get(connectorId) ?? 1) - 1;
        if (count > 0) this.waiting.set(connectorId, count);
        else this.waiting.delete(connectorId);
      }
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
    })();
    const settled: Promise<void> = task.then(
      () => undefined,
      () => undefined,
    );
    this.exclusives.add(settled);
    void settled.then(() => this.exclusives.delete(settled));
    return task;
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
    for (const k of [...this.holders.keys()]) if (!keep.has(k)) this.holders.delete(k);
    this.connections = parsed.connections;
    this.invalidRows = parsed.invalid;
    this.pump();
  }
}
