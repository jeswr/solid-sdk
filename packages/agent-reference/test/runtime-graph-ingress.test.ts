// AUTHORED-BY Codex GPT-6
import { DataFactory } from "n3";
import { expect, it, vi } from "vitest";
import { digestBytes } from "../src/core/canonical.js";
import { DEFAULT_LIMITS } from "../src/core/limits.js";
import type { VerificationResult } from "../src/core/types.js";
import { GateMemory } from "../src/gates/common.js";
import { InboundGate } from "../src/gates/inbound.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { CoreNode } from "../src/model/core-node.js";
import { EvidenceItemNode } from "../src/model/evidence-item.js";
import { MessageNode } from "../src/model/message-nodes.js";
import { StatementQualityNode } from "../src/model/quality.js";
import {
  CONFIG_ED25519,
  CONFIG_PUBLIC,
  CONFIG_TRANSPORT_EMAIL,
} from "../src/profile/configurations.js";
import { PILOT_PROFILE } from "../src/profile/vocabulary.js";
import { testKey } from "../src/reference/keys.js";
import { AgentRuntime } from "../src/runtime/agent.js";
import { MemoryLedger } from "../src/store/ledger.js";
import { MemoryStateStore } from "../src/store/state.js";
import { writeAttachmentDocument } from "../src/wire/attachments.js";
import { sign } from "../src/wire/authenticity.js";
import { signCompact } from "../src/wire/jws-compact.js";
import { writeMessagePacket } from "../src/wire/message-packet.js";

const at = "2026-11-13T09:00:00.000Z";

it.each([
  "native",
  "legacy",
])("refuses an operator-only sender on a %s unsigned request", async (format) => {
  const receiver = "urn:test:receiver";
  const gate = new InboundGate({
    identity: { actor: receiver },
    trust: await TrustStore.load({ version: 1, owner: receiver, keys: [], sourceAuthority: [] }),
    limits: DEFAULT_LIMITS,
    now: () => at,
    record: () => {},
    gate: {},
    memory: new GateMemory(),
    agreementTerms: () => undefined,
  });
  const request = {
    profile: PILOT_PROFILE,
    configuration: CONFIG_PUBLIC,
    id: "urn:test:unsigned-request",
    conversation: "urn:test:conversation",
    kind: "invoke",
    from: {},
    to: { actor: receiver },
    createdAt: at,
    expiresAt: "2026-11-13T10:00:00.000Z",
    body: {
      operation: { id: "urn:test:operation", version: "1" },
      input: {},
      basis: { kind: "public" },
    },
  } as const;
  const verify = async (message: typeof request) => {
    const wire =
      format === "native"
        ? await writeMessagePacket(MessageNode.toNode(message), { unsigned: true })
        : { format: "awp-unsigned-json/0.1", payload: JSON.stringify(message) };
    return gate.verifyIntegrity(wire, {}, () => false);
  };
  expect(await verify(request)).toMatchObject({ ok: true });
  expect(await verify({ ...request, from: { operator: "urn:test:operator" } })).toMatchObject({
    ok: false,
    reason: "unsigned-not-allowed",
  });
});

async function credentialFixture() {
  const actor = await testKey("22d/graph-actor"),
    source = await testKey("22d/graph-source"),
    peer = await testKey("38e/graph-peer");
  const trust = await TrustStore.load({
    version: 1,
    owner: "urn:test:receiver",
    sourceAuthority: [],
    keys: [
      { ...actor, role: "actor", subject: "urn:test:sender" },
      { ...peer, role: "actor", subject: "urn:test:peer" },
      { ...source, role: "issuer", subject: "urn:test:source" },
    ].map(({ kid, alg, publicJwk, role, subject }) => ({
      kid,
      alg,
      publicJwk,
      role: role as "actor" | "issuer",
      subject,
      ...(role === "actor" ? { party: "urn:test:principal" } : {}),
    })),
  });
  const jws = await signCompact(source, "awp-statement+jws", {
    issuer: "urn:test:source",
    claimType: "count",
    subject: "urn:test:sender",
    count: 1,
  });
  const packet = async (node: MessageNode, key = actor) => {
    const prepared = await writeAttachmentDocument(node);
    return {
      format: "awp-jsonld/0.1" as const,
      jsonld: JSON.stringify(
        await sign(prepared.document, {
          suite: "jws",
          key,
          verificationMethod: "urn:awp:key:" + key.kid,
          created: at,
        }),
      ),
      attachments: prepared.attachments,
    };
  };
  return { trust, jws, packet, peer };
}

