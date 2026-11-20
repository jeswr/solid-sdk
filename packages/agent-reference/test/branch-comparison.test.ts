// AUTHORED-BY Codex GPT-6.2 Sol
// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { digestBytes, digestOf } from "../src/core/canonical.js";
import { verifierRegistry } from "../src/derive/verifiers.js";
import {
  type ComparisonStep,
  compareBranch,
  continuedReleaseProblem,
  describeStep,
  type RefusedStatement,
  stoppedReleaseProblem,
  witnessedDecision,
} from "../src/engine/compare.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import { testKey } from "../src/reference/keys.js";
import { signClaim } from "../src/scenarios/common.js";
import type { PacketView, TraceEvent } from "../src/trace/types.js";
import { ToyJointProtocol } from "./doubles/joint.js";
import { ToyProofSystem } from "./doubles/proof.js";

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
const refusedValue = "Private synthetic reference CODE-941";
const refusedClaim = {
  id: refusedId,
  issuer: "urn:issuer:refused",
  claimType: "test.claim",
  value: refusedValue,
  account: "urn:account:confidential",
};
const refusedStatement: RefusedStatement = {
  id: refusedId,
  claimDigest: digestOf(refusedClaim),
  wireDigest: digestBytes("protected statement bytes"),
  wire: "protected statement bytes",
  statement: refusedClaim,
};
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

