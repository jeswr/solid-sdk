// AUTHORED-BY Codex GPT-6.2 Sol
// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import {
  compareBranch,
  continuedReleaseProblem,
  describeStep,
  stoppedReleaseProblem,
  witnessedDecision,
} from "../src/engine/compare.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import type { PacketView, TraceEvent } from "../src/trace/types.js";

const root = new URL("../", import.meta.url).pathname;

function decision(reason = "approval-required", seq = 1): TraceEvent {
  return {
    seq,
    step: 1,
    agent: "agent",
    part: "outbound-gate",
    kind: "decision",
    check: "limits-approval",
    outcome: "ask-principal",
    reason,
    caption: "Decision.",
  };
}
it("uses the first unmatched bar with ordered, consuming matches", () => {
  const shared = decision();
  const changed = decision("not-authorised", 2);
  const main = { events: [shared] };
  expect(compareBranch(main, { events: [shared, changed] }).judged).toEqual(changed);
  expect(compareBranch(main, { events: [changed] }).judged).toEqual(changed);
  expect(compareBranch(main, { events: [shared, decision(undefined, 2)] }).judged?.seq).toBe(2);
  expect(compareBranch(main, main).diverges).toBe(false);
});

it("rejects the same stopped proposal even when expect.continues is set", () => {
  const actionScope = {
    action: "distribute",
    operation: "urn:operation",
    target: "urn:operation",
    conversation: "urn:conversation",
    recipient: "urn:recipient",
    purpose: "urn:purpose",
    evidence: ["urn:one", "urn:two"],
    otherParametersDigest: "unchanged",
  };
  const stop = {
    ...decision("prohibited"),
    outcome: "stop" as const,
    actionDigest: "stopped",
    actionScope,
  };
  const release = {
    ...decision("released", 2),
    outcome: "go" as const,
    gateRun: 2,
    actionScope,
    actionDigest: "stopped",
  };
  expect(continuedReleaseProblem(stop, [release])).toBe(true);
  expect(
    continuedReleaseProblem(stop, [
      {
        ...release,
        actionDigest: "broadened-retention",
        actionScope: { ...actionScope, evidence: ["urn:one"], otherParametersDigest: "broader" },
      },
    ]),
  ).toBe(true);
  const store = { ...release, part: "memory" as const, kind: "store" as const };
  expect(continuedReleaseProblem(stop, [store])).toBe(true);
  expect(
    continuedReleaseProblem(stop, [
      {
        ...release,
        actionDigest: "narrower",
        actionScope: { ...actionScope, evidence: ["urn:one"] },
      },
    ]),
  ).toBe(false);
});

it("reports a strict prefix without a divergence", () => {
  expect(
    compareBranch(
      { events: [decision(), decision("later", 2)] },
      { events: [decision()] },
      { changedSteps: new Set() },
    ).diverges,
  ).toBe(false);
});

const accepted = (seq: number, outcome: "go" | "admit" = "go"): TraceEvent => ({
  ...decision(undefined, seq),
  part: outcome === "go" ? "outbound-gate" : "inbound-gate",
  check: undefined,
  gateRun: 1,
  reason: undefined,
  outcome,
});
const checked = (seq: number, extra: Partial<TraceEvent> = {}): TraceEvent => ({
  seq,
  step: 1,
  kind: "check",
  agent: "agent",
  part: "inbound-gate",
  check: "source",
  gateRun: 1,
  verdict: "pass",
  reason: "source-accepted",
  caption: "",
  ...extra,
});

const refusedId = "urn:statement:refused";
const acceptedId = "urn:statement:accepted";
const refusal: TraceEvent = { ...accepted(2, "admit"), outcome: "refuse" };
const laterAdmit: TraceEvent = { ...accepted(3, "admit"), gateRun: 2 };
const stored = {
  ...checked(4),
  part: "memory",
  kind: "store",
  fact: {
    id: acceptedId,
    claimType: "test.claim",
    label: "Test statement",
    subject: "urn:subject",
    value: true,
    source: "urn:source",
  },
} satisfies TraceEvent;
const gated = {
  ...accepted(5),
  gateRun: 3,
  messageId: "urn:message",
  messageDigest: "message-digest",
  actionScope: {
    action: "distribute",
    operation: "urn:operation",
    target: "urn:operation",
    conversation: "urn:conversation",
    evidence: [acceptedId],
  },
} satisfies TraceEvent;

