// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5

import { canonicalJson } from "../core/canonical.js";
import { LAYER_FEEDS } from "../suites/feeds.js";
import type { LayerId } from "../suites/registry.js";
import {
  type Check,
  INBOUND_CHECKS,
  OUTBOUND_CHECKS,
  type TraceEvent,
  type TraceFile,
} from "../trace/types.js";
import { addedStepProblem, matrixPrerequisite, matrixWorld } from "./matrix.js";
import { patch } from "./run.js";
import { type Scenario, scenarioSchema } from "./schema.js";

type Entry = Scenario["configurations"][number];

/** Brief 31 C1/C4: what a configuration adds is judged separately, never against the baseline. */
const ownEvents = (trace: TraceFile) => trace.events.filter((event) => !event.addedBy);

/** Filtering only fed checks lets those checks gain or lose verdicts without hiding other shifts. */
export function confinementDifferences(
  baseline: TraceFile,
  alternative: TraceFile,
  layer: LayerId,
): string[] {
  const fed = LAYER_FEEDS[layer];
  const rows = (trace: TraceFile) => {
    // Protocol exchanges add ordinary message admissions within the paid segment.
    // Outside that segment every unfed check must remain in exactly the same order.
    let payment = false;
    const events = ownEvents(trace).filter((event) => {
      if (event.segment === "payment") payment = true;
      const inside = payment;
      if (event.segmentEnd === "payment") payment = false;
      return layer !== "settlement" || !inside;
    });
    return events
      .filter((event) => event.kind === "check" && event.check && !fed.includes(event.check))
      .map((event) => ({
        agent: event.agent,
        gate: event.part,
        check: event.check,
        verdict: event.verdict,
        reason: event.reason ?? null,
      }));
  };
  const before = rows(baseline),
    after = rows(alternative),
    differences: string[] = [];
  for (let index = 0; index < Math.max(before.length, after.length); index++) {
    if (canonicalJson(before[index] ?? null) !== canonicalJson(after[index] ?? null))
      differences.push(
        `Check ${index + 1}: baseline ${JSON.stringify(before[index] ?? "missing")}; alternative ${JSON.stringify(after[index] ?? "missing")}`,
      );
  }
  const final = (trace: TraceFile) => {
    const events = ownEvents(trace);
    const decision = events.findLast((event) => event.kind === "decision");
    const message = events.findLast(
      (event) =>
        event.kind === "message-in" &&
        ["receipt", "refuse", "unsupported", "indeterminate"].includes(event.packet?.kind ?? ""),
    );
    const body = message?.packet?.layers.content.raw as
      | {
          outcome?: string;
          reason?: string;
          final?: boolean;
          observed?: { stage?: string; decided?: { status?: string } };
        }
      | undefined;
    return {
      gate: decision
        ? { agent: decision.agent, gate: decision.part, outcome: decision.outcome }
        : null,
      journey: message
        ? {
            agent: message.agent,
            kind: message.packet?.kind,
            outcome: body?.outcome ?? body?.reason ?? null,
            final: body?.final ?? null,
            stage: body?.observed?.stage ?? null,
            decision: body?.observed?.decided?.status ?? null,
          }
        : null,
    };
  };
  if (canonicalJson(final(baseline)) !== canonicalJson(final(alternative)))
    differences.push(
      `Final outcome: baseline ${JSON.stringify(final(baseline))}; alternative ${JSON.stringify(final(alternative))}`,
    );
  return differences;
}

/** The trace's added segments, in order: consecutive `addedBy` events split at each start. */
export function addedSegments(trace: Pick<TraceFile, "events">): TraceEvent[][] {
  const segments: TraceEvent[][] = [];
  let open: TraceEvent[] | undefined;
  for (const event of trace.events) {
    if (!event.addedBy) {
      open = undefined;
      continue;
    }
    if (!open || event.segment === "added") {
      open = [];
      segments.push(open);
    }
    open.push(event);
    if (event.segmentEnd === "added") open = undefined;
  }
  return segments;
}

// The gate's own ordered constants (brief 31 §3): the general outbound checks precede the
// payment checks in OUTBOUND_CHECKS; a payment release records both groups.
const GENERAL_OUTBOUND: readonly Check[] = OUTBOUND_CHECKS.slice(0, OUTBOUND_CHECKS.indexOf("P1"));
const PAYMENT_OUTBOUND: readonly Check[] = OUTBOUND_CHECKS.filter((check) => /^P\d$/.test(check));
const PASSING = new Set(["pass", "not-applicable"]);

/** Is `wanted` present, in order, among the first occurrences in `seen`? */
function inOrder(seen: readonly Check[], wanted: readonly Check[]): Check[] {
  const firsts = seen.filter((check, index) => seen.indexOf(check) === index);
  const missing = wanted.filter((check) => !firsts.includes(check));
  if (missing.length) return missing;
  const positions = wanted.map((check) => firsts.indexOf(check));
  return positions.every((at, index) => index === 0 || at > (positions[index - 1] ?? -1))
    ? []
    : [...wanted];
}

