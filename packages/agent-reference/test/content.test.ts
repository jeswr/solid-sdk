// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import { digestOf } from "../src/core/canonical.js";
import type { AnyMessage, JsonObject } from "../src/core/types.js";
import { type GateContext, GateMemory, type ItemTerms } from "../src/gates/common.js";
import { OutboundGate } from "../src/gates/outbound.js";
import { evaluateItemTerms } from "../src/gates/quality.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { CONFIG_ED25519 } from "../src/profile/configurations.js";
import { freeStrings } from "../src/profile/content.js";
import { PILOT_PROFILE } from "../src/profile/vocabulary.js";
import { idSource, testKey } from "../src/reference/keys.js";
import { AgentRuntime } from "../src/runtime/agent.js";
import type { OperationHandler } from "../src/runtime/operations.js";
import { Cast, mandateOf, permit, signClaim } from "../src/scenarios/common.js";
import { MemoryLedger } from "../src/store/ledger.js";
import { MemoryStateStore } from "../src/store/state.js";
import { BASELINE } from "../src/suites/baseline.js";
import { TraceRecorder } from "../src/trace/recorder.js";

const AT = "2026-11-13T09:00:00.000Z";
const PURPOSE = "urn:test:credit";
const OP = { id: "urn:test:operation", version: "0.1" };
const SAM = { name: "s", party: "urn:test:sam", actor: "urn:test:sam-agent" };
const BANK = { name: "b", party: "urn:test:bank", actor: "urn:test:bank-agent" };
const terms: ItemTerms = {
  policy: {
    id: "urn:test:terms",
    permissions: [{ type: "permission", action: "use", target: "urn:test:balance" }],
    prohibitions: [{ type: "prohibition", action: "distribute", target: "urn:test:balance" }],
  },
};
const receipt = (text = "The private balance is 31400.") =>
  ({
    profile: PILOT_PROFILE,
    configuration: CONFIG_ED25519,
    id: "urn:test:receipt",
    conversation: "urn:test:conversation",
    kind: "receipt",
    from: { actor: SAM.actor, onBehalfOf: SAM.party },
    to: { actor: BANK.actor, party: BANK.party },
    createdAt: AT,
    expiresAt: "2026-11-13T10:00:00.000Z",
    body: {
      ref: "urn:test:request",
      activity: "urn:test:activity",
      outcome: "completed",
      observed: { arbitrary: [{ nested: text }] },
      final: false,
    },
  }) as AnyMessage;
function fixture(allowApproval = true, recipientPurpose = PURPOSE) {
  const memory = new GateMemory();
  memory.enter("urn:test:conversation", {
    id: "urn:test:balance",
    kind: "statement",
    digest: "digest",
    label: "private balance",
    claimType: "balance",
    subject: SAM.party,
    source: BANK.party,
    terms,
  });
  const recorder = new TraceRecorder();
  const gate = new OutboundGate({
    identity: { actor: SAM.actor, party: SAM.party },
    now: () => AT,
    mandate: () =>
      mandateOf(
        "text",
        [],
        allowApproval ? [permit("distribute", OP.id, [PURPOSE], [BANK.party])] : [],
      )({ owner: SAM.party, actor: SAM.actor, validFrom: AT, validUntil: "2026-12-01T00:00:00Z" }),
    gate: {
      sink: recorder.sink("sam"),
      configuration: BASELINE,
      purposes: { [PURPOSE]: ["balance"] },
    },
    memory,
    isReplyTo: () => true,
    offerTerms: () => undefined,
    conversationPurpose: () => recipientPurpose,
  });
  return { gate, memory, recorder };
}

