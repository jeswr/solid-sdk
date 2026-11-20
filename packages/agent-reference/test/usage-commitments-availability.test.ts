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

const ids = ["usage-control-odrl-model-tighten", "commitments-agreement-credential"];
it("does not advertise a model or native agreement verifier that the host did not install", async () => {
  const cast = new Cast(() => new Date("2026-11-13T09:00:00.000Z"));
  await cast.add(
    { name: "missing", actor: "urn:missing:actor", party: "urn:missing:principal" },
    mandateOf("missing", []),
    [],
  );
  const { runtime } = await cast.runtime("missing", []);
  for (const id of ids)
    expect(runtime.description().configurations.implemented).not.toContain(alternativeWireId(id));
});
it.each(
  ids,
)("refuses a signed incoming %s packet without its installed enforcement adapter", async (id) => {
  const key = await testKey("uninstalled-usage-sender");
  const trust = await TrustStore.load({
    version: 1,
    owner: "urn:receiver",
    sourceAuthority: [],
    keys: [
      {
        kid: key.kid,
        alg: key.alg,
        publicJwk: key.publicJwk,
        role: "actor",
        subject: "urn:sender",
      },
    ],
  });
  const gate = new InboundGate({
    identity: { actor: "urn:receiver" },
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
    id: "urn:message",
    conversation: "urn:conversation",
    kind: "describe",
    from: { actor: "urn:sender" },
    to: { actor: "urn:receiver" },
    createdAt: "2026-11-13T09:00:00.000Z",
    expiresAt: "2026-11-13T10:00:00.000Z",
    body: {},
  });
  const wire = await writeMessagePacket(node, {
    suite: "jws",
    key,
    verificationMethod: "urn:awp:key:" + key.kid,
    created: "2026-11-13T09:00:00.000Z",
  });
  expect(await gate.verifyIntegrity(wire, {}, () => false)).toMatchObject({
    ok: false,
    reason: "unsupported-configuration",
  });
});
