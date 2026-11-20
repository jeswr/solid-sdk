// AUTHORED-BY Claude Opus 5.5
/**
 * Brief 32 §2: the faulty-gate stand-in for the `gate-released-outside-mandate` branch of
 * `accountability-vendor-fault`. It lives in the engine, never in the gate or the runtime:
 * before a named step, it appends to one agent's record the entries a release writes, as if
 * a faulty gate had let one action through that the mandate does not cover. Nothing leaves
 * the process and the real outbound gate never runs for this action. Every entry is marked
 * `standIn: "faulty-gate"`. The record audit never reads that marker.
 */

import { digestOf } from "../core/canonical.js";
import type { ActionIntent } from "../core/types.js";
import { actionDigest } from "../mechanisms/mandate.js";
import { solidOdrlEngine } from "../mechanisms/policy-engine.js";
import type { EvidenceLedger } from "../store/ledger.js";

/** The one configuration whose branches may carry a gate fault. */
export const VENDOR_FAULT_CONFIGURATION = "accountability-vendor-fault";
export const FAULTY_GATE = "faulty-gate";

export const FAULTY_GATE_STAND_IN = {
  what: "Gate fault in the gate-released-outside-mandate branch",
  replacedBy:
    "An engine fixture outside the gate writes one release that the mandate does not cover into Sam's agent's record, marked as a stand-in. No real gate is bypassed and nothing leaves the process.",
} as const;

export const FAULTY_GATE_CAPTION =
  "Stand-in, this branch only: a faulty gate releases an order that Sam's mandate does not cover and records it as permitted. The real outbound gate did not run for this action.";

export interface GateFault {
  readonly at: string;
  readonly agent: string;
  readonly kind: "released-outside-mandate";
  readonly intent: Record<string, unknown>;
  readonly activityType: string;
}

/**
 * Where a gate fault may appear: only in the `change` of a branch whose `onlyUnder` is the
 * vendor-fault configuration. Returns the problem, or undefined.
 */
export function gateFaultPlacementProblem(scenario: {
  readonly gateFault?: unknown;
  readonly branches: readonly { readonly onlyUnder?: string; readonly change?: unknown }[];
  readonly configurations: readonly { readonly id: string; readonly world?: unknown }[];
}): string | undefined {
  const carries = (value: unknown) =>
    !!value && typeof value === "object" && "gateFault" in (value as Record<string, unknown>);
  if (scenario.gateFault !== undefined)
    return "gateFault is refused at the top level of a scenario";
  for (const branch of scenario.branches)
    if (carries(branch.change) && branch.onlyUnder !== VENDOR_FAULT_CONFIGURATION)
      return `gateFault is refused in a branch not under ${VENDOR_FAULT_CONFIGURATION}`;
  for (const entry of scenario.configurations) {
    type Branch = { onlyUnder?: string; change?: unknown };
    const world = (entry.world ?? {}) as {
      gateFault?: unknown;
      branches?: readonly Branch[] | Record<string, Branch>;
    };
    if (world.gateFault !== undefined)
      return `gateFault is refused in the world of configuration ${entry.id}`;
    // A world patch lists branches as an array or as an id-keyed map.
    const branches = Array.isArray(world.branches)
      ? world.branches
      : Object.values(world.branches ?? {});
    for (const branch of branches)
      if (
        carries(branch.change) &&
        (entry.id !== VENDOR_FAULT_CONFIGURATION || branch.onlyUnder !== VENDOR_FAULT_CONFIGURATION)
      )
        return `gateFault is refused in a branch not under ${VENDOR_FAULT_CONFIGURATION}`;
  }
  return undefined;
}

/**
 * Append the entries one release writes, in the runtime's order: the authorisation decision
 * (recorded as `permit`, with the policy id and digest of the last grant), the activity, one
 * mandate gate check, the outbound gate decision citing it, and the outcome.
 */
export function writeFaultyRelease(input: {
  readonly ledger: EvidenceLedger;
  readonly actor: string;
  readonly party?: string;
  readonly intent: ActionIntent;
  readonly activityType: string;
  readonly activity: string;
  readonly at: string;
}): void {
  const entries = input.ledger.entries();
  const grant = entries.findLast((entry) => entry.record.type === "grant")?.record;
  const evaluator =
    (
      entries.findLast((entry) => entry.record.type === "authorisation-decision")?.record.policy as
        | { evaluator?: string }
        | undefined
    )?.evaluator ?? solidOdrlEngine.id;
  if (!grant || typeof grant.id !== "string" || typeof grant.digest !== "string")
    throw new Error("the faulty-gate stand-in needs a recorded grant");
  const standIn = FAULTY_GATE;
  const at = input.at;
  input.ledger.append(
    {
      type: "authorisation-decision",
      decider: input.actor,
      actionDigest: actionDigest(input.intent),
      action: input.intent,
      policy: { id: grant.id, digest: grant.digest, evaluator },
      outcome: "permit",
      basis: "autonomous",
      reason: "within-mandate",
      at,
      standIn,
    },
    at,
  );
  input.ledger.append(
    {
      type: "activity",
      id: input.activity,
      activityType: input.activityType,
      basis: input.intent.conversation,
      effectKey: input.activity,
      actor: input.actor,
      ...(input.party ? { onBehalfOf: input.party } : {}),
      startedAt: at,
      status: "intended",
      standIn,
    },
    at,
  );
  const check = {
    type: "gate-check",
    agent: input.actor,
    gate: "outbound-gate",
    check: "mandate",
    verdict: "pass",
    reason: "within-mandate",
    at,
    standIn,
  };
  input.ledger.append(check, at);
  input.ledger.append(
    {
      type: "gate-decision",
      agent: input.actor,
      gate: "outbound-gate",
      outcome: "go",
      checks: [digestOf(check)],
      at,
      standIn,
    },
    at,
  );
  input.ledger.append(
    {
      type: "outcome",
      activity: input.activity,
      conclusion: "completed",
      observed: {},
      method: "direct-response",
      at,
      standIn,
    },
    at,
  );
}