function packetWithStatement(id: string): PacketView {
  const layer = { present: false, summary: "" };
  return {
    id: "urn:message",
    from: "agent",
    to: "peer",
    kind: "deliver",
    carriage: { suite: "direct-http", summary: "" },
    layers: {
      header: { present: true, summary: "", digest: "message-digest" },
      authority: layer,
      content: layer,
      evidence: { present: true, summary: "", raw: [{ id }] },
      terms: layer,
      provenance: layer,
    },
  };
}

const sent: TraceEvent = {
  ...checked(6),
  part: "transport",
  kind: "message-out",
  gateRun: 3,
  messageId: "urn:message",
  packet: packetWithStatement(acceptedId),
};

function afterRefusal(later: TraceEvent[], first = checked(1), stop = refusal) {
  return stoppedReleaseProblem(
    {
      events: [first, stop, ...later],
      standaloneRefusals: new Map([[stop.seq, refusedId]]),
    },
    stop,
    "stop",
  );
}

it("allows separately admitted stores and a gated send after a standalone refusal", () => {
  expect(afterRefusal([laterAdmit, stored, gated, sent])).toBe(false);
});

it("rejects a store before the next inbound decision or without an admit in its trace step", () => {
  expect(
    afterRefusal([
      { ...stored, seq: 3 },
      { ...laterAdmit, seq: 4 },
    ]),
  ).toBe(true);
  expect(afterRefusal([laterAdmit, { ...stored, step: 2 }])).toBe(true);
  expect(afterRefusal([{ ...gated, seq: 3 }, stored])).toBe(true);
  expect(afterRefusal([laterAdmit, { ...gated, seq: 4, step: 2 }, { ...stored, seq: 5 }])).toBe(
    true,
  );
});

it("rejects a store or send carrying the refused statement despite its own gate decision", () => {
  expect(afterRefusal([laterAdmit, { ...stored, fact: { ...stored.fact, id: refusedId } }])).toBe(
    true,
  );
  expect(afterRefusal([gated, { ...sent, packet: packetWithStatement(refusedId) }])).toBe(true);
});

it("requires a preceding go for the send's gate run, message ID and digest", () => {
  expect(afterRefusal([sent])).toBe(true);
  expect(afterRefusal([{ ...gated, gateRun: 2 }, sent])).toBe(true);
  expect(afterRefusal([{ ...gated, messageId: "urn:other" }, sent])).toBe(true);
  expect(afterRefusal([{ ...gated, messageDigest: "other-digest" }, sent])).toBe(true);
  expect(afterRefusal([sent, { ...gated, seq: 7 }])).toBe(true);
});

it("rejects citations in outbound go scope and in completed effect support", () => {
  expect(
    afterRefusal([{ ...gated, actionScope: { ...gated.actionScope, evidence: [refusedId] } }]),
  ).toBe(true);
  const effect = { ...gated, effectRelease: true, messageId: undefined, messageDigest: undefined };
  expect(afterRefusal([effect])).toBe(false);
  expect(
    stoppedReleaseProblem(
      {
        events: [checked(1), refusal, effect],
        standaloneRefusals: new Map([[refusal.seq, refusedId]]),
        effectSupport: new Map([[effect.seq, [refusedId]]]),
      },
      refusal,
      "stop",
    ),
  ).toBe(true);
});

it("keeps the blanket check for a refused message and an outbound stop", () => {
  const received = checked(1, { part: "transport", kind: "message-in", gateRun: refusal.gateRun });
  const stopped = { ...refusal, part: "outbound-gate", outcome: "stop" } as const;
  for (const followUp of [
    [laterAdmit, stored],
    [gated, sent],
  ]) {
    expect(afterRefusal(followUp, received)).toBe(true);
    expect(afterRefusal(followUp, checked(1), stopped)).toBe(true);
  }
  expect(afterRefusal([laterAdmit, stored, gated, sent], { ...received, agent: "peer" })).toBe(
    false,
  );
});

