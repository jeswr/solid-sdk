// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { digestOf } from "../../src/core/canonical.js";
import type { AnyMessage } from "../../src/core/types.js";
import { MessageNode } from "../../src/model/message-nodes.js";
import { CONFIG_ED25519 } from "../../src/profile/configurations.js";
import { PILOT_PROFILE } from "../../src/profile/vocabulary.js";
import { Cast, mandateOf, signClaim } from "../../src/scenarios/common.js";
import { publishProtocolKey } from "../../src/settlement/adapter.js";
import type { SettlementSuite } from "../../src/settlement/types.js";
import { TraceRecorder } from "../../src/trace/recorder.js";
import { writeMessagePacket } from "../../src/wire/message-packet.js";

it.each([
  "accepted",
  "no source authority",
  "no source statement",
])("admits a published protocol key only through its pinned identity and source check: %s", async (mode) => {
  const at = "2026-11-13T09:00:00.000Z";
  const cast = new Cast(() => new Date(at));
  const a = await cast.add(
    { name: "a", actor: "urn:test:a-agent", party: "urn:test:a" },
    mandateOf("keys", []),
    [],
  );
  const b = await cast.add(
    { name: "b", actor: "urn:test:b-agent", party: "urn:test:b" },
    mandateOf("keys", []),
    [],
  );
  cast.introduce("a", "b");
  if (mode === "accepted")
    cast.rule("b", {
      id: "urn:test:key-source",
      version: "1",
      source: a.identity.party,
      claimTypes: ["settlement-key"],
      subjects: [a.identity.party],
    });
  const recorder = new TraceRecorder();
  const unavailable = async () => {
    throw new Error("No effect or protocol verifier is called by transport admission");
  };
  const suite: SettlementSuite = {
    id: "x402",
    request: unavailable,
    order: unavailable,
    settle: unavailable,
    lift: () => {
      throw new Error("No unchecked lift");
    },
  };
  const { runtime } = await cast.runtime("b", [], [], [CONFIG_ED25519], {
    settlement: suite,
    gates: {
      sink: recorder.sink("b"),
      reliance: {
        id: "urn:test:key-reliance",
        rules: [
          {
            id: "urn:test:key-rule",
            claimType: "settlement-key",
            methods: ["recorded-by-authority"],
            maxAgeDays: 1,
            text: "An admitted key publication",
          },
        ],
      },
    },
  });
  expect(
    runtime
      .description()
      .configurations.implemented.some((id) => id.includes("#config/settlement-")),
  ).toBe(false);
  const key = await publishProtocolKey(a.ownerKey, {
    type: "SettlementKey",
    party: a.identity.party,
    suite: "x402",
    algorithm: "secp256k1",
    publicKey: "0x1111111111111111111111111111111111111111",
    validFrom: at,
    validUntil: "2026-11-20T09:00:00.000Z",
  });
  const observed = {
    suite: "x402",
    objects: [{ name: "SettlementKey", form: "identity-signed JWS", raw: key, shown: null }],
  };
  const claim = {
    id: "urn:test:key-statement",
    issuer: a.identity.party,
    subject: a.identity.party,
    claimType: "settlement-key",
    method: "recorded-by-authority",
    asOf: at,
    objectDigest: digestOf(observed),
    terms: {
      policy: {
        id: "urn:test:publication-terms",
        permissions: [
          {
            type: "permission",
            action: "use",
            constraints: [
              { leftOperand: "purpose", operator: "eq", rightOperand: "urn:purpose:valuation" },
            ],
          },
        ],
      },
    },
  };
  const message = {
    profile: PILOT_PROFILE,
    configuration: CONFIG_ED25519,
    id: "urn:test:key-message",
    conversation: "urn:test:key-conversation",
    kind: "receipt",
    from: { actor: a.identity.actor, onBehalfOf: a.identity.party },
    to: { actor: b.identity.actor, party: b.identity.party },
    createdAt: at,
    expiresAt: "2026-11-13T09:05:00.000Z",
    body: {
      ref: "urn:test:publication",
      activity: "urn:test:key-publication",
      outcome: "completed",
      final: true,
      observed,
    },
    evidence:
      mode === "no source statement"
        ? []
        : [
            {
              role: "credential",
              format: "jws-compact",
              value: await signClaim(a.ownerKey, claim),
            },
          ],
  } as AnyMessage;
  const wire = await writeMessagePacket(MessageNode.toNode(message), {
    suite: "jws",
    key: a.actorKey,
    verificationMethod: `urn:awp:key:${a.actorKey.kid}`,
    created: at,
  });
  if (mode === "accepted") {
    const results = await Promise.allSettled([
      runtime.admitSettlementMessage(wire),
      runtime.admitSettlementMessage(wire),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")[0]).toMatchObject({
      reason: { reason: "replay-conflict" },
    });
    expect(
      new Set(
        recorder
          .events()
          .filter((e) => e.kind === "check")
          .map((e) => e.check),
      ),
    ).toEqual(new Set(["integrity", "source", "authority", "terms", "fitness"]));
  } else {
    await expect(runtime.admitSettlementMessage(wire)).rejects.toMatchObject({
      reason: "source-not-authoritative",
    });
    expect(recorder.events().at(-1)).toMatchObject({
      outcome: "refuse",
      reason: "source-not-authoritative",
    });
  }
});
