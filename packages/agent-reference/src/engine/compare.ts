// AUTHORED-BY Codex GPT-6.2 Sol
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
        (e.reason === undefined
          ? undefined
          : events.findLast(
              (c) =>
                c.seq < e.seq && c.kind === "check" && c.reason === e.reason && sameGateRun(c, e),
            )?.check),
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
function* orderedMatches<T>(
  main: readonly T[],
  branch: readonly T[],
  equal: (candidate: T, event: T) => boolean,
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

const sameDecision = (a: TraceEvent, b: TraceEvent) => sameCheck(a, b) && a.outcome === b.outcome;

const decisionMatches = (main: readonly TraceEvent[], branch: readonly TraceEvent[]) =>
  orderedMatches(main, branch, sameDecision);

const sameGateRun = (a: TraceEvent, b: TraceEvent) =>
  a.gateRun !== undefined && a.gateRun === b.gateRun && a.agent === b.agent && a.part === b.part;

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

export interface ComparisonStep {
  readonly id: string;
  readonly descriptor: StepDescriptor;
}

export interface ComparisonRun {
  readonly events: readonly TraceEvent[];
  /** Keyed by event sequence because multiple script steps can share a trace step number. */
  readonly steps?: ReadonlyMap<number, ComparisonStep>;
  readonly effectReleases?: ReadonlySet<number>;
  readonly effectSupport?: ReadonlyMap<number, readonly string[]>;
  readonly approvedAsks?: ReadonlySet<number>;
}

interface DecisionWitness {
  readonly outcome: string;
  readonly check: string;
  readonly reason: string;
}

function witnessCheck(
  events: readonly TraceEvent[],
  decision: TraceEvent,
  witness: DecisionWitness,
) {
  return events.some(
    (check) =>
      check.seq < decision.seq &&
      check.kind === "check" &&
      check.check === witness.check &&
      check.reason === witness.reason &&
      sameGateRun(check, decision) &&
      (!goes(witness.outcome) || check.verdict === "pass"),
  );
}

function laterRelease(run: ComparisonRun, admission: TraceEvent) {
  return run.events.some(
    (release) =>
      release.seq > admission.seq &&
      release.agent === admission.agent &&
      release.part === "outbound-gate" &&
      release.kind === "decision" &&
      release.outcome === "go" &&
      (run.effectReleases?.has(release.seq) ||
        (release.messageId !== undefined &&
          release.gateRun !== undefined &&
          run.events.some(
            (out) =>
              out.seq > release.seq &&
              out.agent === release.agent &&
              out.kind === "message-out" &&
              out.messageId === release.messageId &&
              out.gateRun === release.gateRun,
          ))),
  );
}

export function witnessedDecision(
  run: ComparisonRun,
  witness: DecisionWitness,
  agent?: string,
): TraceEvent | undefined {
  return run.events.find(
    (decision) =>
      decision.kind === "decision" &&
      (!agent || decision.agent === agent) &&
      comparisonOutcome(decision.outcome) === comparisonOutcome(witness.outcome) &&
      witnessCheck(run.events, decision, witness) &&
      (witness.outcome !== "go" ||
        decision.outcome !== "admit" ||
        (decision.part === "inbound-gate" && laterRelease(run, decision))),
  );
}

function boundReleaseDecision(run: ComparisonRun, witness: DecisionWitness, agent?: string) {
  const { events } = run;
  const direct = events.find(
    (decision) =>
      decision.kind === "decision" &&
      decision.outcome === witness.outcome &&
      (!agent || decision.agent === agent) &&
      witnessCheck(events, decision, witness),
  );
  if (direct || witness.outcome !== "go") return direct;

  // A completed effect can witness a prior inbound check by using the item that gate admitted.
  return events.find((release) => {
    if (
      release.kind !== "decision" ||
      release.outcome !== "go" ||
      !run.effectReleases?.has(release.seq) ||
      (agent && release.agent !== agent)
    )
      return false;
    const support = run.effectSupport?.get(release.seq);
    if (!support?.length) return false;
    return events.some((store) => {
      if (
        store.seq >= release.seq ||
        store.agent !== release.agent ||
        store.kind !== "store" ||
        !store.fact ||
        !support.includes(store.fact.id)
      )
        return false;
      const step = run.steps?.get(store.seq);
      const admission = events.findLast(
        (event) =>
          event.seq < store.seq &&
          event.agent === store.agent &&
          event.part === "inbound-gate" &&
          event.kind === "decision",
      );
      return (
        admission?.outcome === "admit" &&
        admission.gateRun !== undefined &&
        !!step &&
        step.id === run.steps?.get(admission.seq)?.id &&
        witnessCheck(events, admission, witness)
      );
    });
  });
}

function witnessedRelease(
  main: ComparisonRun,
  branch: ComparisonRun,
  witness: DecisionWitness | undefined,
  judgedAgent: string | undefined,
) {
  if (!witness || !goes(witness.outcome)) return undefined;
  const decision = boundReleaseDecision(branch, witness, judgedAgent);
  if (!decision) return undefined;
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
  const released = branch.events.some((event, index) => {
    if (event.agent !== decision.agent) return false;
    const afterSplit = split >= 0 && index >= split;
    return (
      (event.seq > decision.seq && event.kind === "message-out" && afterSplit) ||
      (event.seq >= decision.seq &&
        branch.effectReleases?.has(event.seq) &&
        (afterSplit || !main.effectReleases?.has(event.seq)))
    );
  });
  return released ? decision : undefined;
}

const superseded = "superseded-by-better-source";
const withheld = (e: TraceEvent) =>
  e.part === "inbound-gate" &&
  e.kind === "check" &&
  e.reason !== undefined &&
  (["fail", "indeterminate", "ask-more", "ask-principal"].includes(e.verdict ?? "") ||
    e.reason === superseded);

function admittedStatementChecks(run: ComparisonRun, judgedAgent: string | undefined) {
  const admissions = run.events.filter(
    (event) =>
      event.part === "inbound-gate" &&
      event.kind === "decision" &&
      event.outcome === "admit" &&
      event.gateRun !== undefined &&
      (!judgedAgent || event.agent === judgedAgent),
  );
  return run.events.flatMap((check) => {
    const gateRun = check.gateRun;
    if (!withheld(check) || gateRun === undefined) return [];
    const step = run.steps?.get(check.seq);
    // Standalone admissions record precedence after the last individual admission.
    const admission =
      check.reason === superseded && step?.descriptor.type === "admit"
        ? admissions.findLast(
            (event) =>
              event.seq < check.seq &&
              event.agent === check.agent &&
              event.gateRun === gateRun - 1 &&
              run.steps?.get(event.seq)?.id === step.id,
          )
        : admissions.find((event) => event.seq > check.seq && sameGateRun(check, event));
    return admission ? [{ check, admission }] : [];
  });
}

function firstStatementDifference(main: ComparisonRun, branch: ComparisonRun, agent?: string) {
  const matches = orderedMatches(
    admittedStatementChecks(main, agent),
    admittedStatementChecks(branch, agent),
    (a, b) => sameCheck(a.check, b.check) && a.check.verdict === b.check.verdict,
  );
  for (const [{ check, admission }, match] of matches) {
    if (!match)
      return { ...check, seq: Math.max(check.seq, admission.seq), outcome: "admit" as const };
  }
  return undefined;
}

/** A scoped stop permits subsequent releases only after their own gate decision. */
export function continuedReleaseProblem(stop: TraceEvent, later: readonly TraceEvent[]): boolean {
  if (!stop.actionDigest || !stop.actionScope) return true;
  const rejected = stop.actionScope;
  const allowed = new Map<number, TraceEvent>();
  for (const event of later) {
    if (event.agent !== stop.agent || event.part !== "outbound-gate" || event.outcome !== "go")
      continue;
    const action = event.actionScope;
    if (!action || !event.actionDigest || event.actionDigest === stop.actionDigest) return true;
    if (
      action.conversation === rejected.conversation &&
      action.action === rejected.action &&
      action.operation === rejected.operation &&
      (action.target !== rejected.target ||
        !action.otherParametersDigest ||
        action.otherParametersDigest !== rejected.otherParametersDigest ||
        action.recipient !== rejected.recipient ||
        action.purpose !== rejected.purpose ||
        new Set(action.evidence).size >= new Set(rejected.evidence).size ||
        action.evidence.some((item) => !rejected.evidence.includes(item)))
    )
      return true;
    if (event.gateRun !== undefined) allowed.set(event.gateRun, event);
  }
  return later.some((event) => {
    if (event.agent !== stop.agent) return false;
    if (event.kind === "store") {
      const preceding = later.findLast(
        (candidate) =>
          candidate.agent === event.agent &&
          candidate.kind === "decision" &&
          candidate.step === event.step &&
          candidate.seq < event.seq,
      );
      return (
        !preceding ||
        !(
          (preceding.part === "inbound-gate" && preceding.outcome === "admit") ||
          (preceding.gateRun !== undefined && allowed.get(preceding.gateRun) === preceding)
        )
      );
    }
    if (event.kind !== "message-out") return false;
    const release = event.gateRun === undefined ? undefined : allowed.get(event.gateRun);
    return (
      !release ||
      release.seq >= event.seq ||
      release.messageId !== event.messageId ||
      !release.messageDigest ||
      release.messageDigest !== event.packet?.layers.header.digest ||
      release.actionDigest !== event.actionDigest
    );
  });
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
  decision: TraceEvent,
  match: TraceEvent,
) {
  const before = main.steps?.get(match.seq)?.descriptor;
  const after = branch.steps?.get(decision.seq)?.descriptor;
  return !!before && !!after && JSON.stringify(before) !== JSON.stringify(after);
}

type DecisionMatch = readonly [TraceEvent, TraceEvent | undefined];

function deniedAsk(
  main: ComparisonRun,
  branch: ComparisonRun,
  matches: readonly DecisionMatch[],
  denial: TraceEvent,
) {
  if (
    denial.part !== "outbound-gate" ||
    denial.outcome !== "stop" ||
    denial.reason !== "approval-denied" ||
    !denial.actionDigest
  )
    return undefined;
  const reply = branch.events.findLast(
    (event) =>
      event.seq < denial.seq &&
      event.agent === denial.agent &&
      event.kind === "principal-reply" &&
      event.actionDigest === denial.actionDigest,
  );
  if (reply?.approvalDecision !== "deny") return undefined;
  const ask = matches.findLast(
    ([event]) =>
      event.seq < reply.seq &&
      event.agent === denial.agent &&
      event.part === "outbound-gate" &&
      event.outcome === "ask-principal" &&
      event.actionDigest === denial.actionDigest,
  );
  return ask?.[1] && changedAction(main, branch, ask[0], ask[1]) ? ask[0] : undefined;
}

/** Longest common subsequence of passing decisions, including the originating script step. */
function alignPassing(
  main: ComparisonRun,
  branch: ComparisonRun,
  before: TraceEvent[],
  after: TraceEvent[],
) {
  const equal = (a: TraceEvent | undefined, b: TraceEvent | undefined) => {
    if (!a || !b || !sameDecision(a, b)) return false;
    const id = main.steps?.get(a.seq)?.id;
    return id !== undefined && id === branch.steps?.get(b.seq)?.id;
  };
  const width = after.length + 1;
  const lengths = new Uint32Array((before.length + 1) * width);
  const lengthAt = (i: number, j: number) => lengths[i * width + j] ?? 0;
  for (let i = before.length - 1; i >= 0; i--)
    for (let j = after.length - 1; j >= 0; j--)
      lengths[i * width + j] = equal(before[i], after[j])
        ? lengthAt(i + 1, j + 1) + 1
        : Math.max(lengthAt(i + 1, j), lengthAt(i, j + 1));

  const aligned = new Map<number, TraceEvent>();
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    const a = before[i];
    const b = after[j];
    if (a && b && equal(a, b)) {
      aligned.set(b.seq, a);
      i++;
      j++;
    } else if (lengthAt(i + 1, j) >= lengthAt(i, j + 1)) i++;
    else j++;
  }
  return aligned;
}