describe("UNS context and text", () => {
  it("F1: a receipt note cannot leak a balance whose terms prohibit distribution", () => {
    const { gate, recorder } = fixture();
    expect(gate.checkMessage(receipt(), { operation: OP.id })).toMatchObject({
      outcome: "ask-principal",
      reason: "context-not-clear",
    });
    expect(recorder.events().some((e) => e.outcome === "go")).toBe(false);
    expect(recorder.events().find((e) => e.kind === "ask-principal")?.chat?.text).toContain(
      "31400",
    );
  });
  it("stops when the mandate does not allow the principal to approve text", () => {
    expect(fixture(false).gate.checkMessage(receipt(), { operation: OP.id })).toMatchObject({
      outcome: "stop",
      reason: "context-not-clear",
    });
  });
  it("checks every context item including other subjects, and isolates named tasks", () => {
    const { gate, memory, recorder } = fixture();
    memory.enter("urn:test:conversation", {
      id: "urn:test:other",
      kind: "memory",
      digest: "other",
      subject: "urn:test:third-person",
      label: "another person's salary",
      source: "urn:test:employer",
      claimType: "salary",
    });
    expect(gate.checkMessage(receipt(), { operation: OP.id }).outcome).toBe("ask-principal");
    expect(recorder.events().filter((e) => e.check === "data-terms")).toHaveLength(2);
    expect(
      gate.checkMessage({ ...receipt(), conversation: "urn:test:clean-task" }, { operation: OP.id })
        .outcome,
    ).toBe("go");
  });
  it("does not treat approval of an action as approval of the text attached to it", () => {
    const { gate } = fixture();
    const intent = {
      action: "distribute",
      operation: OP.id,
      target: OP.id,
      parameters: {},
      conversation: "urn:test:conversation",
    };
    expect(gate.checkMessage(receipt(), { operation: OP.id, intent }).reason).toBe(
      "context-not-clear",
    );
  });
  it("uses recursive vocabulary types, closed values and validated identifiers, never fixed text keys", () => {
    const value = {
      unfamiliar: [
        {
          diagnosis: "cannot be ruled out",
          id: "urn:test:id",
          code: "ok",
          wrong: "unlisted",
          numeric: "31400",
          day: "2026-11-13",
        },
      ],
    };
    expect(
      freeStrings(value, {
        "unfamiliar.*.id": { type: "identifier" },
        "unfamiliar.*.code": { type: "code", values: ["ok"] },
        "unfamiliar.*.wrong": { type: "term", values: ["yes"] },
        "unfamiliar.*.numeric": { type: "number" },
        "unfamiliar.*.day": { type: "date" },
      }).map((f) => f.path),
    ).toEqual(["unfamiliar.0.diagnosis", "unfamiliar.0.wrong", "unfamiliar.0.numeric"]);
    expect(freeStrings({ id: "not an identifier" }, { id: { type: "identifier" } })).toHaveLength(
      1,
    );
  });
  it("defaults to no onward distribution when no terms arrived", () => {
    expect(
      evaluateItemTerms(undefined, {
        agent: SAM.actor,
        action: "distribute",
        target: "urn:test:balance",
        at: AT,
      }).verdict,
    ).toBe("fail");
  });
});

