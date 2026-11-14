// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { digestOf } from "../src/core/canonical.js";
import type { AnyMessage, JsonObject } from "../src/core/types.js";
import { type GateContext, GateMemory, type ItemTerms } from "../src/gates/common.js";
import { OutboundGate } from "../src/gates/outbound.js";
import { evaluateItemTerms } from "../src/gates/quality.js";
import { signApproval } from "../src/mechanisms/mandate.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { CONFIG_AUTHENTICITY_DI, CONFIG_ED25519 } from "../src/profile/configurations.js";
import { type ContentProfile, freeStrings } from "../src/profile/content.js";
import { PILOT_PROFILE } from "../src/profile/vocabulary.js";
import { idSource, testKey } from "../src/reference/keys.js";
import { AgentRuntime } from "../src/runtime/agent.js";
import type { OperationHandler } from "../src/runtime/operations.js";
import { Cast, mandateOf, permit, signClaim } from "../src/scenarios/common.js";
import { MemoryLedger } from "../src/store/ledger.js";
import { MemoryStateStore } from "../src/store/state.js";
import { BASELINE } from "../src/suites/baseline.js";
import { TraceRecorder } from "../src/trace/recorder.js";
import { type MessagePacket, packetDocumentDigest } from "../src/wire/message-packet.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing test fixture value");
  return value;
}

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
function fixture(
  allowApproval = true,
  recipientPurpose = PURPOSE,
  overrides: Partial<GateContext> = {},
) {
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
  memory.rememberIdentifiers("urn:test:conversation", ["urn:test:request", "urn:test:activity"]);
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
      ...overrides,
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
      freeStrings(
        value,
        {
          "unfamiliar.*.id": { type: "identifier" },
          "unfamiliar.*.code": { type: "code", values: ["ok"] },
          "unfamiliar.*.wrong": { type: "term", values: ["yes"] },
          "unfamiliar.*.numeric": { type: "number" },
          "unfamiliar.*.day": { type: "date" },
        },
        { identifiers: new Set(["urn:test:id"]) },
      ).map((f) => f.path),
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

async function runtimeFixture(contentProfile?: ContentProfile, configuration = CONFIG_ED25519) {
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
    vocabulary: {
      "terms.purpose": { type: "identifier" },
      "observed.reference": { type: "identifier" },
    },
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
    ...(contentProfile ? { contentProfile } : {}),
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
      accepted: [configuration],
      handlers: [handler],
      core: { id: "urn:test:scripted-core", version: "1", kind: "scripted" },
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
    configuration,
  });
  const bank = await cast.runtime("b", [handler], [], [configuration]);
  const accepted = await bank.runtime.receive(required(start.outbound[0]).wire);
  await rt.receive(required(accepted.outbound[0]).wire);
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
  return { rt, cast, start, store, create, claim, handler, issuer };
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
  const pending = required(held.pendingApproval);
  const stored = store.load().pending[pending.actionDigest]!.continuation as JsonObject;
  const document = stored.document as unknown as MessagePacket;
  expect(document.format).toBe("awp-jsonld/0.1");
  expect(pending.intent.parameters.messageDigest).toBe(await packetDocumentDigest(document, "jws"));
  const approved = await cast.approval("s", pending.actionDigest, conv);
  const resumed = await create();
  const result = await resumed.submitApproval(approved);
  expect(result.outbound).toHaveLength(1);
  expect(await packetDocumentDigest(result.outbound[0]!.wire as MessagePacket, "jws")).toBe(
    pending.intent.parameters.messageDigest,
  );
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