function prefixGuard(
  main: ComparisonRun,
  branch: ComparisonRun,
  mainDecisions: TraceEvent[],
  prefix: TraceEvent[],
  changedSteps: ReadonlySet<string>,
  boundary: TraceEvent | undefined,
  permissive: boolean,
) {
  const releases = prefix.filter(passing);
  const aligned = alignPassing(main, branch, mainDecisions.filter(passing), releases);
  const setup = releases.filter((event) => !aligned.has(event.seq));
  const unexplained = setup.find(
    (event) => !changedSteps.has(branch.steps?.get(event.seq)?.id ?? ""),
  );
  if (permissive) return { setup, failure: unexplained };

  const mainBars = mainDecisions.filter((event) => !passing(event));
  const branchBars = prefix.filter((event) => !passing(event));
  const changed = branchBars.find((event, i) => {
    const expected = mainBars[i];
    return !expected || !sameDecision(expected, event);
  });
  // Inspect only the main prefix reached before judgement. Extra branch releases do not
  // advance this positional boundary, and a shared step can appear much later on main.
  const comparable = prefix.filter((event) => !passing(event) || aligned.has(event.seq));
  const mainPrefix = boundary
    ? mainDecisions.filter((event) => event.seq < boundary.seq)
    : mainDecisions.slice(0, comparable.length);
  const missing = mainPrefix.filter((event) => !passing(event))[branchBars.length];
  const skipped = missing && (comparable[mainPrefix.indexOf(missing)] ?? missing);
  const failure = [unexplained, changed, skipped]
    .filter((event) => event !== undefined)
    .sort((a, b) => a.seq - b.seq)[0];
  return { setup, failure };
}

