// AUTHORED-BY Codex GPT-6.1-Sol
import { DEFAULT_CONNECTOR_INTERVAL_MINUTES } from "../registry.js";
import { intervalMinutes } from "./state.js";
import type { ConnectorAccountState } from "./types.js";

export type ConnectorHealth = "ok" | "stale" | "failing" | "needs-reauth";
export interface ConnectorHealthInput {
  readonly state?: ConnectorAccountState;
  readonly intervalMinutes?: number;
  readonly status?: "needs-reauth";
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
  } = "connectedAt" in input ? { state: input } : input;
  if (status === "needs-reauth" || state?.health?.outcome === "needs-reauth") return "needs-reauth";
  if (state?.health?.outcome === "failed" || state?.lastOutcome === "error") return "failing";
  const last = state?.lastSync ?? state?.connectedAt;
  const ms =
    intervalMinutes(
      interval ?? state?.health?.intervalMinutes ?? DEFAULT_CONNECTOR_INTERVAL_MINUTES,
    ) * 60_000;
  if (!last || !Number.isFinite(Date.parse(last)) || now - Date.parse(last) >= 3 * ms)
    return "stale";
  return "ok";
}
/** Pure with an explicit instant in tests/UI; count connections rather than provider messages. */
export function connectorHealthSummary(
  states: readonly (ConnectorHealthInput | ConnectorAccountState)[],
  now: number = Date.now(),
) {
  const counts = { ok: 0, stale: 0, failing: 0, "needs-reauth": 0, total: states.length };
  for (const state of states) counts[connectorHealth(state, now)]++;
  return counts;
}