it.each(
  (["jws", "data-integrity"] as const).flatMap((suite) =>
    [false, true].map((tampered) => ({ suite, tampered })),
  ),
)("retains held attachment bytes across restart ($suite, tampered: $tampered)", async ({
  suite,
  tampered,
}) => {
  const { rt, cast, start, store, create } = await runtimeFixture(
    undefined,
    suite === "data-integrity" ? CONFIG_AUTHENTICITY_DI : CONFIG_ED25519,
  );
  const conv = start.conversation!;
  const text = "The private balance is 31400. ".repeat(350);
  const held = await rt.sendReceipt(conv, {
    activity: "urn:test:activity",
    outcome: "completed",
    observed: { unusualField: text },
    final: false,
  });
  const pending = required(held.pendingApproval);
  const state = store.load();
  const continuation = state.pending[pending.actionDigest]!.continuation as JsonObject;
  const document = continuation.document as unknown as MessagePacket;
  expect(document.attachments.length).toBeGreaterThan(0);
  if (tampered) {
    const attachment = document.attachments[0]!;
    const bytes = Buffer.from(attachment.bytes, "base64");
    bytes[10] = bytes[10]! ^ 1;
    (attachment as { bytes: string }).bytes = bytes.toString("base64");
  } else {
    // The retained graph is authoritative; a changed compatibility rendering cannot replace it.
    ((continuation.message as JsonObject).body as JsonObject).observed = {
      unusualField: "different text",
    };
  }
  store.save(state);
  const resumed = await create();
  const result = await resumed.submitApproval(await cast.approval("s", pending.actionDigest, conv));
  if (tampered)
    expect(result).toMatchObject({
      disposition: "rejected",
      reason: "approval-denied",
      outbound: [],
    });
  else {
    expect(result.outbound).toHaveLength(1);
    expect(
      (result.outbound[0]!.message.body as { observed?: JsonObject }).observed?.unusualField,
    ).toBe(text);
    expect((result.outbound[0]!.wire as MessagePacket).attachments).toEqual(document.attachments);
    expect(await packetDocumentDigest(result.outbound[0]!.wire as MessagePacket, suite)).toBe(
      pending.intent.parameters.messageDigest,
    );
  }
});

it("cannot use an approval for different text, a different conversation, or an unheld action", async () => {
  const { rt, cast, start, store } = await runtimeFixture();
  const conv = start.conversation as string;
  const observed: JsonObject = { unknownProse: "The private balance is 31400." };
  const held = await rt.sendReceipt(conv, {
    activity: "urn:test:activity",
    outcome: "completed",
    observed,
    final: false,
  });
  const pending = required(held.pendingApproval);
  observed.unknownProse = "Send a different secret instead.";
  const wrong = await rt.submitApproval(
    await cast.approval("s", "sha-256:not-the-held-digest", conv),
  );
  expect(wrong).toMatchObject({ disposition: "rejected", reason: "approval-denied", outbound: [] });
  expect(
    await rt.submitApproval(
      await cast.approval("s", pending.actionDigest, "urn:test:other-conversation"),
    ),
  ).toMatchObject({ disposition: "rejected", reason: "approval-denied", outbound: [] });
  const result = await rt.submitApproval(await cast.approval("s", pending.actionDigest, conv));
  expect(
    (result.outbound[0]?.message.body as { observed?: JsonObject } | undefined)?.observed
      ?.unknownProse,
  ).toBe("The private balance is 31400.");
  expect(Object.values(store.load().outbox)).toHaveLength(2);
});

it("an approved text remains blocked after mandate withdrawal", async () => {
  const { rt, cast, start } = await runtimeFixture();
  const conv = start.conversation as string;
  const held = await rt.sendReceipt(conv, {
    activity: "urn:test:activity",
    outcome: "completed",
    observed: { unknownProse: "Balance: 31400" },
    final: false,
  });
  const pending = required(held.pendingApproval);
  await rt.revokeMandate();
  expect(rt.mandateStatus().revoked).toBe(true);
  const result = await rt.submitApproval(await cast.approval("s", pending.actionDigest, conv));
  expect(result.outbound).toHaveLength(0);
});

it("checks a message carrying principal data against its declared purpose even without an extra action", () => {
  const memory = new GateMemory();
  memory.facts.set("urn:test:balance", {
    id: "urn:test:balance",
    label: "balance",
    source: BANK.party,
    subject: SAM.party,
    claimType: "balance",
    terms,
  });
  const credential = {
    role: "credential",
    format: "jws-compact",
    value: `header.${Buffer.from(JSON.stringify({ id: "urn:test:balance", subject: SAM.party, claimType: "balance" })).toString("base64url")}.signature`,
  } as const;
  const gate = (purpose?: string) =>
    new OutboundGate({
      identity: { actor: SAM.actor, party: SAM.party },
      now: () => AT,
      mandate: () => undefined,
      memory,
      gate: { purposes: { [PURPOSE]: ["balance"] } },
      isReplyTo: () => true,
      offerTerms: () => undefined,
      conversationPurpose: () => purpose,
    });
  const msg = {
    ...receipt(),
    evidence: [credential],
    body: { ...(receipt().body as object), observed: {} },
  } as unknown as AnyMessage;
  expect(gate().checkMessage(msg, { operation: OP.id })).toMatchObject({
    outcome: "stop",
    reason: "missing-context",
  });
  expect(gate(PURPOSE).checkMessage(msg, { operation: OP.id })).toMatchObject({
    outcome: "stop",
    reason: "prohibited",
  });
});