it("reports a permissive branch only when a missing main bar is followed by a witnessed release", () => {
  const check = checked(1, { part: "outbound-gate" });
  const ask = { ...decision("evidence-missing", 3), outcome: "ask-more" } as const;
  const main = { events: [ask] };
  const branch = { events: [check, accepted(2)], effectReleases: new Set([2]) };
  const outbound = {
    events: [
      ...branch.events,
      { ...check, seq: 3, part: "transport", kind: "message-out" } as const,
    ],
  };
  const witness = { outcome: "go", check: "source", reason: "source-accepted" } as const;
  expect(compareBranch(main, branch, { witness }).diverges).toBe(true);
  expect(
    compareBranch(
      main,
      {
        ...branch,
        events: [
          { ...check, gateRun: 1 },
          { ...accepted(2), gateRun: 2 },
        ],
      },
      { witness },
    ).diverges,
  ).toBe(false);
  expect(compareBranch(main, branch, { witness: { ...witness, outcome: "stop" } }).diverges).toBe(
    false,
  );
  expect(
    compareBranch({ events: [...branch.events, ask] }, { events: branch.events }, { witness })
      .diverges,
  ).toBe(false);
  expect(compareBranch({ events: branch.events }, branch, { witness }).diverges).toBe(false);
  expect(compareBranch(main, outbound, { witness }).diverges).toBe(true);
  expect(
    compareBranch({ events: [...outbound.events, { ...ask, seq: 4 }] }, outbound, { witness })
      .diverges,
  ).toBe(false);
});

it("judges a statement failure in an admitted inbound run and consumes main matches", () => {
  const fail = checked(1, { verdict: "fail", reason: "source-unknown" });
  const branch = { events: [fail, accepted(2, "admit")] };
  expect(compareBranch({ events: [] }, branch).judged).toMatchObject({
    outcome: "admit",
    check: "source",
    reason: "source-unknown",
  });
  expect(compareBranch(branch, branch).diverges).toBe(false);
  expect(
    compareBranch(branch, {
      events: [
        ...branch.events,
        { ...fail, seq: 3, gateRun: 2 },
        { ...accepted(4, "admit"), gateRun: 2 },
      ],
    }).judged?.seq,
  ).toBe(4);
  expect(
    compareBranch(
      { events: [] },
      {
        events: [checked(1, { check: "fitness", reason: "fit-for-use" }), accepted(2, "admit")],
      },
    ).diverges,
  ).toBe(false);
  expect(
    compareBranch(
      { events: [] },
      {
        events: [checked(1, { part: "outbound-gate", verdict: "ask-principal" }), accepted(2)],
      },
    ).diverges,
  ).toBe(false);
});

it("does not consume a failure from a refusing run or a check without a run identity", () => {
  const fail = checked(1, { verdict: "fail", reason: "source-unknown" });
  const admit = accepted(2, "admit");
  const refusal = { ...admit, outcome: "refuse" as const, reason: "source-unknown" };
  const branch = { events: [fail, admit] };
  expect(compareBranch({ events: [fail, refusal] }, branch).judged).toMatchObject({
    outcome: "admit",
    reason: "source-unknown",
    check: "source",
  });
  expect(compareBranch({ events: [fail, admit] }, branch).diverges).toBe(false);
  expect(
    compareBranch({ events: [] }, { events: [{ ...fail, gateRun: undefined }, admit] }).diverges,
  ).toBe(false);
});

it("keeps interleaved inbound checks with the decisions of their own runs", () => {
  const refused = checked(1, { gateRun: 2, verdict: "fail", reason: "evidence-invalid" });
  const withheld = checked(2, { verdict: "indeterminate", reason: "lookup-failed" });
  const admit = accepted(4, "admit");
  const refusal = {
    ...admit,
    seq: 3,
    gateRun: 2,
    outcome: "refuse" as const,
    reason: "evidence-invalid",
  };
  expect(
    compareBranch(
      { events: [{ ...refused, seq: 2 }, refusal, admit] },
      { events: [refused, withheld, refusal, admit] },
    ).judged,
  ).toMatchObject({ seq: 4, outcome: "admit", reason: "lookup-failed" });
});

it("reports statement precedence after the standalone admission and keeps the verdict", () => {
  const admit = accepted(1, "admit");
  const superseded = checked(2, {
    gateRun: 2,
    check: "fitness",
    reason: "superseded-by-better-source",
  });
  const step = {
    id: "admit",
    descriptor: describeStep({
      type: "admit",
      id: "admit",
      agent: "agent",
      purpose: "urn:purpose:test",
      statements: [],
    }),
  };
  const steps = new Map([
    [1, step],
    [2, step],
  ]);
  expect(
    compareBranch({ events: [admit], steps }, { events: [admit, superseded], steps }).judged,
  ).toMatchObject({
    outcome: "admit",
    check: "fitness",
    reason: "superseded-by-better-source",
  });
});

