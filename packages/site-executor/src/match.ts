// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
// Matching an ActionRequest to a flow (preferred) or an operation of the site model.

import type {
  ActionRequest,
  EffectClass,
  Flow,
  Operation,
  Parameter,
  SiteModel,
} from "@jeswr/site-model";
import { normaliseIri, resolveParameter, validateValue } from "./values.js";

export interface Target {
  kind: "flow" | "operation";
  id: string;
  label: string;
  actionType: string;
}

export type MatchResult =
  | {
      kind: "match";
      target: Target;
      flow?: Flow;
      operation?: Operation;
      inputs: Record<string, string>;
    }
  | { kind: "ambiguous"; candidates: string[] }
  | { kind: "no-path" };

interface Candidate {
  target: Target;
  flow?: Flow;
  operation?: Operation;
  inputs: Record<string, string>;
  matched: number;
}

/**
 * Resolve all parameters; undefined when a required one has no value. Inputs with
 * no value at all (optional, no default) are left out of the record.
 */
export function resolveInputs(
  params: readonly Parameter[],
  request: ActionRequest,
): { inputs: Record<string, string>; matched: number } | undefined {
  const inputs: Record<string, string> = {};
  let matched = 0;
  for (const param of params) {
    const { value, fromRequest } = resolveParameter(param, request);
    if (value === undefined) {
      if (param.required) return undefined;
      continue;
    }
    validateValue(param, value);
    inputs[param.name] = value;
    if (fromRequest) matched++;
  }
  return { inputs, matched };
}

function pick(candidates: Candidate[]): MatchResult | undefined {
  if (candidates.length === 0) return undefined;
  const best = Math.max(...candidates.map((c) => c.matched));
  const top = candidates.filter((c) => c.matched === best);
  if (top.length > 1) return { kind: "ambiguous", candidates: top.map((c) => c.target.label) };
  const [only] = top as [Candidate];
  return {
    kind: "match",
    target: only.target,
    inputs: only.inputs,
    ...(only.flow ? { flow: only.flow } : {}),
    ...(only.operation ? { operation: only.operation } : {}),
  };
}

export function matchRequest(model: SiteModel, request: ActionRequest): MatchResult {
  const types = new Set(request.types.map(normaliseIri));
  const flows: Candidate[] = [];
  for (const flow of model.flows) {
    if (!types.has(normaliseIri(flow.actionType))) continue;
    const r = resolveInputs(flow.inputs, request);
    if (!r) continue;
    flows.push({
      target: {
        kind: "flow",
        id: flow.id,
        label: flow.label,
        actionType: normaliseIri(flow.actionType),
      },
      flow,
      inputs: r.inputs,
      matched: r.matched,
    });
  }
  const flowMatch = pick(flows);
  if (flowMatch) return flowMatch;
  const ops: Candidate[] = [];
  for (const operation of model.operations) {
    if (!types.has(normaliseIri(operation.actionType))) continue;
    const r = resolveInputs(operation.inputs, request);
    if (!r) continue;
    ops.push({
      target: {
        kind: "operation",
        id: operation.id,
        label: operation.label,
        actionType: normaliseIri(operation.actionType),
      },
      operation,
      inputs: r.inputs,
      matched: r.matched,
    });
  }
  return pick(ops) ?? { kind: "no-path" };
}

const EFFECT_RANK: Readonly<Record<EffectClass, number>> = {
  read: 0,
  "reversible-write": 1,
  "irreversible-write": 2,
  payment: 3,
};

/** An effect class as given, or payment when the model carries an unknown value (fail closed). */
export function normaliseEffect(effect: string): EffectClass {
  return Object.hasOwn(EFFECT_RANK, effect) ? (effect as EffectClass) : "payment";
}

/** The stronger of two effect classes. */
export function maxEffect(a: EffectClass, b: EffectClass): EffectClass {
  const x = normaliseEffect(a);
  const y = normaliseEffect(b);
  return EFFECT_RANK[x] >= EFFECT_RANK[y] ? x : y;
}

/**
 * The effect the gate sees for a flow: the strongest of the flow's declared effect
 * and every step's operation, so a model that under-declares a flow cannot slip a
 * payment step past the gate.
 */
export function effectiveEffect(
  model: SiteModel,
  flow: Flow | undefined,
  operation: Operation | undefined,
  operations: readonly Operation[] = model.operations,
): EffectClass {
  if (operation) return normaliseEffect(operation.effect);
  let effect = normaliseEffect((flow as Flow).effect);
  for (const step of (flow as Flow).steps) {
    const op = operations.find((o) => o.id === step.operation);
    effect = maxEffect(effect, op ? op.effect : "payment");
  }
  return effect;
}