export function compareBranch(
  main: ComparisonRun | undefined,
  branch: ComparisonRun,
  options: {
    judgedAgent?: string;
    witness?: DecisionWitness;
    expectedOutcome?: string;
    changedSteps?: ReadonlySet<string>;
  } = {},
): {
  judged?: TraceEvent;
  diverges: boolean;
  failure?: TraceEvent;
  denial?: TraceEvent;
  setup: TraceEvent[];
} {
  const { judgedAgent, witness, expectedOutcome, changedSteps } = options;
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
  const judgedDecisions = decisions.filter((e) => !judgedAgent || e.agent === judgedAgent);
  if (!main) {
    const judged = judgedDecisions.find((e) => !passing(e)) ?? judgedDecisions.at(-1);
    return { judged, diverges: !!judged, setup };
  }
  const mainDecisions = decisionsOf(main.events).filter(
    (e) => !judgedAgent || e.agent === judgedAgent,
  );
  const matches = [...decisionMatches(mainDecisions, judgedDecisions)];
  const difference = matches.find(([event, match]) => !match && !passing(event))?.[0];
  const ask = difference && deniedAsk(main, branch, matches, difference);
  const permissive =
    !difference &&
    (!expectedOutcome || goes(expectedOutcome)) &&
    [...decisionMatches(judgedDecisions, mainDecisions)].some(
      ([event, match]) => !match && !passing(event),
    )
      ? witnessedRelease(main, branch, witness, judgedAgent)
      : undefined;
  const statement =
    !difference && !permissive ? firstStatementDifference(main, branch, judgedAgent) : undefined;
  const fault = !difference && !permissive && !statement && hasNewTransportFault(main, branch);
  const action =
    !difference && !permissive && !statement && !fault
      ? matches.find(
          ([event, match]) => match && !passing(event) && changedAction(main, branch, event, match),
        )?.[0]
      : undefined;
  const prefixEnd = ask ?? difference ?? permissive ?? action;
  const judged = ask ?? difference ?? statement ?? action;
  if (!changedSteps)
    return {
      judged,
      diverges: !!(judged || permissive || fault),
      denial: ask ? difference : undefined,
      setup,
    };
  const boundary = prefixEnd && matches.find(([event]) => event === prefixEnd)?.[1];
  const guarded = prefixGuard(
    main,
    branch,
    mainDecisions,
    judgedDecisions.filter((event) => !prefixEnd || event.seq < prefixEnd.seq),
    changedSteps,
    boundary,
    !!permissive,
  );
  return {
    judged,
    diverges: !!(judged || permissive || fault),
    failure: guarded.failure,
    denial: ask ? difference : undefined,
    setup: [...setup, ...guarded.setup].sort((a, b) => a.seq - b.seq),
  };
}