it("requires a fault-bearing transport record that is absent from main", () => {
  const base = { ...checked(1), kind: "record", part: "transport" } as const;
  const fault = { ...base, fault: "fault-in-test" };
  expect(compareBranch({ events: [] }, { events: [fault] }).diverges).toBe(true);
  expect(compareBranch({ events: [fault] }, { events: [fault] }).diverges).toBe(false);
  expect(compareBranch({ events: [] }, { events: [base] }).diverges).toBe(false);
  expect(
    compareBranch(
      { events: [] },
      {
        events: [{ ...fault, part: "core" }],
      },
    ).diverges,
  ).toBe(false);
});

it("judges a bar before a transport fault and reaches A3 on a strict prefix", () => {
  const options = { changedSteps: new Set<string>() };
  const go = accepted(1);
  const fault = checked(2, { kind: "record", part: "transport", fault: "fault-in-test" });
  const stop = { ...decision("not-authorised", 3), outcome: "stop" } as const;
  const steps = new Map([[go.seq, { id: "go", descriptor: { type: "start", items: [] } }]]);
  const main = { events: [go], steps };
  expect(compareBranch(main, { events: [go, fault, stop], steps }, options)).toMatchObject({
    judged: stop,
    diverges: true,
    setup: [],
  });
  const prefix = compareBranch(
    { events: [go, stop], steps },
    { events: [go, fault], steps },
    options,
  );
  expect(prefix).toMatchObject({ diverges: true, setup: [] });
  expect(prefix.judged).toBeUndefined();
  expect(prefix.failure).toBeUndefined();
});

it("fails the guard when a main bar disappears before a shared release", () => {
  const go = accepted(2);
  const stop = { ...decision("not-authorised", 3), outcome: "stop" } as const;
  const steps = new Map([[go.seq, { id: "go", descriptor: { type: "start", items: [] } }]]);
  expect(
    compareBranch(
      { events: [decision(), go], steps },
      { events: [go, stop], steps },
      { changedSteps: new Set() },
    ),
  ).toMatchObject({ judged: stop, failure: go, setup: [] });
});

it.each([false, true])("requires the extra go to come from a changed step (%s)", (changed) => {
  const go = accepted(1);
  const extra = accepted(2);
  const stop = { ...decision("not-authorised", 3), outcome: "stop" } as const;
  const step = { id: "share", descriptor: { type: "start", items: [] } };
  const extraStep = { ...step, id: "extra" };
  const comparison = compareBranch(
    { events: [go], steps: new Map([[1, step]]) },
    {
      events: [extra, { ...go, seq: 4 }, { ...stop, seq: 5 }],
      steps: new Map([
        [2, extraStep],
        [4, step],
      ]),
    },
    { changedSteps: new Set(changed ? [extraStep.id] : []) },
  );
  expect(comparison).toMatchObject({ judged: { seq: 5 }, setup: [extra] });
  expect(comparison.failure).toEqual(changed ? undefined : extra);
});

it.each([
  ["accept", "approval-denied", true],
  ["review", "approval-denied", false],
  ["accept", "not-authorised", false],
] as const)("judges the denied question only when its descriptor changed (%s, %s)", (action, reason, judgesAsk) => {
  const ask = { ...decision(), actionDigest: "proposal" };
  const reply = checked(2, {
    part: "principal",
    kind: "principal-reply",
    approvalDecision: "deny",
    actionDigest: "proposal",
  });
  const stop = { ...decision(reason, 3), actionDigest: "proposal", outcome: "stop" } as const;
  const step = (decision: string) => ({
    id: "effect",
    descriptor: { type: "effect", items: [], decision },
  });
  const result = compareBranch(
    { events: [ask], steps: new Map([[1, step("review")]]) },
    { events: [ask, reply, stop], steps: new Map([[1, step(action)]]) },
  );
  expect(result.judged).toEqual(judgesAsk ? ask : stop);
  expect(result.denial).toEqual(judgesAsk ? stop : undefined);
});

it("binds witnesses to a single gate run and requires a release for inbound go", () => {
  const witness = { outcome: "go", check: "source", reason: "source-accepted" };
  const check = checked(1);
  const admit = accepted(2, "admit");
  const go = { ...accepted(3), messageId: "answer" };
  const out = checked(4, { part: "transport", kind: "message-out", messageId: "answer" });
  expect(witnessedDecision({ events: [check, admit, go, out] }, witness)).toBe(admit);
  expect(witnessedDecision({ events: [check, admit] }, witness)).toBeUndefined();
  expect(
    witnessedDecision({ events: [check, admit, go, out] }, { ...witness, outcome: "admit" }),
  ).toBe(admit);
  expect(
    witnessedDecision({ events: [check, { ...admit, gateRun: 2 }, go, out] }, witness),
  ).toBeUndefined();
  expect(
    witnessedDecision({ events: [{ ...check, verdict: "fail" }, admit, go, out] }, witness),
  ).toBeUndefined();
  const refused = { ...admit, outcome: "refuse" as const };
  expect(witnessedDecision({ events: [check, refused] }, { ...witness, outcome: "stop" })).toBe(
    refused,
  );
});