it("cannot form a commitment from prose or omit the mandate on a consequential message", () => {
  const { gate } = fixture();
  const accept = {
    ...receipt(),
    kind: "accept",
    body: {
      proposal: "urn:test:offer",
      agreement: "urn:test:agreement",
      termsDigest: "sha-256:terms",
      selection: { consent: "I accept and authorise payment." },
    },
  } as AnyMessage;
  const intent = {
    operation: OP.id,
    target: OP.id,
    action: "use",
    conversation: accept.conversation,
    parameters: {},
  };
  expect(gate.checkMessage(accept, { operation: OP.id, intent })).toMatchObject({
    outcome: "stop",
    reason: "structured-form-required",
  });
  expect(gate.checkMessage(accept, { operation: OP.id })).toMatchObject({
    outcome: "stop",
    reason: "not-authorised",
  });
});

it("stops an action whose relayed support was not admitted", () => {
  const { gate } = fixture();
  const intent = {
    operation: OP.id,
    action: "use",
    target: OP.id,
    conversation: "urn:test:conversation",
    parameters: { support: ["urn:test:unaccepted-claim"] },
  };
  expect(
    gate.release(intent, {
      type: "authorisation-decision",
      decider: SAM.actor,
      actionDigest: digestOf(intent),
      action: intent,
      policy: { id: "urn:test:policy", digest: "sha-256:policy", evaluator: "test" },
      at: AT,
      outcome: "permit",
      basis: "autonomous",
      reason: "within-mandate",
    }),
  ).toMatchObject({ outcome: "stop", decision: { outcome: "deny", reason: "evidence-invalid" } });
});

it("rejects a foreign principal's approval and a denial releases no message", async () => {
  const { rt, cast, start } = await runtimeFixture();
  const conv = start.conversation as string;
  const held = await rt.sendReceipt(conv, {
    activity: "urn:test:activity",
    outcome: "completed",
    observed: { unfamiliar: "Balance: 31400" },
    final: false,
  });
  const pending = required(held.pendingApproval);
  expect(
    await rt.submitApproval(await cast.approval("b", pending.actionDigest, conv)),
  ).toMatchObject({ disposition: "rejected", reason: "approval-denied", outbound: [] });
  expect(
    await rt.submitApproval(await cast.approval("s", pending.actionDigest, conv, "deny")),
  ).toMatchObject({ reason: "approval-denied", outbound: [] });
  expect(rt.pendingApprovals()).toHaveLength(0);
});

it("a model reading cannot hide free text inside a signed credential", () => {
  const { gate, memory } = fixture();
  const claim = {
    id: "urn:test:reading",
    issuer: SAM.actor,
    subject: SAM.party,
    claimType: "balance",
    method: "model-output",
    value: { unfamiliar: "The private balance is 31400." },
  };
  memory.facts.set(claim.id, {
    id: claim.id,
    digest: digestOf(claim),
    label: "model reading",
    source: SAM.actor,
    subject: SAM.party,
    claimType: "balance",
    terms: {
      policy: {
        id: "urn:test:reading-terms",
        permissions: [{ type: "permission", action: "distribute", target: claim.id }],
      },
    },
  });
  const msg = {
    ...receipt(),
    body: { ...(receipt().body as object), observed: {} },
    evidence: [
      {
        role: "credential",
        format: "jws-compact",
        value: `header.${Buffer.from(JSON.stringify(claim)).toString("base64url")}.signature`,
      },
    ],
  } as unknown as AnyMessage;
  expect(gate.checkMessage(msg, { operation: OP.id })).toMatchObject({
    outcome: "ask-principal",
    reason: "context-not-clear",
  });
});

it("an expired approval cannot resume a held text", async () => {
  const { rt, cast, start } = await runtimeFixture();
  const conversation = required(start.conversation);
  const held = await rt.sendReceipt(conversation, {
    activity: "urn:test:activity",
    outcome: "completed",
    observed: { unfamiliar: "Balance: 31400" },
    final: false,
  });
  const pending = required(held.pendingApproval);
  const expired = await signApproval(cast.get("s").ownerKey, {
    type: "OwnerApproval",
    id: "urn:test:expired-approval",
    issuer: SAM.party,
    actor: SAM.actor,
    actionDigest: pending.actionDigest,
    conversation,
    decision: "approve",
    issuedAt: AT,
    validUntil: AT,
  });
  expect(await rt.submitApproval(expired)).toMatchObject({
    disposition: "rejected",
    reason: "approval-denied",
    detail: "approval expired",
    outbound: [],
  });
  expect(rt.pendingApprovals()).toHaveLength(1);
});