it("a profile-refused opener leaves the conversation available to a different pinned peer", async () => {
  const { trust, jws, packet, peer } = await credentialFixture();
  const receiver = await testKey("38e/graph-receiver");
  const store = new MemoryStateStore();
  const open = (store: MemoryStateStore) =>
    AgentRuntime.create({
      identity: { actor: "urn:test:receiver" },
      actorKeys: [receiver],
      accepted: [CONFIG_ED25519],
      handlers: [],
      trust,
      store,
      ledger: new MemoryLedger(),
      now: () => new Date(at),
      newId: () => "urn:test:description-response",
    });
  const opener = {
    profile: PILOT_PROFILE,
    configuration: CONFIG_ED25519,
    id: "urn:test:valid-opener",
    conversation: "urn:test:shared-conversation",
    kind: "describe",
    from: { actor: "urn:test:peer" },
    to: { actor: "urn:test:receiver" },
    createdAt: at,
    expiresAt: "2026-11-13T10:00:00.000Z",
    body: {},
  } as const;
  const refused = MessageNode.toNode({
    ...opener,
    id: "urn:test:profile-refused-opener",
    profile: "urn:test:unsupported-profile",
    from: { actor: "urn:test:sender" },
    evidence: [{ role: "credential", format: "jws-compact", value: jws }],
  });
  const valid = await packet(MessageNode.toNode(opener), peer);
  const control = await open(new MemoryStateStore());
  const expected = await control.receive(valid);
  expect(expected).toMatchObject({ disposition: "accepted", phase: "described" });

  const runtime = await open(store);
  await runtime.compact();
  const before = store.load();
  expect(await runtime.receive(await packet(refused))).toMatchObject({
    reason: "unsupported-profile",
  });
  const afterRefusal = store.load();
  const actual = await runtime.receive(valid);
  expect(actual).toMatchObject({ disposition: expected.disposition, phase: expected.phase });
  expect(actual.outbound.map((out) => out.message)).toEqual(
    expected.outbound.map((out) => out.message),
  );
  expect(afterRefusal).toEqual(before);

  const admittedState = store.load();
  const conflicting = MessageNode.toNode({ ...opener, profile: "urn:test:unsupported-profile" });
  expect(await runtime.receive(await packet(conflicting, peer))).toMatchObject({
    disposition: "rejected",
    reason: "replay-conflict",
  });
  expect(store.load()).toEqual(admittedState);
});

