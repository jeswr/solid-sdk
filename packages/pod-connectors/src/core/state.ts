// AUTHORED-BY Codex GPT-6.1-Sol
import type {
  ConnectorAccountState,
  ConnectorErrorClass,
  ConnectorRunHealth,
  ConnectorState,
} from "./types.js";

export const MAX_CONNECTIONS = 1_000;
export const MIN_INTERVAL_MINUTES = 15;
export const MAX_INTERVAL_MINUTES = 525_600;
export const CONNECTOR_ERROR_CLASSES: readonly ConnectorErrorClass[] = [
  "reauthorise",
  "rate-limited",
  "unauthorised",
  "conflict",
  "source-or-pod",
  "unexpected",
  "aborted",
];

export function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid object");
  return value as Record<string, unknown>;
}
function date(value: unknown): string {
  if (typeof value !== "string" || value.length > 64 || !Number.isFinite(Date.parse(value)))
    throw new Error("Invalid state date");
  return new Date(value).toISOString();
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid state count");
  return value;
}
export function accountId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value))
    throw new Error("Invalid opaque connector account");
  return value;
}
export function intervalMinutes(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > MAX_INTERVAL_MINUTES
  )
    throw new Error("Invalid connector interval");
  return Math.max(MIN_INTERVAL_MINUTES, value);
}
function health(value: unknown): ConnectorRunHealth {
  const h = jsonObject(value);
  const counts = jsonObject(h.counts);
  if (!["ok", "partial", "failed", "needs-reauth"].includes(h.outcome as string))
    throw new Error("Invalid health outcome");
  if (
    h.errorClass !== undefined &&
    !CONNECTOR_ERROR_CLASSES.includes(h.errorClass as ConnectorErrorClass)
  )
    throw new Error("Invalid error class");
  const started = date(h.lastRunStartedAt),
    ended = date(h.lastRunEndedAt);
  if (ended < started) throw new Error("Invalid run dates");
  return {
    lastRunStartedAt: started,
    lastRunEndedAt: ended,
    outcome: h.outcome as ConnectorRunHealth["outcome"],
    counts: {
      created: count(counts.created),
      updated: count(counts.updated),
      unchanged: count(counts.unchanged),
      skipped: count(counts.skipped),
    },
    ...(h.errorClass === undefined ? {} : { errorClass: h.errorClass as ConnectorErrorClass }),
    consecutiveFailures: count(h.consecutiveFailures),
    ...(h.nextRunAt === undefined ? {} : { nextRunAt: date(h.nextRunAt) }),
    intervalMinutes: intervalMinutes(h.intervalMinutes),
  };
}
function checkpoint(value: unknown): ConnectorAccountState {
  const s = jsonObject(value),
    counts = jsonObject(s.counts);
  if (s.lastOutcome !== "success" && s.lastOutcome !== "error")
    throw new Error("Invalid state outcome");
  if (
    s.cursor !== undefined &&
    (typeof s.cursor !== "string" || !s.cursor.trim() || s.cursor.length > 1_048_576)
  )
    throw new Error("Invalid state cursor");
  return {
    connectedAt: date(s.connectedAt),
    ...(s.lastSync === undefined ? {} : { lastSync: date(s.lastSync) }),
    ...(s.cursor === undefined ? {} : { cursor: s.cursor as string }),
    lastOutcome: s.lastOutcome,
    counts: {
      documents: count(counts.documents),
      items: count(counts.items),
      skipped: count(counts.skipped),
    },
    ...(s.health === undefined ? {} : { health: health(s.health) }),
  };
}
/** Project allowed fields only, including old checkpoints with no scheduler fields. */
export function connectorState(value: unknown): ConnectorState {
  const s = jsonObject(value),
    base = checkpoint(s);
  if (s.accounts === undefined) return base;
  const entries = Object.entries(jsonObject(s.accounts));
  if (entries.length > MAX_CONNECTIONS) throw new Error("Too many connector accounts");
  const accounts: Record<string, ConnectorAccountState> = Object.create(null);
  for (const [id, state] of entries) accounts[accountId(id)] = checkpoint(state);
  return { ...base, accounts };
}

/** Preserve a concurrent newer successful cursor independently of the most recent attempt. */
export function mergeAccountState(
  previous: ConnectorAccountState | undefined,
  next: ConnectorAccountState,
): ConnectorAccountState {
  if (!previous) return next;
  const checkpoint = (previous.lastSync ?? "") > (next.lastSync ?? "") ? previous : next;
  const attempt =
    (previous.health?.lastRunEndedAt ?? "") > (next.health?.lastRunEndedAt ?? "") ? previous : next;
  return {
    ...checkpoint,
    connectedAt: previous.connectedAt < next.connectedAt ? previous.connectedAt : next.connectedAt,
    lastOutcome: attempt.lastOutcome,
    ...(attempt.health ? { health: attempt.health } : {}),
  };
}

export class StateConflictError extends Error {
  constructor() {
    super("Connector state changed concurrently.");
    this.name = "StateConflictError";
  }
}
export interface ConnectorStateStore {
  read(): Promise<ConnectorState | undefined>;
  /** Conditional on the preceding read; a conflict throws StateConflictError. */
  write(state: ConnectorState): Promise<void>;
}
/** Retry a bounded optimistic transaction, reapplying the merge to each fresh snapshot. */
export async function updateConnectorState(
  store: ConnectorStateStore,
  merge: (state: ConnectorState | undefined) => ConnectorState,
): Promise<ConnectorState> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = connectorState(merge(await store.read()));
    try {
      await store.write(state);
      return state;
    } catch (error) {
      if (!(error instanceof StateConflictError) || attempt === 2) throw error;
    }
  }
  throw new StateConflictError();
}
