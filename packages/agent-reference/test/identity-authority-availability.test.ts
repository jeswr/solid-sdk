// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { DEFAULT_LIMITS } from "../src/core/limits.js";
import { GateMemory } from "../src/gates/common.js";
import { InboundGate } from "../src/gates/inbound.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { MessageNode } from "../src/model/message-nodes.js";
import { alternativeWireId } from "../src/profile/configurations.js";
import { PILOT_PROFILE } from "../src/profile/vocabulary.js";
import { testKey } from "../src/reference/keys.js";
import { Cast, mandateOf } from "../src/scenarios/common.js";
import { writeMessagePacket } from "../src/wire/message-packet.js";

const configurations = [
  "authority-mandate-credential",
  "identity-did",
  "authority-authorization-server",
  "authority-agent-registry",
];
it("does not advertise uninstalled identity or authority mechanisms", async () => {
  const cast = new Cast(() => new Date("2026-11-13T09:00:00.000Z"));
  await cast.add(
    { name: "availability", actor: "urn:availability:actor", party: "urn:availability:principal" },
    mandateOf("availability", []),
    [],
  );
  const { runtime } = await cast.runtime("availability", []);
  for (const id of configurations)
    expect(runtime.description().configurations.implemented).not.toContain(alternativeWireId(id));
});
it.each(
  configurations,
)("refuses %s rather than falling back to the pinned-key baseline", async (id) => {
  const actor = await testKey("availability-sender");
  const trust = await TrustStore.load({
    version: 1,
    owner: "urn:availability:principal",
    sourceAuthority: [],
    keys: [
      {
        kid: actor.kid,
        alg: actor.alg,
        publicJwk: actor.publicJwk,
        role: "actor",
        subject: "did:web:sender.example",
      },
    ],
  });
  const gate = new InboundGate({
    identity: { actor: "urn:availability:receiver" },
    trust,
    limits: DEFAULT_LIMITS,
    now: () => "2026-11-13T09:00:00.000Z",
    record: () => {},
    gate: {},
    memory: new GateMemory(),
    agreementTerms: () => undefined,
  });
  const node = MessageNode.toNode({
    profile: PILOT_PROFILE,
    configuration: alternativeWireId(id),
    id: "urn:availability:message",
    conversation: "urn:availability:conversation",
    kind: "describe",
    from: { actor: "did:web:sender.example" },
    to: { actor: "urn:availability:receiver" },
    createdAt: "2026-11-13T09:00:00.000Z",
    expiresAt: "2026-11-13T10:00:00.000Z",
    body: {},
  });
  const packet = await writeMessagePacket(node, {
    suite: "jws",
    key: actor,
    verificationMethod: "urn:awp:key:" + actor.kid,
    created: "2026-11-13T09:00:00.000Z",
  });
  expect(await gate.verifyIntegrity(packet, {}, () => false)).toMatchObject({
    ok: false,
    reason: "unsupported-configuration",
  });
});

it.each(configurations)("stops local effects under uninstalled %s", async (id) => {
  const cast = new Cast(() => new Date("2026-11-13T09:00:00.000Z"));
  await cast.add(
    { name: "effect", actor: "urn:availability:actor", party: "urn:availability:principal" },
    mandateOf("availability", [
      { type: "permission", action: "use", target: "urn:availability:operation" },
    ]),
    [],
  );
  const { BASELINE } = await import("../src/suites/baseline.js");
  const { runtime } = await cast.runtime(
    "effect",
    [],
    [
      {
        id: "urn:availability:adapter",
        execute: async () => {
          throw new Error("An unavailable suite executed an effect");
        },
        reconcile: async () => {
          throw new Error("Unexpected reconciliation");
        },
      },
    ],
    [BASELINE.pilotConfiguration],
    { gates: { configuration: { ...BASELINE, id, pilotConfiguration: alternativeWireId(id) } } },
  );
  const result = await runtime.runTask({
    taskId: "urn:availability:task",
    kind: "test",
    plan: {
      adapter: "urn:availability:adapter",
      key: "urn:availability:effect",
      activityType: "urn:availability:activity",
      intent: {
        action: "use",
        operation: "urn:availability:operation",
        target: "urn:availability:operation",
        conversation: "urn:availability:conversation",
        parameters: {},
      },
      params: {},
    },
  });
  expect(result.decisions.at(-1)).toMatchObject({
    outcome: "deny",
    reason: "unsupported-configuration",
  });
});