it("admits live wrappers, checks original projections, and explicitly resolves prior credentials", async () => {
  const { trust, jws, packet } = await credentialFixture();
  const records: unknown[] = [];
  const gate = new InboundGate({
    identity: { actor: "urn:test:receiver" },
    trust,
    limits: DEFAULT_LIMITS,
    now: () => at,
    record: (record) => records.push(record),
    gate: {},
    memory: new GateMemory(),
    agreementTerms: () => undefined,
  });
  const make = (id: string) =>
    MessageNode.toNode({
      profile: PILOT_PROFILE,
      configuration: CONFIG_ED25519,
      id: "urn:test:" + id,
      conversation: "urn:test:conversation",
      kind: "invoke",
      from: { actor: "urn:test:sender" },
      to: { actor: "urn:test:receiver" },
      createdAt: at,
      expiresAt: "2026-11-13T10:00:00.000Z",
      body: {
        operation: { id: "urn:test:operation", version: "1" },
        input: { count: 1 },
        basis: { kind: "public" },
      },
    });
  const first = make("first");
  first.evidence = [{ role: "credential", format: "jws-compact", value: jws }];
  const signed = await packet(first);
  const accepted = await gate.verifyIntegrity(signed, {}, () => false);
  expect(accepted.ok).toBe(true);
  if (!accepted.ok) throw new Error(accepted.detail);
  gate.stageCredentials(accepted.message)();
  expect(records).toContainEqual(
    expect.objectContaining({
      type: "verification",
      protectedObject: digestBytes(signed.jsonld),
      outcome: "valid",
      attributedTo: "urn:test:sender",
    }),
  );
  const doc = JSON.parse(signed.jsonld);
  doc.expiresAt = "2026-11-13T09:30:00.000Z";
  const tampered = { ...signed, jsonld: JSON.stringify(doc) };
  expect(await gate.verifyIntegrity(tampered, {}, () => false)).toMatchObject({
    ok: false,
    reason: "bad-signature",
  });
  const refused = records.at(-1) as VerificationResult;
  expect(refused).toMatchObject({
    type: "verification",
    protectedObject: digestBytes(tampered.jsonld),
    outcome: "invalid",
  });
  expect(refused).not.toHaveProperty("attributedTo");
  expect(accepted.message).toBeInstanceOf(MessageNode);
  expect(accepted.message.body).toBeInstanceOf(CoreNode);
  const view = accepted.message as unknown as MessageNode;
  const credential = accepted.message.evidence![0] as unknown as EvidenceItemNode;
  const quality = StatementQualityNode.from(
    credential.credential!.payload as unknown as import("../src/model/quality.js").QualityInput,
  );
  expect(quality.dataset).toBe(view.dataset);
  expect(quality.claimType).toBe("count");
  const claimType = credential.credential!.subjectPayload.entries.find(
    (entry) => entry.name === "claimType",
  )!;
  claimType.domainValue = DataFactory.literal("changed-count");
  expect(quality.claimType).toBe("changed-count");
  claimType.domainValue = DataFactory.literal("count");
  const input = (view.getField("body") as import("../src/model/message-nodes.js").InvokeBodyNode)
    .input;
  input.entries[0]!.domainValue = DataFactory.literal(
    "2",
    DataFactory.namedNode("http://www.w3.org/2001/XMLSchema#integer"),
  );
  expect((accepted.message.body as import("../src/core/types.js").InvokeBody).input.count).toBe(2);
  const second = make("second");
  second.evidence = [
    EvidenceItemNode.byDigest(
      { role: "credential", format: "jws-compact", digest: digestBytes(jws) },
      "urn:test:prior",
      second.dataset,
    ),
  ];
  const prior = await gate.verifyIntegrity(await packet(second), {}, () => false);
  expect(prior.ok).toBe(true);
  if (prior.ok) expect(prior.message.evidence?.[0]?.value).toBe(jws);
  const missing = make("missing");
  missing.evidence = [
    EvidenceItemNode.byDigest(
      { role: "credential", format: "jws-compact", digest: "sha-256:" + "0".repeat(64) },
      "urn:test:missing-prior",
      missing.dataset,
    ),
  ];
  expect(await gate.verifyIntegrity(await packet(missing), {}, () => false)).toMatchObject({
    ok: false,
    reason: "evidence-invalid",
    detail: "prior-credential-missing-or-digest-mismatch",
  });
  const altered = make("altered");
  altered.evidence = [{ role: "credential", format: "jws-compact", value: jws }];
  const claim = altered.evidence![0]!.credential!.subjectPayload.entries.find(
    (entry) => entry.name === "count",
  )!;
  claim.domainValue = DataFactory.literal(
    "99",
    DataFactory.namedNode("http://www.w3.org/2001/XMLSchema#integer"),
  );
  expect(await gate.verifyIntegrity(await packet(altered), {}, () => false)).toMatchObject({
    ok: false,
    reason: "evidence-invalid",
    detail: "original-credential-projection-mismatch",
  });
});

