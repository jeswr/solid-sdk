// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { confinementDifferences } from "../src/engine/confinement.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import { GateMemory, type ItemTerms } from "../src/gates/common.js";
import { OutboundGate } from "../src/gates/outbound.js";
import type { UsageModel } from "../src/mechanisms/usage-model.js";
import { ActionIntentNode } from "../src/model/message-nodes.js";
import { alternativeWireId } from "../src/profile/configurations.js";
import { FixedUsageModel } from "../src/standins/usage-model.js";
import { BASELINE } from "../src/suites/baseline.js";
import type { TraceEventInput } from "../src/trace/types.js";

const at = "2026-11-13T09:00:00.000Z";
const item = "urn:test:balance",
  purpose = "urn:test:valuation",
  recipient = "urn:test:valuer";
const permitted: ItemTerms = {
  policy: {
    id: "urn:test:terms",
    permissions: [{ type: "permission", action: "distribute", target: item }],
  },
};
function fixture(model?: UsageModel, terms = permitted) {
  const memory = new GateMemory(),
    events: TraceEventInput[] = [];
  memory.facts.set(item, {
    id: item,
    label: "The bank balance",
    claimType: "deposit.balance",
    source: "urn:test:bank",
    terms,
  });
  const intent = ActionIntentNode.toNode({
    action: "distribute",
    operation: "urn:test:share",
    target: "urn:test:share",
    purpose,
    recipient,
    conversation: "urn:test:conversation",
    parameters: { evidence: [item], termsDigest: "sha-256:request" },
  }).live;
  const gate = new OutboundGate({
    identity: { actor: "urn:test:agent", party: "urn:test:principal" },
    now: () => at,
    mandate: () => undefined,
    memory,
    isReplyTo: () => true,
    offerTerms: () => ({ evidenceRequest: [{ claimType: "deposit.balance" }], purpose }),
    gate: {
      configuration: {
        ...BASELINE,
        id: "usage-control-odrl-model-tighten",
        pilotConfiguration: alternativeWireId("usage-control-odrl-model-tighten"),
        layers: { ...BASELINE.layers, "usage-control": "odrl-model-tighten" },
      },
      ...(model ? { usageModel: model } : {}),
      sink: { agent: "agent", emit: (event) => events.push(event) },
    },
  });
  const release = () =>
    gate.release(intent, {
      type: "authorisation-decision",
      action: intent,
      actionDigest: "digest",
      decider: "urn:test:agent",
      at,
      outcome: "permit",
      reason: "within-mandate",
      policy: { id: "urn:test:mandate", digest: "digest", evaluator: "test" },
    });
  return { gate, release, events, intent };
}

it.each([
  "prohibited",
  "not-decided",
] as const)("the real data-terms gate enforces a model's %s opinion", (effect) => {
  const model = new FixedUsageModel({
    effect,
    reason: "The request does not match its stated purpose.",
  });
  const f = fixture(model);
  const result = f.release();
  expect(result.outcome).toBe("stop");
  expect(result.verdicts).toContainEqual(
    expect.objectContaining({
      check: "data-terms",
      verdict: effect === "prohibited" ? "fail" : "indeterminate",
      reason: effect === "prohibited" ? "prohibited" : "indeterminate-policy",
    }),
  );
  expect(model.calls).toHaveLength(1);
  expect(model.calls[0]?.recipient).toBe(recipient);
  expect(model.calls[0]?.purpose).toBe(purpose);
  expect(JSON.parse(model.calls[0]?.request ?? "{}").evidenceRequest[0].claimType).toBe(
    "deposit.balance",
  );
  expect(
    f.events.find((event) => event.fact?.claimType === "usage-model.opinion")?.fact?.value,
  ).toMatchObject({ opinion: { effect }, rules: { verdict: "pass" } });
});

