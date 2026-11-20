// AUTHORED-BY Codex GPT-6
import type { TraceEvent } from "../trace/types.js";
import type { Scenario } from "./schema.js";

export function decisionsOf(events: readonly TraceEvent[]) {
  return events
    .filter((e) => e.kind === "decision" && e.outcome)
    .map((e) => ({
      ...e,
      check:
        e.check ??
        events
          .slice(0, e.seq - 1)
          .findLast((c) => c.agent === e.agent && c.kind === "check" && c.reason === e.reason)
          ?.check,
    }));
}

const goes = (outcome: string | undefined) => outcome === "go" || outcome === "admit";
const passing = ({ outcome }: { outcome?: string }) => goes(outcome) || outcome === "pass";

export function comparisonOutcome(outcome: string | undefined) {
  if (outcome === "refuse") return "stop";
  if (outcome === "admit") return "go";
  return outcome;
}

/** Ordered, consuming matching: one main event cannot match two branch events. */
function* orderedMatches(
  main: readonly TraceEvent[],
  branch: readonly TraceEvent[],
  equal: (candidate: TraceEvent, event: TraceEvent) => boolean,
) {
  let next = 0;
  for (const event of branch) {
    const match = main.findIndex((candidate, index) => index >= next && equal(candidate, event));
    if (match >= 0) next = match + 1;
    yield [event, main[match]] as const;
  }
}

const sameCheck = (a: TraceEvent, b: TraceEvent) =>
  a.agent === b.agent && a.part === b.part && a.check === b.check && a.reason === b.reason;

const decisionMatches = (main: readonly TraceEvent[], branch: readonly TraceEvent[]) =>
  orderedMatches(main, branch, (a, b) => sameCheck(a, b) && a.outcome === b.outcome);

export function firstBranchDivergence(main: readonly TraceEvent[], branch: readonly TraceEvent[]) {
  for (const [decision, match] of decisionMatches(main, branch))
    if (!match && !passing(decision)) return decision;
  return undefined;
}

interface StepDescriptor {
  readonly type: string;
  readonly action?: string;
  readonly operation?: string;
  readonly target?: string;
  readonly recipient?: string;
  readonly messageKind?: string;
  readonly items: readonly string[];
  readonly decision?: string;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

const string = (value: unknown) => (typeof value === "string" ? value : undefined);

/** The descriptor uses only scenario identifiers. Never resolve run-generated references. */
export function describeStep(
  step: Scenario["script"][number],
  statementId: (id: string) => string = (id) => id,
): StepDescriptor {
  const data: Record<string, unknown> = step;
  const reply = object(data.reply);
  const intent = object(data.intent ?? reply?.intent);
  const parameters = object(intent?.parameters);
  const params = object(data.params);
  const body = object(data.body);
  const input = object(body?.input);
  const output = object(body?.output ?? reply?.output);
  const items = new Set<string>();
  for (const list of [
    data.items,
    data.evidence,
    data.statements,
    object(data.contents)?.items,
    input?.items,
    output?.items,
    reply?.evidence,
    intent?.evidence,
    ...[parameters, params].flatMap((source) => [
      source?.items,
      source?.evidence,
      source?.support,
      [source?.reading],
    ]),
  ]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const entry = object(item);
      const reference = string(entry?.$ref);
      const declaration = reference?.match(/^statements\.([^.]+)\.(?:evidence|statement\.id)$/);
      const stepItem = reference?.match(/^steps\.[^.]+\.(?:readings\.\d+\.)?statement\.id$/);
      const id = string(item) ?? string(entry?.itemId) ?? declaration?.[1] ?? stepItem?.[0];
      if (id && !id.startsWith("sha-256:")) items.add(statementId(id));
    }
  }
  return {
    type: step.type,
    action: string(intent?.action ?? data.action),
    operation: string(intent?.operation ?? data.operation ?? object(body?.operation)?.id),
    target: string(intent?.target),
    recipient: string(intent?.recipient ?? data.recipient ?? data.peer),
    messageKind: string(data.kind ?? reply?.type),
    items: [...items].sort(),
    decision: step.type === "effect" ? string(params?.decision) : undefined,
  };
}

export interface ComparisonRun {
  readonly events: readonly TraceEvent[];
  /** Keyed by event sequence because multiple script steps can share a trace step number. */
  readonly steps?: ReadonlyMap<number, StepDescriptor>;
  readonly effectReleases?: ReadonlySet<number>;
  readonly approvedAsks?: ReadonlySet<number>;
}

function witnessedRelease(
  main: ComparisonRun,
  branch: ComparisonRun,
  witness: { outcome: string; check: string; reason: string } | undefined,
  judgedAgent: string | undefined,
): boolean {
  if (!witness || !goes(witness.outcome)) return false;
  const check = branch.events.find(
    (e) =>
      e.kind === "check" &&
      e.check === witness.check &&
      e.reason === witness.reason &&
      (!judgedAgent || e.agent === judgedAgent),
  );
  if (!check) return false;
  const decision = branch.events.find(
    (e) =>
      e.seq > check.seq &&
      e.kind === "decision" &&
      e.agent === check.agent &&
      (witness.outcome === "go" ? e.outcome === "go" : goes(e.outcome)),
  );
  if (!decision) return false;
  // A release inside the shared prefix does not witness the branch going further.
  const split = branch.events.findIndex((event, index) => {
    const before = main.events[index];
    return (
      !before ||
      !sameCheck(event, before) ||
      event.kind !== before.kind ||
      event.outcome !== before.outcome ||
      event.verdict !== before.verdict ||
      event.packet?.kind !== before.packet?.kind
    );
  });
  return branch.events.some((event, index) => {
    if (event.agent !== check.agent) return false;
    const afterSplit = split >= 0 && index >= split;
    return (
      (event.seq > decision.seq && event.kind === "message-out" && afterSplit) ||
      (event.seq >= decision.seq &&
        branch.effectReleases?.has(event.seq) &&
        (afterSplit || !main.effectReleases?.has(event.seq)))
    );
  });
}