/**
 * Brief 31 C2 and C5 on a main path: every gate run inside each added segment records the
 * gate's whole ordered list of checks and passes each one (an "ask the principal" counts only
 * when the same agent's same check later passes after a principal reply in that segment);
 * each segment ends with the message its configuration declared.
 */
export function addedSegmentDifferences(
  trace: Pick<TraceFile, "events">,
  entry: Pick<Entry, "id" | "added">,
  parties: readonly Pick<Scenario["parties"][number], "id" | "traceId" | "runs">[] = [],
): string[] {
  const differences: string[] = [];
  const segments = addedSegments(trace);
  const foreign = trace.events.filter((event) => event.addedBy && event.addedBy !== entry.id);
  if (foreign.length)
    differences.push(`${foreign.length} event(s) are stamped by another configuration`);
  const added = entry.added ?? [];
  if (segments.length !== added.length)
    differences.push(
      `The trace has ${segments.length} added segment(s); ${entry.id} declares ${added.length}`,
    );
  const traceId = (slug: string) => parties.find((p) => p.id === slug)?.traceId ?? slug;
  // C2 judges agent gate runs. A party that runs no agent (the LocalForum is a mechanism,
  // judged by its own signed decision and the forum tests) records events in the gate parts
  // without being an agent gate; its events are not gate runs.
  const mechanisms = new Set(
    parties.filter((p) => p.runs !== undefined && p.runs !== "agent").map((p) => traceId(p.id)),
  );
  segments.forEach((events, index) => {
    const declared = added[index];
    const name = declared?.segment ?? `#${index + 1}`;
    if (!events[0]?.segment) differences.push(`Segment ${name}: its first event has no start mark`);
    // Gate runs: the checks one agent's gate records up to its decision.
    const pending = new Map<string, TraceEvent[]>();
    const runs: { agent: string; gate: string; checks: TraceEvent[]; decision: TraceEvent }[] = [];
    for (const event of events) {
      if (event.part !== "inbound-gate" && event.part !== "outbound-gate") continue;
      if (mechanisms.has(event.agent)) continue;
      const key = `${event.agent}|${event.part}`;
      if (event.kind === "check") pending.set(key, [...(pending.get(key) ?? []), event]);
      if (event.kind === "decision") {
        runs.push({
          agent: event.agent,
          gate: event.part,
          checks: pending.get(key) ?? [],
          decision: event,
        });
        pending.delete(key);
      }
    }
    for (const [key, left] of pending)
      if (left.length)
        differences.push(`Segment ${name}: ${key} records checks without a decision`);
    runs.forEach((run, at) => {
      const where = `Segment ${name}, ${run.agent} ${run.gate} run ${at + 1}`;
      const seen = run.checks.flatMap((event) => (event.check ? [event.check] : []));
      const wanted: Check[] =
        run.gate === "inbound-gate"
          ? [...INBOUND_CHECKS]
          : seen.some((check) => PAYMENT_OUTBOUND.includes(check))
            ? [...GENERAL_OUTBOUND, ...PAYMENT_OUTBOUND]
            : [...GENERAL_OUTBOUND];
      const general = wanted.filter((check) => !PAYMENT_OUTBOUND.includes(check));
      const payment = wanted.filter((check) => PAYMENT_OUTBOUND.includes(check));
      const asked = run.decision.outcome === "ask-principal";
      const askedAt = run.checks.find((event) => event.verdict === "ask-principal");
      if (asked) {
        // The ask is admitted only when this agent's same check later passes after a reply.
        const replied = events.findIndex(
          (event, i) =>
            i > events.indexOf(run.decision) &&
            event.agent === run.agent &&
            event.kind === "principal-reply",
        );
        const later = runs
          .slice(at + 1)
          .find(
            (next) =>
              next.agent === run.agent &&
              next.gate === run.gate &&
              events.indexOf(next.decision) > replied &&
              next.checks.some(
                (event) => event.check === askedAt?.check && event.verdict === "pass",
              ),
          );
        if (replied < 0 || !later || !askedAt)
          differences.push(
            `${where}: asks the principal at ${askedAt?.check ?? "an unnamed check"} without a later approved pass`,
          );
        const others = run.checks.filter(
          (event) => event !== askedAt && !PASSING.has(event.verdict ?? ""),
        );
        for (const event of others)
          differences.push(`${where}: ${event.check} ends ${event.verdict} (${event.reason})`);
        return;
      }
      for (const missing of [...inOrder(seen, general), ...inOrder(seen, payment)])
        differences.push(`${where}: check ${missing} is missing or out of order`);
      for (const check of new Set(seen)) {
        const last = run.checks.findLast((event) => event.check === check);
        // A repeated check (one per item) must pass every time it is recorded.
        const failing = run.checks.find(
          (event) => event.check === check && !PASSING.has(event.verdict ?? ""),
        );
        if (failing || !last)
          differences.push(
            `${where}: ${check} ends ${failing?.verdict ?? "unrecorded"} (${failing?.reason})`,
          );
      }
      if (!["admit", "go"].includes(run.decision.outcome ?? ""))
        differences.push(`${where}: the gate decided ${run.decision.outcome}`);
    });
    // C5: the segment's last message is the declared one.
    const messages = events.filter((event) => event.kind === "message-in" && event.packet);
    const last = messages.at(-1);
    if (!declared?.closes) {
      if (messages.length)
        differences.push(`Segment ${name}: carries messages but declares no closing message`);
      return;
    }
    if (!last) {
      differences.push(`Segment ${name}: no message closes it`);
      return;
    }
    const body = last.packet?.layers.content.raw as
      | { outcome?: string; reason?: string }
      | undefined;
    const admitted = runs.find(
      (run) =>
        run.agent === last.agent &&
        run.gate === "inbound-gate" &&
        events.indexOf(run.decision) > events.indexOf(last),
    );
    const actual = {
      agent: last.agent,
      kind: last.packet?.kind,
      outcome: body?.outcome ?? body?.reason ?? admitted?.decision.outcome ?? null,
    };
    const wanted = { ...declared.closes, agent: traceId(declared.closes.agent) };
    if (actual.kind === "refuse" || canonicalJson(actual) !== canonicalJson(wanted))
      differences.push(
        `Segment ${name}: closes with ${JSON.stringify(actual)}; declared ${JSON.stringify(wanted)}`,
      );
  });
  return differences;
}