function afterRefusal(
  later: TraceEvent[],
  first = checked(1),
  stop = refusal,
  payloads?: ReadonlyMap<number, unknown>,
) {
  return stoppedReleaseProblem(
    {
      events: [first, stop, ...later],
      standaloneRefusals: new Map([[stop.seq, refusedStatement]]),
      payloads,
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

it.each([
  ["ID citation", { derivedFrom: [refusedId] }],
  ["claim digest", { source: refusedStatement.claimDigest }],
  ["wire digest", { source: refusedStatement.wireDigest }],
  ["copy under a new ID", { ...refusedClaim, id: acceptedId }],
] as const)("rejects a gated packet carrying a refused statement's %s", (_name, raw) => {
  const packet = packetWithStatement(acceptedId);
  expect(
    afterRefusal([
      gated,
      {
        ...sent,
        packet: {
          ...packet,
          layers: { ...packet.layers, provenance: { present: true, summary: "", raw } },
        },
      },
    ]),
  ).toBe(true);
});

it("rejects a renamed store even when the published fact view omits the value", () => {
  expect(
    afterRefusal(
      [laterAdmit, stored],
      checked(1),
      refusal,
      new Map([[stored.seq, { ...refusedClaim, id: acceptedId }]]),
    ),
  ).toBe(true);
});

it("rejects even one refused field in a different issuer's separately admitted claim", () => {
  const payload = {
    id: acceptedId,
    issuer: "urn:issuer:independent",
    claimType: "test.other-claim",
    details: [{ destination: `Reference: ${refusedClaim.account} (copied)` }],
  };
  expect(
    afterRefusal([laterAdmit, stored], checked(1), refusal, new Map([[stored.seq, payload]])),
  ).toBe(true);
});

it("flags the supplier invoice that stores the refused account, even though payment stops", async () => {
  const { profile, scenario } = loadCase(root, "pay-an-invoice");
  const paths = await runScenario(profile, scenario, { reportExpectationFailures: true });
  const branch = paths.find((path) => path.path === "branch-1");
  expect(branch).toMatchObject({
    disagrees: true,
    note: "an effect followed a stop",
    actual: { outcome: "refuse", check: "source", reason: "source-not-authoritative" },
  });
  const storedInvoice = branch?.trace?.events.find(
    (event) =>
      event.agent === "business-agent" &&
      event.kind === "store" &&
      event.fact?.id === "urn:scenario:pay-an-invoice:invoice-statement",
  );
  expect(storedInvoice?.fact).toMatchObject({
    claimType: "invoice",
    source: "urn:fictional:supplier",
  });
  expect(storedInvoice?.settlement?.facts).toMatchObject({
    payeeAccount: "urn:account:supplier",
  });
  expect(branch?.trace?.events).toContainEqual(
    expect.objectContaining({
      agent: "business-agent",
      part: "inbound-gate",
      outcome: "refuse",
      reason: "source-not-authoritative",
    }),
  );
  expect(branch?.trace?.events).toContainEqual(
    expect.objectContaining({
      agent: "business-agent",
      check: "P4",
      verdict: "fail",
      reason: "source-not-authoritative",
    }),
  );
  const released = branch?.trace?.events.filter(
    (event) => event.agent === "business-agent" && event.kind === "message-out",
  );
  expect(released?.map((event) => event.packet?.kind)).toEqual(["accept"]);
  expect(JSON.stringify(released)).not.toContain("urn:account:supplier");
}, 120_000);

it("inspects the original joint packet payload when private fields are redacted from the trace", () => {
  expect(
    afterRefusal(
      [gated, sent],
      checked(1),
      refusal,
      new Map([[sent.seq, { partial: { derivedFrom: refusedId } }]]),
    ),
  ).toBe(true);
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
  const payloads = new Map([[effect.seq, { service: "urn:independent:operation" }]]);
  expect(afterRefusal([effect], checked(1), refusal, payloads)).toBe(false);
  expect(afterRefusal([effect])).toBe(true);
  expect(
    stoppedReleaseProblem(
      {
        events: [checked(1), refusal, effect],
        standaloneRefusals: new Map([[refusal.seq, refusedStatement]]),
        effectSupport: new Map([[effect.seq, [refusedId]]]),
        payloads,
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

it.each([
  [undefined, false],
  [undefined, true],
  [undefined, "exact"],
  [undefined, "re-signed"],
  ["sparq-zk-result/5", false],
  ["sparq-zk-result/5", true],
  ["sparq-aggregate/1", false],
  ["sparq-aggregate/1", true],
] as const)("checks an approved email after a refused statement (method %s, content %s)", async (method, content) => {
  const { profile, scenario } = loadCase(root, "no-agent-on-the-other-side");
  const [draft, approve] = scenario.script;
  const issuer = scenario.parties.find((party) => party.id === "party-1");
  if (draft?.type !== "email-send" || approve?.type !== "approve" || !issuer)
    throw new Error("Missing email fixture");
  const declaration = {
    id: "private-reference",
    issuer: issuer.id,
    kind: "test.private-reference",
    method: "recorded-by-authority",
    value: { value: refusedValue },
  };
  let text = draft.text;
  if (typeof content === "string") {
    const exact = content === "exact";
    const token = await signClaim(
      await testKey(exact ? `engine/${draft.agent}/owner` : "comparison/other-issuer"),
      {
        ...declaration.value,
        id: exact ? `urn:scenario:${scenario.id}:${declaration.id}` : acceptedId,
        issuer: exact ? issuer.identity : "urn:issuer:independent",
        claimType: declaration.kind,
        method: declaration.method,
      },
    );
    text = exact ? token : `Attached statement: (proof.${token}).`;
  } else if (content) {
    text = `The reference is ${refusedValue}.`;
  }
  scenario.script = [draft, approve];
  scenario.stress = [];
  scenario.statements.push(declaration);
  scenario.branches = [
    {
      id: "standalone-refusal",
      what: "The reader refuses a statement and independently gates the email.",
      expect: { outcome: "refuse", check: "source", reason: "source-not-authoritative" },
      outline: [],
      change: {
        requiredMethods: method ? [method] : [],
        script: [
          {
            id: "refuse-reference",
            type: "admit",
            agent: draft.agent,
            purpose: draft.purpose,
            statements: [declaration.id],
          },
          { ...draft, text },
          approve,
        ],
      },
    },
  ];
  const paths = await runScenario(profile, scenario, {
    registry: verifierRegistry([new ToyProofSystem(), new ToyJointProtocol()]),
    testOnly: true,
    compare: false,
    reportExpectationFailures: true,
  });
  const branch = paths.find((path) => path.path === "standalone-refusal");
  expect(branch?.trace?.events).toContainEqual(
    expect.objectContaining({ outcome: "refuse", reason: "source-not-authoritative" }),
  );
  expect(branch?.trace?.events).toContainEqual(
    expect.objectContaining({ outcome: "go", effectRelease: true }),
  );
  expect(branch?.trace?.events.some((event) => event.kind === "message-out")).toBe(false);
  expect(branch?.note).toBe(content ? "an effect followed a stop" : undefined);
  expect(branch?.disagrees).toBe(Boolean(content));
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

it("uses the aligned release to reach a skipped bar after an earlier main release", () => {
  const step = { id: "shared-release", descriptor: { type: "start", items: [] } };
  const skipped = decision("approval-required", 2);
  const stop = { ...decision("not-authorised", 2), outcome: "stop" } as const;
  const result = compareBranch(
    { events: [accepted(1), skipped, accepted(3)], steps: new Map([[3, step]]) },
    { events: [accepted(1), stop], steps: new Map([[1, step]]) },
    { changedSteps: new Set() },
  );
  expect(result.judged).toEqual(stop);
  expect(result.setup).toEqual([]);
  expect(result.failure).toBeDefined();
});

it.each([
  "removed",
  "script",
  "trace",
  "unchanged release",
] as const)("uses the effective script and trace to identify the skipped G1 bar (%s)", (presence) => {
  const bar = decision("approval-required", 2);
  const stop = { ...decision("not-authorised", 4), outcome: "stop" } as const;
  const descriptor = { type: "start", items: [] };
  const main = {
    events: [accepted(1), bar, accepted(3)],
    steps: new Map([
      [1, { id: "initial", descriptor }],
      [2, { id: "bank", descriptor }],
      [3, { id: "shared", descriptor }],
    ]),
  };
  const extra = accepted(2, "admit");
  const rejected = presence === "unchanged release" ? extra : undefined;
  const branch = {
    events: [checked(1), ...(rejected ? [rejected] : []), accepted(3), stop],
    steps: new Map<number, ComparisonStep>(
      [
        ...(presence === "trace" ? [[1, { id: "bank", descriptor }] as const] : []),
        [2, { id: "initial", descriptor }] as const,
        [3, { id: "shared", descriptor }] as const,
        [4, { id: "new-stop", descriptor }] as const,
      ].filter(([seq]) => seq !== 2 || rejected !== undefined),
    ),
    scriptIds: new Set([
      "shared",
      "new-stop",
      ...(presence === "script" ? ["bank"] : []),
      ...(rejected ? ["initial"] : []),
    ]),
  };
  const result = compareBranch(main, branch, { changedSteps: new Set(["new-stop"]) });
  expect(result.judged).toEqual(stop);
  expect(result.notReached).toEqual(presence === "script" || presence === "trace" ? [] : [bar]);
  expect(result.failure).toEqual(presence === "removed" ? undefined : (rejected ?? accepted(3)));
});

it("does not use an identical later bar to cover a skipped bar before a shared release", () => {
  const descriptor = { type: "start", items: [] };
  const bar = decision("approval-required", 2);
  const shared = accepted(3);
  const late = { ...bar, seq: 4 };
  const stop = { ...decision("not-authorised", 5), outcome: "stop" } as const;
  const steps = new Map([
    [2, { id: "early-bar", descriptor }],
    [3, { id: "shared", descriptor }],
    [4, { id: "late-bar", descriptor }],
  ]);
  const result = compareBranch(
    { events: [accepted(1), bar, shared, late], steps },
    {
      events: [shared, late, stop],
      steps: new Map([...steps].slice(1)),
      scriptIds: new Set(["early-bar", "shared", "late-bar", "stop"]),
    },
    { changedSteps: new Set(["stop"]) },
  );
  expect(result.judged).toEqual(stop);
  expect(result.failure).toEqual(shared);
});

it("does not use an identical bar from another step before the shared release", () => {
  const descriptor = { type: "start", items: [] };
  const removed = decision("approval-required", 1);
  const kept = { ...removed, seq: 2 };
  const shared = accepted(3);
  const replacement = { ...kept, seq: 1 };
  const stop = { ...decision("not-authorised", 4), outcome: "stop" } as const;
  const main = {
    events: [removed, kept, shared],
    steps: new Map([
      [removed.seq, { id: "removed", descriptor }],
      [kept.seq, { id: "kept", descriptor }],
      [shared.seq, { id: "shared", descriptor }],
    ]),
  };
  const branch = {
    events: [replacement, shared, stop],
    steps: new Map([
      [replacement.seq, { id: "replacement", descriptor }],
      [shared.seq, { id: "shared", descriptor }],
      [stop.seq, { id: "stop", descriptor }],
    ]),
    scriptIds: new Set(["kept", "replacement", "shared", "stop"]),
  };
  const result = compareBranch(main, branch, { changedSteps: new Set(["replacement", "stop"]) });
  expect(result.judged).toEqual(stop);
  expect(result.notReached).toEqual([removed]);
  expect(result.failure).toEqual(replacement);
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

it("keeps an A2 supersession judgement but requires a release for an explicit go witness", async () => {
  const { profile, scenario } = loadCase(root, "records-to-new-practice");
  const branch = scenario.branches[0];
  if (!branch) throw new Error("Missing supersession branch");
  branch.expect = { outcome: "go", check: "fitness", reason: "superseded-by-better-source" };
  const [, result] = await runScenario(profile, scenario, { reportExpectationFailures: true });
  expect(
    result?.trace?.events.some((event) => event.kind === "message-out" || event.effectRelease),
  ).toBe(false);
  expect(result).toMatchObject({
    disagrees: true,
    note: "expected fitness/superseded-by-better-source -> go",
    actual: { outcome: "admit", check: "fitness", reason: "superseded-by-better-source" },
  });
}, 180_000);

it("does not turn a withheld statement's failed check into a go witness", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  const branch = scenario.branches.find((candidate) => candidate.id === "stranger");
  if (!branch?.onlyUnder) throw new Error("Missing unknown-source fixture");
  scenario.branches = [branch];
  branch.expect = { outcome: "go", check: "source", reason: "source-unknown" };
  const paths = await runScenario(profile, scenario, {
    configuration: branch.onlyUnder,
    reportExpectationFailures: true,
  });
  const result = paths.find((candidate) => candidate.path === branch.id);
  const events = result?.trace?.events ?? [];
  const check = events.find(
    (event) =>
      event.check === "source" && event.verdict === "fail" && event.reason === "source-unknown",
  );
  if (!check) throw new Error("Missing the failed inbound source check");
  expect(events).toContainEqual(
    expect.objectContaining({
      agent: check.agent,
      gateRun: check.gateRun,
      kind: "decision",
      outcome: "admit",
    }),
  );
  expect(
    events.some(
      (event) =>
        event.seq > check.seq &&
        event.agent === check.agent &&
        (event.kind === "message-out" || event.effectRelease),
    ),
  ).toBe(false);
  expect(result).toMatchObject({
    disagrees: true,
    note: "expected source/source-unknown -> go",
    actual: { outcome: "admit", check: "source", reason: "source-unknown" },
  });
}, 180_000);

it("does not let a trailing standalone supersession witness the next admission", async () => {
  const { profile, scenario } = loadCase(root, "records-to-new-practice");
  const [, result] = await runScenario(profile, scenario);
  const events = result?.trace?.events ?? [];
  const supersession = events.find((event) => event.reason === "superseded-by-better-source");
  if (!supersession) throw new Error("Missing standalone supersession");
  const next = events.find(
    (event) =>
      event.seq > supersession.seq &&
      event.kind === "decision" &&
      event.outcome === "admit" &&
      event.agent === supersession.agent &&
      event.gateRun === supersession.gateRun,
  );
  expect(next?.step).toBeGreaterThan(supersession.step);
  expect(
    witnessedDecision(
      { events },
      { outcome: "admit", check: "fitness", reason: "superseded-by-better-source" },
    ),
  ).toBeUndefined();
  expect(result?.consequences).toContainEqual(
    expect.objectContaining({ seq: next?.seq, outcome: "admit" }),
  );
}, 180_000);

it("does not credit a DID-aliased copy of a main step as a replacement release", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  const configuration = "identity-did";
  const entry = scenario.configurations.find((candidate) => candidate.id === configuration);
  const apply = scenario.script.find((step) => step.id === "apply");
  if (!entry || apply?.type !== "start") throw new Error("Missing DID fixture");
  scenario.stopAfter = "products-returned";
  scenario.stress = ["integrity"];
  entry.world.branches = [
    {
      id: "copied-application",
      what: "Continue with the copied application and refuse its unsupported actor method.",
      onlyUnder: configuration,
      change: {
        script: { [apply.id]: apply },
        stopAfter: "describe-lender",
        inject: [
          {
            step: "describe-lender",
            target: "message",
            path: ["from", "actor"],
            value: "did:key:z6MkFictionalUnacceptedMethod",
            resign: true,
          },
        ],
      },
      expect: { outcome: "refuse", check: "integrity", reason: "unsupported-configuration" },
      outline: [],
    },
  ];
  const [main, branch] = await runScenario(profile, scenario, { configuration });
  expect(
    main?.trace?.events.some(
      (event) =>
        event.kind === "message-out" &&
        event.actionScope?.recipient === "did:web:north.identity.example",
    ),
  ).toBe(false);
  expect(branch?.trace?.events).toContainEqual(
    expect.objectContaining({
      outcome: "go",
      actionScope: expect.objectContaining({
        recipient: "did:web:north.identity.example",
      }),
    }),
  );
  expect(branch?.trace?.events).toContainEqual(
    expect.objectContaining({ outcome: "refuse", reason: "unsupported-configuration" }),
  );
  expect(branch).toMatchObject({
    disagrees: true,
    note: "changed before the judged decision",
  });
}, 180_000);