const superseded = "superseded-by-better-source";
const withheld = (e: TraceEvent) =>
  e.part === "inbound-gate" &&
  e.kind === "check" &&
  e.reason !== undefined &&
  (["fail", "indeterminate", "ask-more", "ask-principal"].includes(e.verdict ?? "") ||
    e.reason === superseded);

function admittedStatementChecks(run: ComparisonRun, judgedAgent: string | undefined) {
  const candidates: { check: TraceEvent; admission: TraceEvent }[] = [];
  const pending = new Map<string, TraceEvent[]>();
  const admitted = new Map<string, TraceEvent>();
  for (const event of run.events) {
    if (judgedAgent && event.agent !== judgedAgent) continue;
    const agent = event.agent;
    if (
      event.kind === "message-in" ||
      (event.part === "inbound-gate" && event.kind === "check" && event.check === "integrity")
    ) {
      pending.delete(agent);
      admitted.delete(agent);
    }
    if (event.part !== "inbound-gate") continue;
    if (event.kind === "decision") {
      if (event.outcome === "admit") {
        candidates.push(
          ...(pending.get(agent) ?? []).map((check) => ({ check, admission: event })),
        );
        admitted.set(agent, event);
      } else admitted.delete(agent);
      pending.delete(agent);
    } else if (withheld(event)) {
      const prior = admitted.get(agent);
      // Standalone statement admission records precedence after admitting the individual items.
      if (
        event.reason === superseded &&
        prior &&
        prior.step === event.step &&
        run.steps?.get(prior.seq) === run.steps?.get(event.seq)
      ) {
        candidates.push({ check: event, admission: event });
      } else {
        const checks = pending.get(agent) ?? [];
        checks.push(event);
        pending.set(agent, checks);
      }
    }
  }
  return candidates.sort((a, b) => a.check.seq - b.check.seq);
}

function firstStatementDifference(main: ComparisonRun, branch: ComparisonRun, agent?: string) {
  const checks = admittedStatementChecks(branch, agent);
  const matches = orderedMatches(
    main.events.filter(withheld),
    checks.map(({ check }) => check),
    (a, b) => sameCheck(a, b) && a.verdict === b.verdict,
  );
  for (const [index, [check, match]] of Array.from(matches).entries()) {
    if (match) continue;
    return { ...check, seq: checks[index]!.admission.seq, outcome: "admit" as const };
  }
  return undefined;
}

function hasNewTransportFault(main: ComparisonRun, branch: ComparisonRun) {
  const faults = (run: ComparisonRun) =>
    run.events
      .filter((e) => e.part === "transport" && e.kind === "record" && e.fault)
      .map((e) => e.fault);
  const mainFaults = new Set(faults(main));
  return faults(branch).some((fault) => !mainFaults.has(fault));
}

function changedAction(
  main: ComparisonRun,
  branch: ComparisonRun,
  matches: Iterable<readonly [TraceEvent, TraceEvent | undefined]>,
) {
  for (const [decision, match] of matches) {
    if (!match || passing(decision)) continue;
    const before = main.steps?.get(match.seq);
    const after = branch.steps?.get(decision.seq);
    if (before && after && JSON.stringify(before) !== JSON.stringify(after)) return decision;
  }
  return undefined;
}

export function compareBranch(
  main: ComparisonRun | undefined,
  branch: ComparisonRun,
  options: {
    judgedAgent?: string;
    witness?: { outcome: string; check: string; reason: string };
    expectedOutcome?: string;
  } = {},
): { judged?: TraceEvent; diverges: boolean; setup: TraceEvent[] } {
  const { judgedAgent, witness, expectedOutcome } = options;
  const decisions = decisionsOf(branch.events);
  const setup = judgedAgent ? decisions.filter((e) => e.agent !== judgedAgent) : [];
  for (const event of setup) {
    if (
      !passing(event) &&
      !(event.outcome === "ask-principal" && branch.approvedAsks?.has(event.seq))
    )
      throw new Error(
        `judgedAgent ${judgedAgent} cannot skip ${event.agent}'s ${event.outcome} at event ${event.seq}`,
      );
  }
  const judgedDecisions = judgedAgent
    ? decisions.filter((e) => e.agent === judgedAgent)
    : decisions;
  if (!main) {
    const judged = judgedDecisions.find((e) => !passing(e));
    return { judged, diverges: !!judged, setup };
  }
  const mainDecisions = decisionsOf(main.events).filter(
    (e) => !judgedAgent || e.agent === judgedAgent,
  );
  let judged = firstBranchDivergence(mainDecisions, judgedDecisions);
  if (judged) return { judged, diverges: true, setup };
  if (
    (!expectedOutcome || goes(expectedOutcome)) &&
    firstBranchDivergence(judgedDecisions, mainDecisions) &&
    witnessedRelease(main, branch, witness, judgedAgent)
  )
    return { diverges: true, setup };
  judged = firstStatementDifference(main, branch, judgedAgent);
  if (judged) return { judged, diverges: true, setup };
  if (hasNewTransportFault(main, branch)) return { diverges: true, setup };
  judged = changedAction(main, branch, decisionMatches(mainDecisions, judgedDecisions));
  return { judged, diverges: !!judged, setup };
}