it("judges a matched answer about a different action and ignores ordering and run data", () => {
  const proposal = {
    type: "effect" as const,
    id: "effect",
    agent: "agent",
    activityType: "urn:activity:test",
    intent: {
      conversation: "urn:conversation:one",
      parameters: { support: ["a", "b"], digest: "one" },
    },
    params: { decision: "review" },
  };
  const run = (step: typeof proposal) => ({
    events: [decision()],
    steps: new Map([[1, { id: step.id, descriptor: describeStep(step) }]]),
  });
  const main = run(proposal);
  expect(compareBranch(main, main).diverges).toBe(false);
  expect(
    compareBranch(
      main,
      run({
        ...proposal,
        intent: {
          conversation: "urn:conversation:two",
          parameters: { support: ["b", "a"], digest: "two" },
        },
      }),
    ).diverges,
  ).toBe(false);
  expect(
    compareBranch(
      main,
      run({
        ...proposal,
        intent: {
          ...proposal.intent,
          parameters: { ...proposal.intent.parameters, support: ["a", "c"] },
        },
      }),
    ).judged,
  ).toEqual(decision());
  expect(
    compareBranch(
      main,
      run({
        ...proposal,
        params: { decision: "accept" },
      }),
    ).judged,
  ).toEqual(decision());
});

it("uses a stable script reference when a step cites a generated reading", () => {
  const step = {
    type: "effect" as const,
    id: "decision",
    agent: "agent",
    activityType: "urn:activity:test",
    intent: { parameters: { support: [{ ["$ref"]: "steps.reference-score.statement.id" }] } },
    params: {},
  };
  expect(describeStep(step).items).toEqual(["steps.reference-score.statement.id"]);
});

it("skips exactly an approved other-agent setup and never skips the judged agent", () => {
  const ask = { ...decision(), agent: "other" };
  const own = { ...decision(undefined, 2), outcome: "stop", reason: "not-authorised" } as const;
  const main = { events: [] };
  const branch = { events: [ask, own], approvedAsks: new Set([1]) };
  expect(compareBranch(main, branch, { judgedAgent: "agent" })).toMatchObject({
    judged: own,
    setup: [ask],
  });
  expect(() => compareBranch(main, { events: [ask, own] }, { judgedAgent: "agent" })).toThrow(
    /judgedAgent/,
  );
  expect(() =>
    compareBranch(
      main,
      {
        ...branch,
        events: [{ ...ask, outcome: "stop" }, own],
      },
      { judgedAgent: "agent" },
    ),
  ).toThrow(/judgedAgent/);
  const judgedAsk = { ...ask, agent: "agent" };
  expect(
    compareBranch(
      main,
      { ...branch, events: [judgedAsk, own] },
      {
        judgedAgent: "agent",
      },
    ).judged,
  ).toEqual(judgedAsk);
});

it.each([
  "contract-wording",
  "employment-reference",
] as const)("keeps a copied main script non-diverging for %s", async (id) => {
  const { profile, scenario } = loadCase(root, id);
  const [main, branch] = await runScenario(
    profile,
    {
      ...scenario,
      branches: [
        {
          ...scenario.branches[0]!,
          change: { script: scenario.script },
          profileChange: undefined,
          expect: scenario.result,
        },
      ],
    },
    { compare: false },
  );
  expect(branch?.note).toBe("branch does not diverge from the main path");
  expect(
    branch?.trace?.events.map(({ outcome, check, reason }) => ({ outcome, check, reason })),
  ).toEqual(main?.trace?.events.map(({ outcome, check, reason }) => ({ outcome, check, reason })));
}, 180_000);

