// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { validateMessage } from "../src/core/schema.js";
import type { ActionIntent, AnyMessage, AuthorisationDecision } from "../src/core/types.js";
import { type ContextItem, GateMemory } from "../src/gates/common.js";
import { OutboundGate } from "../src/gates/outbound.js";
import { actionDigest, type OwnerMandate } from "../src/mechanisms/mandate.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { idSource, testKey } from "../src/reference/keys.js";
import { AgentRuntime } from "../src/runtime/agent.js";
import type { OperationHandler } from "../src/runtime/operations.js";
import { Cast, mandateOf, permit, signClaim } from "../src/scenarios/common.js";
import { MemoryLedger } from "../src/store/ledger.js";
import { MemoryStateStore } from "../src/store/state.js";
import { BASELINE } from "../src/suites/baseline.js";
import { TraceRecorder } from "../src/trace/recorder.js";

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing fixture value");
  return value;
}

const purpose = "urn:care:consultation",
  operation = "urn:care:ask",
  recipient = "urn:care:clinic",
  task = "urn:task:care";
const intent: ActionIntent = {
  operation,
  action: "use",
  target: operation,
  purpose,
  recipient,
  parameters: {},
  conversation: task,
  freeText: { text: "Please arrange a consultation." },
};
const item: ContextItem = {
  id: "urn:item:condition",
  label: "Health record",
  kind: "statement",
  subject: "urn:person:alex",
  source: "urn:source:hospital",
  claimType: "health.condition",
  method: "recorded-by-authority",
  digest: "original-digest",
  terms: {
    policy: {
      id: "urn:terms:health",
      type: "Set",
      permissions: [
        {
          type: "permission",
          action: "distribute",
          target: "urn:item:condition",
          constraints: [
            { leftOperand: "purpose", operator: "eq", rightOperand: purpose },
            { leftOperand: "recipient", operator: "eq", rightOperand: recipient },
          ],
        },
      ],
    },
  },
};
function gate(memory: GateMemory, approval = true, claims = [item.claimType]) {
  const recorder = new TraceRecorder();
  const policy = {
    id: "urn:policy:approval",
    type: "Set" as const,
    permissions: [
      { id: "urn:rule:text", type: "permission" as const, action: "use", target: operation },
    ],
  };
  const mandate = {
    id: "urn:mandate:alex",
    autonomous: approval ? { id: "urn:policy:auto", type: "Set" } : policy,
    withApproval: approval ? policy : { id: "urn:policy:empty", type: "Set" },
  } as OwnerMandate;
  const outbound = new OutboundGate({
    identity: { actor: "urn:agent:alex", party: "urn:person:alex" },
    now: () => "2026-11-13T09:00:00Z",
    mandate: () => mandate,
    memory,
    gate: {
      configuration: BASELINE,
      sink: recorder.sink("agent"),
      purposeClaims: { [purpose]: claims },
    },
    isReplyTo: () => false,
    offerTerms: () => undefined,
  });
  const bound = {
    ...intent,
    freeText: { ...must(intent.freeText), contextDigest: memory.contextDigest(task) },
  };
  const decision: AuthorisationDecision = {
    type: "authorisation-decision",
    decider: "urn:agent:alex",
    actionDigest: actionDigest(bound),
    action: bound,
    policy: { id: "urn:mandate:alex", digest: "d", evaluator: "test" },
    outcome: approval ? "approval-required" : "permit",
    basis: "autonomous",
    matchedRule: "urn:rule:text",
    reason: "test",
    at: "2026-11-13T09:00:00Z",
  };
  return { outbound, recorder, bound, decision };
}