// UNS-8a: syntax is insufficient, even in an explicitly identifier-typed position.
describe("known identifiers", () => {
  const vocabulary = { "observed.arbitrary.*.nested": { type: "identifier" as const } };
  it.each([
    true,
    false,
  ])("holds an invented IRI containing the restricted balance (approval=%s)", (approval) => {
    const { gate, recorder } = fixture(approval, PURPOSE, { vocabulary });
    expect(
      gate.checkMessage(receipt("urn:x:the-balance-is-31400"), { operation: OP.id }),
    ).toMatchObject({
      outcome: approval ? "ask-principal" : "stop",
      reason: "context-not-clear",
    });
    expect(recorder.events().filter((event) => event.outcome === "go")).toEqual([]);
  });
  it.each([
    ["profile purpose", PURPOSE],
    ["profile operation", OP.id],
    ["profile source", "urn:test:source"],
    ["profile party", BANK.party],
    ["defined term", "urn:test:defined-term"],
    ["context item", "urn:test:balance"],
    ["context value", "urn:test:account"],
    ["received message", "urn:test:received"],
    ["sent message", "urn:test:sent"],
    ["challenge", "urn:test:challenge"],
    ["challenge nonce", "urn:test:nonce"],
    ["proposal", "urn:test:proposal"],
    ["agreement", "urn:test:agreement"],
    ["activity", "urn:test:activity"],
    ["runtime mint", "urn:test:minted"],
  ])("keeps %s typed while private context is held", (_kind, id) => {
    const { gate, memory } = fixture(true, PURPOSE, {
      vocabulary: { ...vocabulary, defined: { type: "term", values: ["urn:test:defined-term"] } },
      identifiers: [OP.id, BANK.party],
      claimSources: { balance: ["urn:test:source"] },
    });
    memory.enter("urn:test:conversation", {
      kind: "memory",
      id: "urn:test:memory",
      digest: "digest",
      source: BANK.party,
      claimType: "balance",
      label: "account memory",
      identifiers: ["urn:test:account"],
      terms,
    });
    memory.rememberIdentifiers("urn:test:conversation", {
      id: "urn:test:received",
      reply: "urn:test:sent",
      challenge: { id: "urn:test:challenge", nonce: "urn:test:nonce" },
      proposal: "urn:test:proposal",
      agreement: "urn:test:agreement",
    });
    memory.rememberIdentifiers("*", ["urn:test:minted"]);
    expect(gate.checkMessage(receipt(id), { operation: OP.id })).toMatchObject({ outcome: "go" });
  });
  it("does not borrow identifiers from another conversation or type an undeclared position", () => {
    const { gate, memory } = fixture(true, PURPOSE, { vocabulary });
    memory.rememberIdentifiers("urn:test:other-conversation", ["urn:test:foreign"]);
    expect(gate.checkMessage(receipt("urn:test:foreign"), { operation: OP.id }).outcome).toBe(
      "ask-principal",
    );
    expect(
      freeStrings(
        { unknown: "urn:test:balance" },
        {},
        { identifiers: new Set(["urn:test:balance"]) },
      ),
    ).toEqual([{ path: "unknown", text: "urn:test:balance" }]);
  });
  it("remembers actual runtime mints and conversation IDs across restart, without admitting a new invention", async () => {
    const { rt, start, create } = await runtimeFixture();
    const minted = await rt.mintIdentifier();
    const activity = await rt.mintIdentifier();
    rt.close();
    const restored = await create();
    const conversation = required(start.conversation);
    const agreement = required(restored.conversation(conversation)?.agreement);
    const proposal = required(start.outbound[0]).id;
    for (const reference of [
      minted,
      activity,
      conversation,
      agreement,
      proposal,
      "urn:test:balance",
      PURPOSE,
      OP.id,
      BANK.party,
      "urn:test:issuer",
    ]) {
      const sent = await restored.sendReceipt(conversation, {
        activity,
        outcome: "completed",
        final: false,
        observed: { reference },
      });
      expect(sent.outbound).toHaveLength(1);
      expect((required(sent.outbound[0]).message.body as { observed: unknown }).observed).toEqual({
        reference,
      });
    }
    const held = await restored.sendReceipt(conversation, {
      activity,
      outcome: "completed",
      final: false,
      observed: { reference: "urn:x:the-balance-is-31400" },
    });
    expect(held).toMatchObject({
      disposition: "pending-approval",
      reason: "context-not-clear",
      outbound: [],
    });
    expect(held.pendingApproval).toBeDefined();
    restored.close();
  });
});

