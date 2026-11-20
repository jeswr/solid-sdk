// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import {
  compareBranch,
  continuedReleaseProblem,
  describeStep,
  firstBranchDivergence,
} from "../src/engine/compare.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import type { TraceEvent } from "../src/trace/types.js";

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
it("skips shared approval and judges the first different decision", () => {
  const changed = decision("not-authorised", 2);
  expect(firstBranchDivergence([decision()], [decision(), changed])).toEqual(changed);
});
it("does not skip a different reason at the same check", () => {
  const changed = decision("context-not-clear");
  expect(firstBranchDivergence([decision()], [changed])).toEqual(changed);
});
it("consumes matches so an additional repetition diverges", () => {
  expect(
    firstBranchDivergence([decision()], [decision(), decision("approval-required", 2)]),
  ).toMatchObject({ seq: 2 });
});
it("reports no divergence when every non-pass decision matches", () => {
  expect(firstBranchDivergence([decision()], [decision()])).toBeUndefined();
});

it("detects an earlier successful decision changed before the expected stop", () => {
  const first = { ...decision("within-mandate"), outcome: "go" as const };
  const changed = { ...first, agent: "another-agent" };
  expect(firstBranchDivergence([first, decision()], [changed, decision()])).toEqual(changed);
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

it("detects a branch that ends after an identical prefix", () => {
  expect(firstBranchDivergence([decision(), decision("later", 2)], [decision()])).toBe(
    "missing-decision",
  );
});

const accepted = (seq: number, outcome: "go" | "admit" = "go"): TraceEvent => ({
  ...decision(undefined, seq),
  part: outcome === "go" ? "outbound-gate" : "inbound-gate",
  check: undefined,
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
  verdict: "pass",
  reason: "source-accepted",
  caption: "",
  ...extra,
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
      events: [...branch.events, { ...fail, seq: 3 }, accepted(4, "admit")],
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

it("reports statement precedence after the standalone admission and keeps the verdict", () => {
  const admit = accepted(1, "admit");
  const superseded = checked(2, { check: "fitness", reason: "superseded-by-better-source" });
  expect(compareBranch({ events: [admit] }, { events: [admit, superseded] }).judged).toMatchObject({
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

it("keeps a changed or missing ordered decision ahead of a new transport fault", () => {
  const options = { ordered: true };
  const go = accepted(1);
  const fault = checked(2, { kind: "record", part: "transport", fault: "fault-in-test" });
  const stop = { ...decision("not-authorised", 3), outcome: "stop" } as const;
  const changed = { ...go, agent: "other" };
  expect(
    compareBranch({ events: [go] }, { events: [changed, fault, stop] }, options).judged,
  ).toEqual(changed);
  expect(compareBranch({ events: [go, stop] }, { events: [go, fault] }, options)).toMatchObject({
    diverges: true,
    missingDecision: true,
  });
  expect(compareBranch({ events: [go] }, { events: [go, fault] }, options)).toMatchObject({
    diverges: true,
  });
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
    steps: new Map([[1, describeStep(step)]]),
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