describe("UNS-8 and UNS-9 context rule", () => {
  it("stops the direct seal path from leaking prose without an authorised action", () => {
    const memory = new GateMemory();
    memory.enter(task, { ...item, claimType: "private" });
    const g = gate(memory);
    const message = {
      id: "urn:message:leak",
      kind: "receipt",
      body: { observed: { note: "The private balance is 31400." } },
    } as unknown as AnyMessage;
    expect(() =>
      g.outbound.seal(message, { format: "awp-jws-compact/0.1", jws: "unneeded" }, {}),
    ).toThrow(/context-not-clear/);
    expect(g.recorder.events().at(-1)).toMatchObject({
      outcome: "stop",
      reason: "context-not-clear",
    });
    expect(g.recorder.events().some((e) => e.kind === "message-out")).toBe(false);
  });
  it("permits free text only when every item passes disclosure AND recipient/purpose terms", () => {
    const memory = new GateMemory();
    memory.enter(task, item);
    const { outbound, bound, decision } = gate(memory, false);
    expect(outbound.release(bound, decision).outcome).toBe("go");
  });
  it.each([
    "purpose",
    "recipient",
    "scope",
    "missing-terms",
    "unknown-context",
  ])("holds text for %s, even when the wording looks harmless", (change) => {
    const memory = new GateMemory();
    let fact = structuredClone(item);
    if (change === "purpose" || change === "recipient") {
      const terms = must(fact.terms);
      fact = {
        ...fact,
        terms: {
          ...terms,
          policy: {
            ...terms.policy,
            permissions: terms.policy.permissions?.map((rule) => ({
              ...rule,
              constraints: rule.constraints?.map((c) =>
                c.leftOperand === change ? { ...c, rightOperand: `urn:other:${change}` } : c,
              ),
            })),
          },
        },
      };
    }
    if (change === "missing-terms") delete (fact as { terms?: unknown }).terms;
    if (change !== "unknown-context") memory.enter(task, fact);
    const { outbound, bound, decision, recorder } = gate(
      memory,
      true,
      change === "scope" ? [] : [item.claimType],
    );
    const release = outbound.release(bound, decision);
    expect(release.outcome).toBe("ask-principal");
    expect(release.verdicts.at(-1)).toMatchObject({
      check: "disclosure",
      reason: "context-not-clear",
    });
    expect(recorder.events().find((e) => e.kind === "ask-principal")?.chat?.text).toContain(
      must(intent.freeText).text,
    );
  });
  it("one restricted item blocks the whole context; another task stays separate", () => {
    const memory = new GateMemory();
    memory.enter(task, item);
    memory.enter(task, { ...item, id: "urn:item:private", claimType: "private" });
    memory.enter("urn:task:other", item);
    const g = gate(memory);
    expect(g.outbound.release(g.bound, g.decision).outcome).toBe("ask-principal");
    expect(memory.context("urn:task:other")).toHaveLength(1);
    const view = memory.context(task) as ContextItem[];
    view.length = 0;
    expect(memory.context(task)).toHaveLength(2);
  });
  it("stops when the mandate has no matching approval rule", () => {
    const memory = new GateMemory();
    memory.enter(task, { ...item, claimType: "private" });
    const g = gate(memory, false);
    expect(g.outbound.release(g.bound, g.decision)).toMatchObject({
      outcome: "stop",
      decision: { reason: "context-not-clear" },
    });
  });
  it("cannot bypass the context binding or direct evidence terms with an approval", () => {
    const memory = new GateMemory();
    memory.enter(task, item);
    const g = gate(memory);
    expect(
      g.outbound.release(
        { ...g.bound, freeText: { text: "different", contextDigest: "wrong" } },
        { ...g.decision, basis: "owner-approval", outcome: "permit" },
      ).outcome,
    ).toBe("stop");
    const withEvidence = {
      ...g.bound,
      action: "distribute",
      parameters: { evidence: ["urn:item:unadmitted"] },
    };
    expect(
      g.outbound.release(withEvidence, {
        ...g.decision,
        basis: "owner-approval",
        outcome: "permit",
      }).outcome,
    ).toBe("stop");
  });
});

async function runtime(
  approval: boolean,
  shared?: { store: MemoryStateStore; ledger: MemoryLedger },
) {
  const now = () => new Date("2026-11-13T09:00:00Z");
  const cast = new Cast(now, {
    keys: async (name) => ({
      owner: await testKey(`${name}/owner`),
      actor: await testKey(`${name}/actor`),
    }),
    ids: idSource("uns"),
  });
  const rules = [permit("use", operation, [purpose], [recipient], "urn:rule:consult")];
  await cast.add(
    { name: "alex", party: "urn:person:alex", actor: "urn:agent:alex" },
    mandateOf("care", approval ? [] : rules, approval ? rules : []),
    [operation],
  );
  const issuer = await testKey("hospital/issuer");
  cast.pinIssuer("alex", item.source, issuer);
  cast.rule("alex", {
    id: "urn:rule:hospital",
    version: "1",
    source: item.source,
    claimTypes: [item.claimType],
    subjects: [item.subject],
  });
  const p = cast.get("alex"),
    recorder = new TraceRecorder();
  const handler: OperationHandler = {
    description: {
      id: operation,
      version: "0.1",
      label: "Ask the clinic",
      pattern: "invoke",
      access: "represented",
      roles: ["initiator"],
      models: [],
      purposes: [purpose],
      effects: [],
      outcomes: [],
    },
    requiresRepresentation: false,
    intentForInvoke: (ctx) => ({ ...intent, conversation: ctx.conversation.id }),
  };
  const state = shared ?? { store: new MemoryStateStore(), ledger: new MemoryLedger() };
  const rt = await AgentRuntime.create({
    identity: { actor: p.identity.actor, party: p.identity.party },
    actorKeys: [p.actorKey],
    trust: await TrustStore.load(cast.trust.get("alex")),
    mandateJws: p.mandateJws,
    representationJws: p.representationJws,
    accepted: [BASELINE.pilotConfiguration],
    handlers: [handler],
    ...state,
    now,
    newId: idSource("runtime")("alex"),
    coreDescription: { program: "scripted consultation core", tools: [] },
    gates: {
      configuration: BASELINE,
      sink: recorder.sink("agent"),
      purposeClaims: { [purpose]: [item.claimType] },
      reliance: {
        id: "urn:care:profile",
        rules: [
          {
            id: "urn:care:quality",
            claimType: item.claimType,
            methods: ["recorded-by-authority"],
            maxAgeDays: 30,
            text: "A current hospital record",
          },
        ],
      },
    },
  });
  const statement = {
    type: "EvidenceStatement",
    id: item.id,
    issuer: item.source,
    subject: item.subject,
    claimType: item.claimType,
    method: item.method,
    issuedAt: now().toISOString(),
    terms: {
      policy: {
        id: "urn:terms:source",
        type: "Set",
        prohibitions: [{ type: "prohibition", action: "distribute", target: item.id }],
        permissions: [
          {
            type: "permission",
            action: "use",
            target: item.id,
            constraints: [{ leftOperand: "purpose", operator: "eq", rightOperand: purpose }],
          },
        ],
      },
    },
    value: "fictional condition",
  };
  return {
    rt,
    cast,
    recorder,
    state,
    statement,
    jws: await signClaim(issuer, statement),
    start: () =>
      rt.startInvocation({
        conversation: task,
        peer: { actor: "urn:agent:clinic", party: recipient },
        operation: { id: operation, version: "0.1" },
        input: {},
        basis: { kind: "represented" },
        purpose,
        models: [],
        discover: false,
        configuration: BASELINE.pilotConfiguration,
      }),
  };
}