it("never consults a model on prohibition, unmatched rules, unsupported terms or supplier restrictions", () => {
  const model = new FixedUsageModel();
  for (const terms of [
    {
      policy: {
        ...permitted.policy,
        prohibitions: [{ type: "prohibition" as const, action: "distribute", target: item }],
      },
    },
    { policy: { id: "urn:test:empty" } },
    {
      policy: {
        ...permitted.policy,
        prohibitions: [{ type: "prohibition" as const, action: "training", target: item }],
      },
    },
    { ...permitted, recipientMustBe: { task: "mortgage lending", label: "a regulated lender" } },
  ])
    expect(fixture(model, terms as ItemTerms).release().outcome).toBe("stop");
  expect(model.calls).toEqual([]);
});

it("fails closed without the installed model or with an unavailable or malformed answer", () => {
  expect(fixture().release()).toMatchObject({
    outcome: "stop",
    decision: { reason: "unsupported-configuration" },
  });
  for (const review of [
    () => {
      throw new Error("unavailable");
    },
    () => ({ effect: "maybe", reason: "unknown" }),
    () => ({ effect: "permit", reason: "" }),
  ]) {
    const model = { id: "urn:test:model", review } as UsageModel;
    expect(fixture(model).release()).toMatchObject({
      outcome: "stop",
      decision: { reason: "indeterminate-policy" },
    });
  }
  expect(fixture(new FixedUsageModel()).release().outcome).toBe("go");
});

it("keeps the recorded model view bound to the action when a model tries to change its recipient", () => {
  const f = fixture({
    id: "urn:test:mutating-model",
    review(input) {
      try {
        Reflect.set(input, "recipient", "urn:test:stranger");
      } catch {}
      return { effect: "permit", reason: "The fixed answer is permit." };
    },
  });
  expect(f.release().outcome).toBe("go");
  expect(f.intent.recipient).toBe(recipient);
  expect(
    f.events.find((event) => event.fact?.claimType === "usage-model.opinion")?.fact?.value,
  ).toMatchObject({ input: { recipient } });
});

it("runs the mortgage with a narrowing model and confines it; a forced yes cannot change a rule prohibition", async () => {
  const { profile, scenario } = loadCase(new URL("..", import.meta.url).pathname, "mortgage-main");
  const baseline = (await runScenario(profile, { ...scenario, branches: [] }))[0]?.trace;
  const paths = await runScenario(profile, scenario, {
    configuration: "usage-control-odrl-model-tighten",
  });
  const main = paths.find((path) => path.path === "main"),
    failure = paths.find((path) => path.path === "model-says-yes-to-a-no");
  if (!baseline || !main?.trace || !failure?.trace)
    throw new Error(
      JSON.stringify(paths.map((path) => ({ path: path.path, blocked: path.blocked }))),
    );
  expect(confinementDifferences(baseline, main.trace, "usage-control")).toEqual([]);
  expect(failure.disagrees).toBe(false);
  const balance = "urn:awp:evidence:harbourbank-deposit-2026-10";
  expect(
    main.trace.events.some(
      (event) => event.fact?.claimType === "usage-model.opinion" && event.fact.subject === balance,
    ),
  ).toBe(true);
  expect(
    failure.trace.events.some(
      (event) => event.fact?.claimType === "usage-model.opinion" && event.fact.subject === balance,
    ),
  ).toBe(false);
  expect(
    failure.trace.events.some(
      (event) =>
        event.fact?.claimType === "usage-model.opinion" &&
        event.fact.subject === "urn:awp:evidence:paywell-income-2026-10",
    ),
  ).toBe(false);
  expect(failure.trace.events).toContainEqual(
    expect.objectContaining({ check: "data-terms", verdict: "fail", reason: "prohibited" }),
  );
  expect(
    main.trace.events.some(
      (event) =>
        event.packet?.kind === "receipt" &&
        event.packet.layers.content.raw &&
        (event.packet.layers.content.raw as { observed?: { status?: string } }).observed?.status ===
          "settled",
    ),
  ).toBe(true);
  for (const trace of [main.trace, failure.trace]) {
    expect(trace.standIns).toContainEqual({
      what: "Purpose-matching model",
      replacedBy: "A fixed stand-in played the model in this run.",
    });
    for (const event of trace.events)
      expect(`${event.caption} ${event.rule?.text ?? ""} ${event.chat?.text ?? ""}`).not.toMatch(
        /https?:\/\/|urn:|did:/,
      );
  }
}, 180000);