async function runtimeFixture() {
  const cast = new Cast(() => new Date(AT), {
    keys: async (id) => ({
      owner: await testKey(`${id}/owner`),
      actor: await testKey(`${id}/actor`),
    }),
    ids: idSource("content"),
  });
  const mandate = mandateOf(
    "content",
    [permit("use", OP.id, [PURPOSE])],
    [permit("distribute", OP.id, [PURPOSE], [BANK.party])],
  );
  await cast.add(SAM, mandate, [OP.id]);
  await cast.add(BANK, mandate, [OP.id]);
  cast.introduce(SAM.name, BANK.name);
  const issuer = await testKey("balance/issuer");
  cast.pinIssuer(SAM.name, "urn:test:issuer", issuer);
  cast.rule(SAM.name, {
    id: "urn:test:source-rule",
    version: "1",
    source: "urn:test:issuer",
    claimTypes: ["balance"],
    subjects: [SAM.party],
  });
  const store = new MemoryStateStore();
  const ledger = new MemoryLedger();
  const gates: GateContext = {
    configuration: BASELINE,
    taskId: "urn:test:task",
    purposes: { [PURPOSE]: ["balance"] },
    reliance: {
      id: "urn:test:reliance",
      rules: [
        {
          id: "urn:test:balance-rule",
          claimType: "balance",
          methods: ["recorded-by-authority"],
          maxAgeDays: 30,
          text: "Current bank record.",
        },
      ],
    },
  };
  const handler: OperationHandler = {
    description: {
      ...OP,
      label: "test",
      pattern: "negotiate",
      access: "represented",
      roles: ["initiator", "responder"],
      models: [],
      effects: [],
      outcomes: [],
    },
    requiresRepresentation: true,
    intentForProposal: (ctx) => ({
      action: "use",
      operation: OP.id,
      target: OP.id,
      purpose: PURPOSE,
      recipient: ctx.peer.party,
      conversation: ctx.conversation.id,
      parameters: {},
    }),
    onProposal: (ctx) => ({
      type: "accept",
      intent: {
        action: "use",
        operation: OP.id,
        target: OP.id,
        purpose: PURPOSE,
        recipient: ctx.peer.party,
        conversation: ctx.conversation.id,
        parameters: {},
      },
    }),
  };
  const trust = await TrustStore.load(cast.trust.get("s"));
  const create = () =>
    AgentRuntime.create({
      identity: { actor: SAM.actor, party: SAM.party },
      actorKeys: [cast.get("s").actorKey],
      trust,
      mandateJws: cast.get("s").mandateJws,
      representationJws: cast.get("s").representationJws,
      accepted: [CONFIG_ED25519],
      handlers: [handler],
      store,
      ledger,
      now: () => new Date(AT),
      newId: idSource("text-runtime")("sam"),
      gates,
    });
  const rt = await create();
  const start = await rt.startNegotiation({
    peer: { actor: BANK.actor, party: BANK.party },
    operation: OP,
    terms: { purpose: PURPOSE },
    models: [],
    discover: false,
    configuration: CONFIG_ED25519,
  });
  const bank = await cast.runtime("b", [handler]);
  const accepted = await bank.runtime.receive(start.outbound[0]!.wire);
  await rt.receive(accepted.outbound[0]!.wire);
  const claim = {
    id: "urn:test:balance",
    issuer: "urn:test:issuer",
    subject: SAM.party,
    claimType: "balance",
    balance: 31400,
    method: "recorded-by-authority",
    asOf: AT,
    terms,
  };
  expect(
    await rt.admitStatements([{ jws: await signClaim(issuer, claim) }], {
      subject: SAM.party,
      task: "credit",
      purpose: PURPOSE,
    }),
  ).toEqual({ admitted: 1, refused: 0 });
  return { rt, cast, start, store, create, claim };
}

it("holds before the outbox, survives restart, approves exact text once, and preserves provenance", async () => {
  const { rt, cast, start, store, create, claim } = await runtimeFixture();
  const conv = start.conversation as string;
  const before = Object.keys(store.load().outbox);
  const held = await rt.sendReceipt(conv, {
    activity: "urn:test:activity",
    outcome: "completed",
    observed: { unusualField: "The private balance is 31400." },
    final: false,
  });
  expect(held).toMatchObject({
    disposition: "pending-approval",
    reason: "context-not-clear",
    outbound: [],
  });
  expect(Object.keys(store.load().outbox)).toEqual(before);
  const pending = held.pendingApproval!;
  const approved = await cast.approval("s", pending.actionDigest, conv);
  const resumed = await create();
  const result = await resumed.submitApproval(approved);
  expect(result.outbound).toHaveLength(1);
  expect(
    (result.outbound[0]?.message.body as { observed?: JsonObject } | undefined)?.observed
      ?.unusualField,
  ).toContain("31400");
  expect(result.outbound[0]?.message.authorship).toEqual({
    method: "model-output",
    onBehalfOf: SAM.party,
  });
  expect(await resumed.submitApproval(approved)).toMatchObject({
    disposition: "rejected",
    reason: "approval-denied",
    outbound: [],
  });
  const reading = await resumed.recordReading({
    task: "urn:test:task",
    originalDigest: digestOf(claim),
    claimType: "reading",
    subject: SAM.party,
    value: "balance appears high",
  });
  expect(reading.statement).toMatchObject({
    issuer: SAM.actor,
    method: "model-output",
    originalDigest: digestOf(claim),
    terms,
  });
  await expect(
    resumed.recordReading({
      task: "urn:test:unrelated",
      originalDigest: digestOf(claim),
      claimType: "reading",
      subject: SAM.party,
      value: "x",
    }),
  ).rejects.toThrow("missing-context");
});