it("leaves credential references unresolved after a refused message and restores older admissions", async () => {
  const { trust, jws, packet } = await credentialFixture();
  const receiver = await testKey("38d/graph-receiver");
  const store = new MemoryStateStore();
  const ledger = new MemoryLedger();
  const open = (
    state = new MemoryStateStore(),
    evidenceLedger = state === store ? ledger : new MemoryLedger(),
  ) =>
    AgentRuntime.create({
      identity: { actor: "urn:test:receiver" },
      actorKeys: [receiver],
      accepted: [CONFIG_ED25519],
      handlers: [],
      trust,
      store: state,
      ledger: evidenceLedger,
      now: () => new Date(at),
    });
  const describe = (
    id: string,
    {
      to = "urn:test:receiver",
      profile = PILOT_PROFILE,
      configuration = CONFIG_ED25519,
    }: { to?: string; profile?: string; configuration?: string } = {},
  ) =>
    MessageNode.toNode({
      profile,
      configuration,
      id: `urn:test:${id}`,
      conversation: `urn:test:conversation:${id}`,
      kind: "describe",
      from: { actor: "urn:test:sender", onBehalfOf: "urn:test:principal" },
      to: { actor: to },
      createdAt: at,
      expiresAt: "2026-11-13T10:00:00.000Z",
      body: {},
    });
  const carrying = describe("carrying");
  carrying.evidence = [{ role: "credential", format: "jws-compact", value: jws }];
  const carryingWire = await packet(carrying);
  const citing = describe("citing");
  citing.evidence = [
    EvidenceItemNode.byDigest(
      { role: "credential", format: "jws-compact", digest: digestBytes(jws) },
      "urn:test:previous",
      citing.dataset,
    ),
  ];
  const citingWire = await packet(citing);
  const control = await open();
  const baseline = await control.receive(citingWire);
  expect(baseline).toMatchObject({
    disposition: "rejected",
    reason: "evidence-invalid",
    detail: "prior-credential-missing-or-digest-mismatch",
  });
  const runtime = await open(store);
  expect(
    await runtime.receive(carryingWire, {
      binding: "email-mime/0.1",
      checkEmailParity: () => "the footer differs",
    }),
  ).toMatchObject({ disposition: "rejected", reason: "human-parity-mismatch" });
  expect(await runtime.receive(citingWire)).toEqual(baseline);
  const misaddressed = describe("misaddressed", { to: "urn:test:other-receiver" });
  misaddressed.evidence = [{ role: "credential", format: "jws-compact", value: jws }];
  expect(await runtime.receive(await packet(misaddressed))).toMatchObject({
    disposition: "rejected",
    reason: "wrong-audience",
  });
  expect(await runtime.receive(citingWire)).toEqual(baseline);
  const unsupported = describe("unsupported", { profile: "urn:test:unsupported-profile" });
  unsupported.evidence = [{ role: "credential", format: "jws-compact", value: jws }];
  expect(await runtime.receive(await packet(unsupported))).toMatchObject({
    reason: "unsupported-profile",
  });
  expect(await runtime.receive(citingWire)).toEqual(baseline);
  const unaccepted = describe("unaccepted", { configuration: CONFIG_TRANSPORT_EMAIL });
  unaccepted.evidence = [{ role: "credential", format: "jws-compact", value: jws }];
  expect(
    await runtime.receive(await packet(unaccepted), { binding: "email-mime/0.1" }),
  ).toMatchObject({
    disposition: "accepted",
    reason: "unsupported-configuration",
  });
  // Older snapshots may say transport accepted even when the inbound gate refused.
  const refusedState = store.load();
  const refusedRecord = refusedState.recordMessages[unaccepted.id];
  if (!refusedRecord) throw new Error("Missing refused message record");
  delete refusedRecord.credentialsAdmitted;
  store.save(refusedState);
  const resumed = await open(store);
  expect(await resumed.receive(citingWire)).toEqual(baseline);

  // Changing a recorded refusal without resealing it cannot restore the credential.
  let readingRefusedMessage = false;
  const tampered = ledger.entries().map((entry) => {
    const { record } = entry;
    if (record.type === "message-in") readingRefusedMessage = record.id === unaccepted.id;
    if (
      readingRefusedMessage &&
      record.type === "gate-decision" &&
      record.gate === "inbound-gate"
    ) {
      readingRefusedMessage = false;
      expect(record.outcome).not.toBe("admit");
      return { ...entry, record: { ...record, outcome: "admit" } };
    }
    return entry;
  });
  expect(tampered).not.toEqual(ledger.entries());
  const readTampered = vi.spyOn(ledger, "entries").mockReturnValue(tampered);
  try {
    const tamperedStore = new MemoryStateStore();
    tamperedStore.save(refusedState);
    const tamperedRestart = await open(tamperedStore, ledger);
    expect(await tamperedRestart.receive(citingWire)).toMatchObject({
      disposition: "rejected",
      reason: "record-unavailable",
      detail: "A retained legacy credential has no matching recorded admission.",
    });
  } finally {
    readTampered.mockRestore();
  }

  const admitted = await resumed.receive(carryingWire);
  expect(admitted.disposition, `${admitted.reason}: ${admitted.detail}`).toBe("accepted");
  const oldState = store.load();
  const restarted = await open(store);
  for (const rt of [resumed, restarted])
    expect(await rt.receive(citingWire)).toMatchObject({ disposition: "accepted" });

  // Reopen a pre-marker snapshot captured after the first admitted packet.
  const oldRecord = oldState.recordMessages[carrying.id];
  if (!oldRecord) throw new Error("Missing admitted message record");
  delete oldRecord.credentialsAdmitted;
  store.save(oldState);
  expect(await (await open(store)).receive(citingWire)).toMatchObject({ disposition: "accepted" });

  const entries = ledger.entries();
  const messageIndex = entries.findIndex(
    ({ record }) => record.type === "message-in" && record.id === carrying.id,
  );
  const decisionIndex = entries.findIndex(
    ({ record }, index) =>
      index > messageIndex && record.type === "gate-decision" && record.gate === "inbound-gate",
  );
  expect(messageIndex).toBeGreaterThanOrEqual(0);
  expect(decisionIndex).toBeGreaterThan(messageIndex);
  for (const missing of [messageIndex, decisionIndex]) {
    const retained = new MemoryLedger();
    for (const [index, entry] of entries.entries()) {
      if (index !== missing) retained.append(entry.record, entry.at);
    }
    store.save(oldState);
    expect(await (await open(store, retained)).receive(citingWire)).toMatchObject({
      disposition: "rejected",
      reason: "record-unavailable",
      detail: "A retained legacy credential has no matching recorded admission.",
    });
  }
});