/** A failure injection or test hook; none may be active on a configuration's main path. */
const FAULTS: readonly (readonly string[])[] = [
  ["settlementFault"],
  ["documentFaults"],
  ["evidenceFaults"],
  ["agreementCredentialFault"],
  ["authorityFault"],
  ["mandateStatusFault"],
  ["inject"],
  ["stopAfter"],
  ["solid", "fault"],
  ["carriage", "fault"],
  ["trustedIndex", "fork"],
  ["federation", "expired"],
  ["federation", "businessOnly"],
  ["originHosted", "pointerFault"],
];

/** The baseline items a configuration may only replace by name, keyed "<kind>:<id>". */
function items(world: Scenario): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const party of world.parties) {
    // The advertised configurations are the configuration's own wire choice, not a rule.
    const { configurations: _advertised, ...rest } = party;
    out.set(`party:${party.id}`, rest);
  }
  for (const statement of world.statements) out.set(`statement:${statement.id}`, statement);
  for (const step of world.script) out.set(`step:${step.id}`, step);
  for (const mandate of world.mandates) {
    for (const list of [
      "autonomous",
      "withApproval",
      "prohibitions",
      "standingRules",
      "duties",
    ] as const)
      (mandate[list] ?? []).forEach((rule, index) => {
        const id = typeof rule.id === "string" ? rule.id : `${index}`;
        out.set(`mandate:${mandate.agent}#${list}/${id}`, rule);
      });
    out.set(`mandate:${mandate.agent}#limits`, mandate.limits ?? null);
  }
  return out;
}

/**
 * Brief 31 C3 on a configuration's main path: the patch is additive. Every baseline party,
 * statement (with its terms), mandate rule and script step is canonically equal afterwards,
 * except the items the configuration lists in `replaces`; no fault or test hook is active.
 * With `requires`, the reference is the prerequisite's world.
 */
export function patchDifferences(scenario: Scenario, entry: Entry): string[] {
  const differences: string[] = [];
  let world: Scenario;
  let reference: Scenario;
  try {
    const prerequisite = matrixPrerequisite(scenario, entry);
    // Compare parsed worlds, as the engine runs them, so schema defaults never read as edits.
    reference = scenarioSchema.parse(prerequisite ? patch(scenario, prerequisite.world) : scenario);
    world = scenarioSchema.parse(matrixWorld(scenario, entry));
  } catch (error) {
    return [`Patch refused: ${(error as Error).message}`];
  }
  const problem = addedStepProblem(reference.script, world.script, entry);
  if (problem) differences.push(problem);
  const replaces = entry.replaces ?? [];
  if ("transport" in entry.change && replaces.length)
    differences.push("A transport configuration may replace nothing");
  const before = items(reference),
    after = items(world);
  const changed = new Set<string>();
  for (const [id, value] of before) {
    const now = after.get(id);
    if (now === undefined || canonicalJson(value) !== canonicalJson(now)) changed.add(id);
  }
  for (const id of changed)
    if (!replaces.includes(id))
      differences.push(`${id} changes but ${entry.id} does not list it in replaces`);
  for (const id of replaces)
    if (!changed.has(id)) differences.push(`${id} is listed in replaces but does not change`);
  // New script steps must keep the baseline order of the steps they surround.
  const order = (script: Scenario["script"]) =>
    script.map((step) => step.id).filter((id) => before.has(`step:${id}`));
  if (canonicalJson(order(world.script)) !== canonicalJson(order(reference.script)))
    differences.push("The patch reorders baseline script steps");
  for (const path of FAULTS) {
    const read = (value: unknown) =>
      path.reduce<unknown>(
        (at, key) =>
          at && typeof at === "object" ? (at as Record<string, unknown>)[key] : undefined,
        value,
      ) ?? null;
    if (canonicalJson(read(world)) !== canonicalJson(read(reference)))
      differences.push(`${path.join(".")} is active on the main path`);
  }
  return differences;
}
