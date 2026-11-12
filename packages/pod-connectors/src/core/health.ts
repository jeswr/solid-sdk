// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { DEFAULT_CONNECTOR_INTERVAL_MINUTES } from "../registry.js";
import { intervalMinutes, MAX_FUTURE_SKEW_MS } from "./state.js";
import type { ConnectorAccountState, ConnectorRunHealth } from "./types.js";

export type ConnectorHealth = "ok" | "stale" | "failing" | "needs-reauth" | "invalid-config";
export interface ConnectorHealthInput {
  readonly state?: ConnectorAccountState;
  readonly intervalMinutes?: number;
  /** `invalid-config` marks a settings row the scheduler skipped (fixed class, no raw text). */
  readonly status?: "needs-reauth" | "invalid-config";
  /** The settings row's durable re-enable instant (ISO), when present. */
  readonly enabledAt?: string;
}
/**
 * True when the owner re-enabled the connection after its needs-reauth latch: the row's
 * `enabledAt` differs from the value the latch recorded (string comparison, so no clocks
 * are compared). Latches written before that field existed fall back to "`enabledAt` newer
 * than the latching run's `lastRunEndedAt`", ignoring values more than five minutes ahead.
 */
export function connectorReenabled(
  enabledAt: string | undefined,
  latch: ConnectorRunHealth,
  now: number = Date.now(),
): boolean {
  if (latch.latchedEnabledAt !== undefined) return (enabledAt ?? "") !== latch.latchedEnabledAt;
  if (enabledAt === undefined) return false;
  const at = Date.parse(enabledAt);
  return (
    Number.isFinite(at) && at <= now + MAX_FUTURE_SKEW_MS && at > Date.parse(latch.lastRunEndedAt)
  );
}
/** One connection. Partial imports count as successful checkpoints; errors take precedence. */
export function connectorHealth(
  input: ConnectorHealthInput | ConnectorAccountState,
  now: number = Date.now(),
): ConnectorHealth {
  if (!Number.isFinite(now)) throw new RangeError("Invalid health instant");
  const {
    state,
    intervalMinutes: interval,
    status,
    enabledAt,
  }: ConnectorHealthInput = "connectedAt" in input ? { state: input } : input;
  if (status === "invalid-config") return "invalid-config";
  if (status === "needs-reauth") return "needs-reauth";
  if (state?.health?.outcome === "needs-reauth") {
    // A re-enabled connection awaits its next run; it has no recent success to report.
    if (!state.health.nextRunAt && connectorReenabled(enabledAt, state.health, now)) return "stale";
    return "needs-reauth";
  }
  if (state?.health?.outcome === "failed" || state?.lastOutcome === "error") return "failing";
  const last = state?.lastSync ?? state?.connectedAt;
  const ms =
    intervalMinutes(
      interval ?? state?.health?.intervalMinutes ?? DEFAULT_CONNECTOR_INTERVAL_MINUTES,
    ) * 60_000;
  const at = last === undefined ? Number.NaN : Date.parse(last);
  // A success stamped more than five minutes ahead of this clock is untrusted.
  if (!Number.isFinite(at) || at > now + MAX_FUTURE_SKEW_MS || now - at >= 3 * ms) return "stale";
  return "ok";
}
/** Pure with an explicit instant in tests/UI; count connections rather than provider messages. */
export function connectorHealthSummary(
  states: readonly (ConnectorHealthInput | ConnectorAccountState)[],
  now: number = Date.now(),
) {
  const counts = {
    ok: 0,
    stale: 0,
    failing: 0,
    "needs-reauth": 0,
    "invalid-config": 0,
    total: states.length,
  };
  for (const state of states) counts[connectorHealth(state, now)]++;
  return counts;
}