it("snapshots installed vocabulary before a core can alter its declarations", async () => {
  const profile = { vocabulary: { "terms.status": { type: "code" as const, values: ["ok"] } } };
  const { rt, start } = await runtimeFixture(profile);
  profile.vocabulary["terms.status"].values.push("the-balance-is-31400");
  const stopped = await rt.startNegotiation({
    peer: { actor: BANK.actor, party: BANK.party },
    operation: OP,
    terms: { purpose: PURPOSE, status: "the-balance-is-31400" },
    models: [],
    discover: false,
    configuration: CONFIG_ED25519,
  });
  expect(stopped).toMatchObject({
    disposition: "rejected",
    reason: "structured-form-required",
    outbound: [],
  });
  expect(rt.conversation(required(start.conversation))?.agreement).toBeDefined();
  rt.close();
});

it("types a protected compound term only after its signature, schema and every claim's vocabulary pass", async () => {
  const profile: ContentProfile = {
    vocabulary: { "observed.token": { type: "term" } },
    protectedTerms: {
      "observed.token": {
        typ: "awp-statement+jws",
        role: "issuer",
        schema: z.strictObject({
          type: z.literal("Token"),
          id: z.string(),
          scope: z.literal("approved"),
        }),
        vocabulary: {
          type: { type: "code", values: ["Token"] },
          id: { type: "identifier" },
          scope: { type: "code", values: ["approved"] },
        },
      },
    },
  };
  const { rt, start, issuer } = await runtimeFixture(profile);
  const id = await rt.mintIdentifier();
  const activity = await rt.mintIdentifier();
  const payload = { type: "Token", id, scope: "approved" };
  const token = await signClaim(issuer, payload);
  const send = (value: string) =>
    rt.sendReceipt(required(start.conversation), {
      activity,
      outcome: "completed",
      final: false,
      observed: { token: value },
    });
  expect((await send(token)).outbound).toHaveLength(1);
  for (const altered of [
    issuer.kid,
    await signClaim(issuer, { ...payload, id: "urn:x:the-balance-is-31400" }),
    await signClaim(issuer, { ...payload, note: "The private balance is 31400." }),
    `${token.slice(0, -10)}AAAAAAAAAA`,
  ]) {
    expect(await send(altered)).toMatchObject({
      disposition: "pending-approval",
      reason: "context-not-clear",
      outbound: [],
    });
  }
  rt.close();
});

it("recovers retained conversation identifiers from snapshots written before the registry existed", async () => {
  const { rt, start, store, create } = await runtimeFixture();
  const incoming = required(Object.keys(store.load().seen)[0]);
  rt.close();
  store.save({ ...store.load(), knownIdentifiers: {} });
  const restored = await create();
  const sent = await restored.sendReceipt(required(start.conversation), {
    activity: await restored.mintIdentifier(),
    outcome: "completed",
    final: false,
    observed: { reference: incoming },
  });
  expect(sent.outbound).toHaveLength(1);
  restored.close();
});

it("does not learn an unsent core-selected conversation identifier during snapshot recovery", async () => {
  const { rt, start, create } = await runtimeFixture();
  const invented = "urn:x:the-balance-is-31400";
  const stopped = await rt.startNegotiation({
    conversation: invented,
    peer: { actor: BANK.actor, party: BANK.party },
    operation: OP,
    terms: { purpose: PURPOSE, prose: "This cannot form an offer." },
    models: [],
    discover: false,
    configuration: CONFIG_ED25519,
  });
  expect(stopped).toMatchObject({ reason: "structured-form-required", outbound: [] });
  rt.close();
  const restored = await create();
  const held = await restored.sendReceipt(required(start.conversation), {
    activity: await restored.mintIdentifier(),
    outcome: "completed",
    final: false,
    observed: { reference: invented },
  });
  expect(held).toMatchObject({
    disposition: "pending-approval",
    reason: "context-not-clear",
    outbound: [],
  });
  restored.close();
});