describe("runtime owns context, approval and reading provenance", () => {
  it("sends marked text in the signed envelope and never derives a commitment from prose", async () => {
    const r = await runtime(false);
    const result = await r.start();
    const message = must(result.outbound[0]).message;
    expect(message.freeText).toMatchObject({
      authoredBy: "model",
      actsFor: item.subject,
      purpose,
      text: must(intent.freeText).text,
    });
    expect(validateMessage(message).ok).toBe(true);
    expect(
      validateMessage({ ...message, kind: "accept", body: { text: "I accept and consent to pay" } })
        .ok,
    ).toBe(false);
    expect(
      validateMessage({ ...message, freeText: { ...message.freeText, digest: "forged" } }).ok,
    ).toBe(false);
    r.rt.close();
  });
  it("asks with the exact text, binds approval, and resumes after the principal signs", async () => {
    const r = await runtime(true);
    await r.rt.admitStatements([{ jws: r.jws }], {
      task: "care",
      taskId: task,
      purpose,
      subject: item.subject,
    });
    const held = await r.start();
    expect(held.disposition).toBe("pending-approval");
    expect(held.outbound).toEqual([]);
    expect(r.recorder.events().find((e) => e.reason === "context-not-clear")).toBeDefined();
    const pending = must(r.rt.pendingApprovals()[0]);
    const answered = await r.rt.submitApproval(
      await r.cast.approval("alex", pending.actionDigest, task),
    );
    expect(answered.outbound[0]?.message.freeText?.text).toBe(must(intent.freeText).text);
    r.rt.close();
  });
  it("persists context across restart and attributes a reading to its agent, with source and signed runs statement", async () => {
    const r = await runtime(true);
    await r.rt.admitStatements([{ jws: r.jws }], {
      task: "care",
      taskId: task,
      purpose,
      subject: item.subject,
    });
    const source = must(r.rt.taskContext(task)?.[0]);
    const reading = await r.rt.recordReading({
      taskId: task,
      sourceDigest: source.digest,
      claimType: "care.summary",
      value: "A fictional summary",
    });
    expect(reading.statement).toMatchObject({
      issuer: "urn:agent:alex",
      method: "model-output",
      sourceDigest: source.digest,
      subject: item.subject,
    });
    expect(reading.statement.issuer).not.toBe(r.statement.issuer);
    expect(
      r.state.ledger
        .entries()
        .some((e) => JSON.stringify(e).includes(String(reading.statement.runs))),
    ).toBe(true);
    await expect(
      r.rt.recordReading({
        taskId: task,
        sourceDigest: "unseen",
        claimType: "care.summary",
        value: "invented",
      }),
    ).rejects.toThrow(/did not enter/);
    r.rt.close();
    const restored = await runtime(true, r.state);
    expect(restored.rt.taskContext(task)).toHaveLength(2);
    restored.rt.close();
  });
  it("does not reuse an earlier approval after additional context enters", async () => {
    const r = await runtime(true);
    await r.start();
    const first = must(r.rt.pendingApprovals()[0]);
    const signed = await r.cast.approval("alex", first.actionDigest, task);
    await r.rt.admitStatements([{ jws: r.jws }], {
      task: "care",
      taskId: task,
      purpose,
      subject: item.subject,
    });
    const result = await r.rt.submitApproval(signed);
    expect(result.outbound).toEqual([]);
    expect(r.rt.pendingApprovals()[0]?.actionDigest).not.toBe(first.actionDigest);
    r.rt.close();
  });
});