it("judges the held full-record referral without sending it", async () => {
  const { profile, scenario } = loadCase(root, "health-referral");
  const [, branch] = await runScenario(profile, { ...scenario, branches: [scenario.branches[0]!] });
  expect(branch).toMatchObject({
    disagrees: false,
    actual: { outcome: "ask-principal", reason: "approval-required", check: "limits-approval" },
  });
  expect(branch?.note).toBeUndefined();
  const releases = branch?.trace?.events.filter((event) => event.kind === "message-out") ?? [];
  expect(releases.length).toBeGreaterThan(0);
  for (const event of releases)
    expect(JSON.stringify(event.packet)).not.toContain("urn:scenario:health-referral:full");
}, 180_000);

it("validates the hotel approval as setup when trip booking judges the traveller", async () => {
  const { profile, scenario } = loadCase(root, "trip-booking");
  const branch = { ...scenario.branches[0]!, judgedAgent: "receiver-agent" };
  const [, result] = await runScenario(profile, { ...scenario, branches: [branch] });
  expect(result).toMatchObject({
    disagrees: false,
    actual: { outcome: "stop", reason: "not-authorised", check: "mandate" },
    setup: expect.arrayContaining([
      expect.objectContaining({
        agent: "owner-agent",
        outcome: "ask-principal",
        reason: "context-not-clear",
      }),
    ]),
  });
  const owner = result?.trace?.events.filter((event) => event.agent === "owner-agent") ?? [];
  const ask = owner.find((event) => event.kind === "decision" && event.outcome === "ask-principal");
  const reply = owner.find((event) => event.kind === "principal-reply");
  expect(ask?.actionDigest).toBeTruthy();
  expect(reply).toMatchObject({ actionDigest: ask?.actionDigest, approvalDecision: "approve" });
  expect(owner.find((event) => event.seq > reply!.seq && event.outcome === "go")).toMatchObject({
    actionDigest: ask?.actionDigest,
  });
  await expect(
    runScenario(profile, {
      ...scenario,
      branches: [{ ...branch, judgedAgent: "owner-agent" }],
    }),
  ).rejects.toThrow(/cannot skip receiver-agent's stop/);
}, 180_000);

it("judges the permitted false-but-signed branch by its witnessed release", async () => {
  const { profile, scenario } = loadCase(root, "false-but-signed");
  const [, branch] = await runScenario(profile, scenario);
  expect(branch).toMatchObject({
    disagrees: false,
    actual: { outcome: "go", reason: "source-accepted", check: "source" },
  });
  expect(branch?.note).toBeUndefined();
}, 180_000);

it("reports a non-diverging onlyUnder branch as a disagreement", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-core");
  const configuration = "authenticity-data-integrity";
  const [, branch] = await runScenario(
    profile,
    {
      ...scenario,
      branches: [
        {
          id: "copied-main",
          what: "Repeat the main script under the same configuration.",
          onlyUnder: configuration,
          change: {},
          expect: { outcome: "go", check: "evidence", reason: "evidence-complete" },
          outline: [],
        },
      ],
    },
    { configuration },
  );
  expect(branch).toMatchObject({
    disagrees: true,
    note: "branch does not diverge from the main path",
  });
}, 180_000);

it("does not count the missing core reply when a branch ends at the inbound hold", async () => {
  const { profile, scenario } = loadCase(root, "flat-share");
  const [offer, receive] = scenario.script;
  if (!offer || receive?.type !== "receive") throw new Error("Missing flat-share opening steps");
  const heldReceive = { ...receive };
  delete heldReceive.reply;
  const [, branch] = await runScenario(
    profile,
    {
      ...scenario,
      branches: [
        {
          ...scenario.branches[0]!,
          change: { script: [offer, heldReceive] },
          catalogueExpected: undefined,
          expect: { outcome: "ask-principal", check: "source", reason: "source-unknown" },
        },
      ],
    },
    { compare: false },
  );
  expect(branch).toMatchObject({
    disagrees: true,
    note: "branch does not diverge from the main path",
    actual: { outcome: "ask-principal", check: "source", reason: "source-unknown" },
  });
}, 180_000);

it("matches an admitted supersession against the catalogue go outcome", async () => {
  const { profile, scenario } = loadCase(root, "records-to-new-practice");
  const [, branch] = await runScenario(profile, {
    ...scenario,
    branches: [
      {
        ...scenario.branches[0]!,
        catalogueExpected: { outcome: "go", reason: "superseded-by-better-source" },
      },
    ],
  });
  expect(branch).toMatchObject({
    disagrees: false,
    actual: { outcome: "admit", check: "fitness", reason: "superseded-by-better-source" },
  });
  expect(branch?.note).toBeUndefined();
}, 180_000);
